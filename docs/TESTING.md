# Testing

The project has only unit tests for pure logic. There are no e2e tests or Electron launches in the test suite.

## 1. Commands

```bash
npm test              # single run
npm run test:watch    # watch mode
npm run typecheck     # checks main/preload/shared and renderer types separately
npm run build         # checks that the production build succeeds
```

Current state: **296 tests in 25 files**. A run takes about a second.

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

- Tests live only in `test/**/*.test.ts`.
- `node_modules_linux` is excluded because it is a stale Linux tree; the app uses the macOS `node_modules`.
- The `@shared` alias is available. Renderer helper tests import them by relative path (for example, `../src/renderer/src/skip`).
- Vitest runs in a Node environment; DOM and Electron are not emulated.

## 3. What is covered

| File | Tests | What it checks |
|---|---:|---|
| `test/candidates.test.ts` | 8 | suppressed minimum-duration candidates, ID stability, promotion, disabled types, dismissed promotion |
| `test/autoIds.test.ts` | 6 | word-based automatic ID derivation, stability across rule/transcript changes, same-type collision suffix |
| `test/core.test.ts` | 16 | `words.json` parser, trailing comma, real fixture, `buildTranscript`, confidence, event classification, active word/segment, automatic defects, sentence-boundary pauses, manual marks, exact word boundaries, old marks without `wordIds`, logical marks |
| `test/defectCardView.test.ts` | 7 | pending/confirmed/deleted card layout, candidate card, collapsing in skip mode, automatic group marker, manual badges and split visibility |
| `test/engine.test.ts` | 8 | chunk planner (short recording, silence, max size, short first chunk, target), WAV reading, slicing, waveform |
| `test/export.test.ts` | 7 | CSV field order, escaping, delimiter/header, cut vs defect bounds, uncut rows, all fields; values are English (`filler`, `yes`/`no`), including the synthetic manual label |
| `test/fillerLanguage.test.ts` | 12 | RU/EN filler lexicons, language mapping, default rules per language, `normalizeRules` language fill, adopting a default list vs keeping a custom one, English filler detection |
| `test/format.test.ts` | 11 | number parsing (dot/comma/empty/partial), step snapping, float noise, display formatting (RU/EN), slider fill |
| `test/grouping.test.ts` | 29 | per-type minimum duration, pause hard threshold and normalization, automatic grouping rules and limits, enabled types and id stability, grouping toggle and migration, per-type/group skip padding, settings normalization (padding, pause room tone, mini timeline, waveform contrast) |
| `test/history.test.ts` | 10 | undo/redo by index, redo branch truncation, `mergeKey` coalescing, different keys, deleted-marks archive, rules and padding snapshots, `skipEnabled` preservation, rules equality, session guard and no cross-session coalescing |
| `test/manualPins.test.ts` | 6 | pinning the derived cut on confirmation, dropping pinned ranges on unconfirm, keeping hand-dragged ranges, re-pinning on double-click |
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
| `test/videoExport.test.ts` | 11 | video settings normalization, filter graph, CRF/q:v encoder args, kept ranges, duration and progress parsing |
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
- real ffmpeg video export and VideoToolbox encoding;
- React components, canvas timeline rendering, transcript virtualization;
- real `audiocpp_cli` and Metal execution;
- DMG packaging and ad-hoc signing.

These are deliberate MVP limitations. When improving these areas, extract a pure function first, then add a test.

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
- [ ] The new rule/branch has a regression test.
- [ ] If IDs, confirmation state, grouping, minimum duration, skip padding or cut handles changed, tests in `core`, `marks`, `selection`, `skip` or `grouping` are updated.
- [ ] If the parser/chunking/WAV changed, `core` or `engine` is updated.
- [ ] If CSV changed, `export` is updated.
- [ ] If the video export command or filter graph changed, `videoExport` is
      updated.

## 8. Environment limitations

The suite does not launch Electron, read `resources/engine`, download the model or work with real video. A green `npm test` therefore does not prove that the app works on macOS: a manual run with `npm run dev` and a real webinar file is still required.
