# 08a — Streaming recognition inside a chunk

[Index](../SPEC.md) · Parent: [08 — Processing](08-processing-progress.md) ·
Story 37

**Status:** Backlog · **Priority:** P3

This is a logically autonomous part of story 37. It is separated because it
depends on an engine capability, not only on app code.

## Story 37 (detail) — Streaming ASR

As a user, I want words to appear while a chunk is still being decoded, instead
of waiting for the whole chunk.

### Constraints

- `audiocpp_cli` currently runs on a whole WAV file. Check whether it has a
  streaming/partial-output mode before designing UI.
- Do not fake streaming by slicing audio into ever smaller chunks: that
  multiplies model reloads and makes timestamps worse.
- Word ids must remain dense and stable within a transcript build.
- Review state must not be corrupted by partial word updates.

### Acceptance criteria

- [ ] The engine exposes partial words for a chunk, or the story is closed as
      not possible with the current engine.
- [ ] Partial words are emitted with monotonic timestamps.
- [ ] The renderer can append words without losing selection, marks or review.
- [ ] The first partial transcript reset rule still applies (invariant 11).
- [ ] Cancellation stops the stream and cleans temporary files.
- [ ] Unit tests cover append/merge of partial word lists.
- [ ] No Python/torch path is introduced.

### Out of scope

- Real-time microphone input.
- Changing the model.
- Streaming across chunk boundaries.

## Verification

- Requires an audio.cpp streaming API and a macOS run.
- Design must be approved before implementation.