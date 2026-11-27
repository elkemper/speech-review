# Testing

The project has only unit tests for pure logic. There are no e2e tests or Electron launches in the test suite.

## 1. Commands

```bash
npm test                # single run
npm run test:watch      # watch mode
npm run test:integration  # real ffmpeg, opt-in (see §2.1)
npm run typecheck       # checks main/preload/shared and renderer types separately
npm run build           # checks that the production build succeeds
```

Current state: **400 unit tests in 37 files** (about a second) and **18
integration tests** (about ten seconds).

## 2. Configuration

`vitest.config.mts`:

```ts
{
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/node_modules_linux/**', '**/dist/**', '**/out/**']
  }
}
```

- Tests live only in `test/**/*.test.ts`; the real-ffmpeg suite uses `test/integration/**/*.int.test.ts` and is excluded from `npm test`.
- The content model in `test/integration/contentMap.ts` is shared by the unit
  and integration suites.
- `node_modules_linux` is excluded because it is a stale Linux tree; the app uses the macOS `node_modules`.
- The `@shared` alias is available. Renderer helper tests import them by relative path (for example, `../src/renderer/src/skip`).
- Vitest runs in a Node environment; DOM and Electron are not emulated. A
  renderer helper must stay importable without `window`; the defect table
  window's IPC relay and cell editing are therefore covered only manually with
  `npm run dev` on macOS.

### 2.1 Integration suite (opt-in)

`npm run test:integration` runs the **real pipeline** — `resolveExportJob` plus
`runExport` with `ffmpegPorts` — against real ffmpeg and real media. Only the
Electron dialog and IPC are left out.

- The binary is found in this order: `SPEECH_REVIEW_FFMPEG`, the bundled
  `resources/ffmpeg/ffmpeg`, then `ffmpeg` from `PATH`. A candidate that exists
  but cannot start (a macOS arm64 build on Linux) is skipped, so a host without
  a usable ffmpeg reports the suite as skipped instead of failing.
- The source is generated on the fly: 10 s, 320×180, 25 fps, carrying a
  **continuous** timecode in both tracks. The frame colour encodes the whole
  second in the red channel and the fraction of the second in the green one;
  the audio is a linear chirp rising 270 Hz per second. A sampled output
  position can therefore be traced back to the source time to within a few
  milliseconds (measured: 4 ms video, 11 ms audio), so a drift of a tenth of a
  second fails the suite. Nothing reuses the export code to compute the
  expectation.
- Assertions are invariants, not snapshots: exact decoded frame count, audio
  length against video length, traced video/audio source time at chosen output
  positions, a dissolve at the middle of a fade traced to the midpoint of the
  two source moments, direct video-versus-audio lip sync across four 0.4 s
  joins, a variable-frame-rate source, exact rate recovery from the rounded
  ffmpeg banner, cleanup on cancel, output height after scaling.
- `test/integration/contentMap.ts` is an independent model of the output: from
  the cut list, the frame rate and the fade length alone it says which source
  frame is shown at any output frame (and which two are mixed inside a
  dissolve) and which source sample is heard at any output sample. It does not
  import the export code, so a bug in `buildExportPlan` or in the filter graph
  cannot hide behind the expectation. `test/contentMap.test.ts` pins the model
  itself on hand-computed cases. Both the plan and the model apply the same
  contract: a kept fragment shorter than two fades is merged into the cut, so
  one full fade spans it and the fragment is never mixed twice.
- `test/integration/content.int.test.ts` runs a cut list with a dissolve near
  both edges and checks every decoded frame against the model, the first and
  last frames against the original file (plus negative controls that the
  neighbouring frames are measurably different), and the audio by waveform
  correlation at the start, inside every kept piece and at the very end, with a
  shifted window proving the match is not accidental. A third scenario keeps a
  fragment shorter than two fades between two cuts: it must be merged away and
  the audio must keep the video's clock after the join.
- The hardware case runs only on `darwin` and only when the binary advertises
  `h264_videotoolbox`; otherwise it is skipped with the rest of the suite
  green.
- The suite is excluded from `npm test` so the fast unit run never needs
  ffmpeg. It creates a temporary directory and removes it afterwards.

## 3. What is covered

| File | Tests | What it checks |
|---|---:|---|
| `test/audioMix.test.ts` | 7 | streaming audio mixer: exact piece copy without a fade, constant level through 39 joins, output length equal to the export plan, stereo channel independence, abort, progress, defensive handling of a mismatched fade |
| `test/contentMap.test.ts` | 10 | the independent content model: identity, the four-join cut list frame by frame, plain concatenation, a fade clamped by a short piece, a fragment shorter than two fades merged into the cut, a fragment exactly two fades long, untouched source ends, positions outside the export |
| `test/cutEdit.test.ts` | 8 | cut edge edits from the defect table: start/end/duration, the edge a duration edit moves, uncut-row fallbacks, inverted, too short, negative and out-of-range rejection, derived vs overridden cuts |
| `test/exportRows.test.ts` | 5 | exportable rows only (dismissed and candidates dropped), derived and overridden cut bounds, uncut pause, no mutation |
| `test/candidates.test.ts` | 8 | suppressed minimum-duration candidates, ID stability, promotion, disabled types, dismissed promotion |
| `test/autoIds.test.ts` | 6 | word-based automatic ID derivation, stability across rule/transcript changes, same-type collision suffix |
| `test/core.test.ts` | 16 | `words.json` parser, trailing comma, real fixture, `buildTranscript`, confidence, event classification, active word/segment, automatic defects, sentence-boundary pauses, manual marks, exact word boundaries, old marks without `wordIds`, logical marks |
| `test/defectCardView.test.ts` | 7 | pending/confirmed/deleted card layout, candidate card, collapsing in skip mode, automatic group marker, manual badges and split visibility |
| `test/engine.test.ts` | 8 | chunk planner (short recording, silence, max size, short first chunk, target), WAV reading, slicing, waveform |
| `test/export.test.ts` | 7 | CSV field order, escaping, delimiter/header, cut vs defect bounds, uncut rows, all fields; values are English (`filler`, `yes`/`no`), including the synthetic manual label |
| `test/exportJob.test.ts` | 9 | export source validation (empty keep, missing track, unknown fps), job resolution (plan and total length, crossfade shortening, settings normalization, sample-rate fallback, overwrite and container refusals) |
| `test/exportPipeline.test.ts` | 7 | stage order and filter script, monotonic progress capped at 99 until the rename, partial-file and work-directory cleanup on failure and cancel, empty-output refusal, abort before rendering |
| `test/fillerLanguage.test.ts` | 12 | RU/EN filler lexicons, language mapping, default rules per language, `normalizeRules` language fill, adopting a default list vs keeping a custom one, English filler detection |
| `test/format.test.ts` | 11 | number parsing (dot/comma/empty/partial), step snapping, float noise, display formatting (RU/EN), slider fill |
| `test/grouping.test.ts` | 29 | per-type minimum duration, pause hard threshold and normalization, automatic grouping rules and limits, enabled types and id stability, grouping toggle and migration, per-type/group skip padding, settings normalization (padding, pause room tone, mini timeline, waveform contrast) |
| `test/history.test.ts` | 10 | undo/redo by index, redo branch truncation, `mergeKey` coalescing, different keys, deleted-marks archive, rules and padding snapshots, `skipEnabled` preservation, rules equality, session guard and no cross-session coalescing |
| `test/manualPins.test.ts` | 6 | pinning the derived cut on confirmation, dropping pinned ranges on unconfirm, keeping hand-dragged ranges, re-pinning on double-click |
| `test/manualMarkAdd.test.ts` | 6 | shared manual-mark core: standalone mark and note stores, exact cut override, merging into a group, unconfirmed group after a merge, frozen cut dropped when the group gains an unconfirmed mark |
| `test/migrations.test.ts` | 7 | schema version reading, ordered migration runner, unknown/newer versions, partial migration application |
| `test/modelManifest.test.ts` | 13 | runtime manifest fetching/validation, version comparison, `normalizeModelVersions`, manifest diffing and version bump |
| `test/pinnedCuts.test.ts` | 8 | pinned override helpers, `withoutPinnedCuts`, manual pin reconciliation, derived re-pin |
| `test/projectMigrations.test.ts` | 10 | numbered project migrations, order-based to word-based ID conversion, pinned override defaults, grouped marks |
| `test/i18n.test.ts` | 20 | catalogue key parity and placeholders, no Cyrillic in English, interpolation/fallback, language normalization and system locale, plural categories, label helpers, locale-aware bytes/seconds/ETA, `uiLanguage` excluded from settings history, manual mark fallback text |
| `test/settingsHistory.test.ts` | 5 | labels and merge keys for rule/padding changes, fallback metadata (RU/EN), `skipEnabled` excluded |
| `test/settingsMigrations.test.ts` | 5 | numbered settings migrations, version bump, field rename conversion |
| `test/marks.test.ts` | 14 | merge on add, split, logical mark ID, combined bounds/words/notes, confirmation reconciliation on merge/split, new marks, cut-span capture, edge-specific capture and nested override scope |
| `test/selection.test.ts` | 39 | selection range in both directions, exact mark boundaries, exact time range, defect overlap, playhead fallback, clamp, nearest word, fit/zoom/pan, LOD and labels, cut handle dragging, bulk confirmation/deletion of a selection, mini timeline zoom/pan and colored word mapping |
| `test/skip.test.ts` | 27 | padding and interval merging, pause room tone and minimum cut, cut overrides, cut view hatching, complement and subtract ranges, all non-dismissed items, dismissed and candidate filtering, clamp/disabled, interval lookup |
| `test/tableColumns.test.ts` | 5 | defect table width normalization, clamping, known-field filtering, per-field defaults, total width and the columns an inline draft edits |
| `test/tableDraft.test.ts` | 12 | inline draft validation, default bounds near the recording end, time text per column and placement below the selection or at the playhead |
| `test/tableSelection.test.ts` | 9 | defect table replace/toggle/range selection, stale anchor fallback, unknown ids, select-all, pruning unchanged input, playhead insertion index |
| `test/timeInput.test.ts` | 8 | time typed into the table: seconds/minutes/hours, comma decimals, overflowing parts, malformed input, same-moment comparison at display precision, fixed-width formatting |
| `test/tableTheme.test.ts` | 2 | the table window's theme value: only `light` opts in, anything else keeps the window dark |
| `test/videoExport.test.ts` | 27 | video settings normalization (including crossfade), single-pass select graph with frame-rate normalization, xfade dissolve graph with frame-accurate trims and offsets, concat fallback, filter-thread cap, export plan sync between video and audio, merging of a kept fragment shorter than two fades, the one-sample NTSC sample-overlap clamp, exact NTSC frame-rate snapping, CRF/q:v encoder args, kept ranges, duration and progress parsing |
| `test/waveform.test.ts` | 9 | waveform statistics (noise floor, loud reference, degenerate input), contrast lookup table (linear mode, gamma lift, gate, monotonicity), signed mapping |

## 4. Fixtures

`test/fixtures/chunk.json` and `test/fixtures/out.txt` are real audio.cpp output for a short chunk.

Expectations that must not be changed without replacing the fixture:

- 80 raw words;
- the first word is `[UH]` with `start_sample: 21760`, `end_sample: 27200`;
- the last word is `бизнес-пуризнес`;
- automatic defects: **6 fillers, 3 pauses, 1 false start = 10**;
- pauses start at approximately 7.48, 20.96 and 34.3 s;
- the pause after the word "пользу." is not a defect;
- the false start is `Вит-` at approximately 36.25 s;
- there are no repetitions, elongations, vocal sounds or `unclear` in the fixture.

`test/engine.test.ts` generates WAV files programmatically in a temporary directory and removes it in `afterEach`. For such tests, use `mkdtemp` + `rm(..., { recursive: true, force: true })`.

## 5. What is not covered

- parsing `silencedetect` output and ffmpeg progress;
- model download/resume and SHA-256 verification;
- project save/load/delete and defect-state reset;
- partial transcripts and confirmation-state merging in the renderer;
- IPC contracts and preload;
- VideoToolbox encoding on hosts other than macOS (the integration suite
  exercises it only where the platform and the binary allow);
- React components, canvas timeline rendering, transcript virtualization;
- real `audiocpp_cli` and Metal execution;
- DMG packaging and ad-hoc signing.

These are deliberate test gaps. When improving these areas, extract a pure function first, then add a test.

## 6. How to add tests

1. If logic depends on React/Electron, move the calculation into `src/shared` or a pure renderer helper.
2. Add `test/<area>.test.ts` with `describe`/`it` from `vitest`.
3. Use `@shared` for the shared layer; import renderer helpers by relative path.
4. For file operations, create a temporary directory and always remove it.
5. Check more than the happy path: empty arrays, reversed bounds, zero duration, disabled settings, old data without new fields.
6. Do not add snapshots or test exact JSX markup — it is brittle and does not cover business logic.

## 7. Checklist for changes

- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes; the test count did not decrease without a reason.
- [ ] `npm run build` passes.
- [ ] If the export pipeline, plan or graph changed, `npm run test:integration`
      passes where ffmpeg is available.
- [ ] The new rule/branch has a regression test.
- [ ] If IDs, confirmation state, grouping, minimum duration, skip padding or cut handles changed, tests in `core`, `marks`, `selection`, `skip` or `grouping` are updated.
- [ ] If the parser/chunking/WAV changed, `core` or `engine` is updated.
- [ ] If CSV changed, `export` is updated.
- [ ] If the video export command or filter graph changed, `videoExport` is
      updated.

## 8. Environment limitations

The unit suite does not launch Electron, read `resources/engine`, download the model or work with real video. The opt-in integration suite does exercise real video through real ffmpeg, but still not the Electron layer. A green `npm test` (and even a green `npm run test:integration`) therefore does not prove that the app works on macOS: a manual run with `npm run dev` and a real webinar file is still required.
