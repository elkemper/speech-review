# 08 — Processing and progress

[Index](../SPEC.md) · Prev: [07 — Layout](07-layout-history-visual.md) · Next:
[09 — Export](09-export.md)

**Files:** `src/main/jobs.ts`, `src/main/engine/chunks.ts`,
`src/renderer/src/components/Workspace.tsx`, `src/shared/types.ts`.

## Stories

### Story 35 — Honest progress only for transcription

**Status:** Next · **Priority:** P1

As a user, I want the progress bar to show a meaningful percentage only during
transcription; other phases should show their name with an indeterminate
indicator.

- `prepare`, `audio`, `silence`, `peaks` show a label + indeterminate bar.
- Numeric percent only for `transcribe`.
- Transcription progress is monotonic and based on processed audio.
- Show ETA and "chunk N of M" during transcription.
- No jump to a high percentage before analysis starts.

### Story 36 — Shorter chunks by default

**Status:** Next · **Priority:** P1

As a user, I want shorter chunks by default (2–3 minutes) so the first results
appear earlier, while keeping the chunk length configurable.

- Default `chunkTargetSec = 180`.
- Range remains 120–900 s.
- First chunk stays short (up to 3 min).
- Each chunk yields a partial transcript (story 24).
- Document the trade-off: more model reloads.

### Story 37 — Streaming recognition inside a chunk

**Status:** Backlog · **Priority:** P3

As a user, I want words to appear before a chunk ends.

Detail: [`08a-streaming-asr.md`](08a-streaming-asr.md).

## Acceptance criteria

### Story 35

- [ ] Non-transcription phases show the phase name and an indeterminate
      indicator.
- [ ] The numeric bar is used only for `transcribe`.
- [ ] Transcription percent is monotonic and based on processed audio.
- [ ] ETA and chunk count are shown.
- [ ] The overall UI never shows a high percent before analysis begins.
- [ ] The banner and the start card use the same rules.

### Story 36

- [ ] Default chunk target is 180 s.
- [ ] The value is clamped to 120–900 s and persisted.
- [ ] First chunk is at most 3 min.
- [ ] Each finished chunk produces a partial (story 24).
- [ ] The settings hint explains the model-reload trade-off.
- [ ] Existing projects keep their stored value.

### Story 37

- [ ] Parent story for `08a`; detail lives there.
- [ ] Do not fake streaming by slicing audio more aggressively.
- [ ] Requires an engine capability.

## Verification

- Progress and chunking need a macOS run with a real media file.
- `test/engine.test.ts` covers the pure chunk planner; update it if the
  default or first-chunk rule changes.