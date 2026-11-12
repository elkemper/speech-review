# Testing

The project has only unit tests for pure logic. There are no e2e tests or Electron launches in the test suite.

## 1. Commands

```bash
npm test              # single run
npm run test:watch    # watch mode
npm run typecheck     # checks main/preload/shared and renderer types separately
npm run build         # checks that the production build succeeds
```

Current state: **82 tests in 8 files**. A run takes less than a second in the Linux container.

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
| `test/core.test.ts` | 18 | `words.json` parser, trailing comma, real fixture, `buildTranscript`, confidence, event classification, active word/segment, automatic defects, sentence-boundary pauses, manual marks, exact word boundaries, old marks without `wordIds`, overrides, logical marks |
| `test/engine.test.ts` | 8 | chunk planner (short recording, silence, max size, short first chunk, target), WAV reading, slicing, waveform |
| `test/export.test.ts` | 4 | CSV field order, escaping, delimiter/header, all fields |
| `test/grouping.test.ts` | 17 | per-type minimum duration, automatic grouping rules and limits, per-type/group skip padding, settings normalization |
| `test/history.test.ts` | 4 | undo/redo by index, redo branch truncation, `mergeKey` coalescing, different keys |
| `test/marks.test.ts` | 9 | merge on add and move, split, logical mark ID, combined bounds/words/notes, reviewed reconciliation on merge/split, new marks |
| `test/selection.test.ts` | 17 | selection range in both directions, exact mark boundaries, playhead fallback, clamp, nearest word, fit/zoom/pan, LOD and labels, defect boundary dragging, bulk review of a selection |
| `test/skip.test.ts` | 5 | padding and interval merging, "marks only" mode, reviewed items, clamp/disabled, interval lookup |

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
- project save/load/delete and review reset;
- partial transcripts and review-state merging in the renderer;
- IPC contracts and preload;
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
- [ ] If IDs, review state, grouping, minimum duration, skip padding or boundaries changed, tests in `core`, `marks`, `selection`, `skip` or `grouping` are updated.
- [ ] If the parser/chunking/WAV changed, `core` or `engine` is updated.
- [ ] If CSV changed, `export` is updated.

## 8. Environment limitations

Tests can run in the Linux container. They do not launch Electron, read `resources/engine`, download the model or work with real video. Therefore a green `npm test` does not mean the app works on macOS: a real run with `npm run dev` and a webinar file is still required from the user.
