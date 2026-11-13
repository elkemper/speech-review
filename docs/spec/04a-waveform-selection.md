# 04a — Arbitrary waveform selection and pause tokens

[Index](../SPEC.md) · Parent: [04 — Timeline](04-timeline.md) · Story 17

**Status:** Backlog · **Priority:** P2

This is a logically autonomous part of story 17. The parent timeline keeps
word-aligned selection; this file covers pixel-level selection and generated
pause tokens.

## Story 17 (detail) — Arbitrary range + ad-hoc pause tokens

As a user, I want to drag a selection on the waveform that is not snapped to
word boundaries. If an edge falls between words, the app should generate an
explicit pause token at that edge so the selection is representable without
inventing fake words.

### Why it is separate

- It needs a persisted token entity (or an extension of the transcript) with
  editable start/end.
- Marks, confirmation, skip and export must all handle tokens.
- It changes the data model, unlike the rest of the timeline work.

### Proposed model (not implemented)

- A `PauseToken` with `id`, `start`, `end`, `note?`, `createdAt`.
- A token is not a transcript word and does not get a word id.
- A range mark may reference tokens in addition to `wordIds`.
- Tokens survive reload and are shown as a distinct waveform/transcript item.

### Acceptance criteria

- [ ] The user can drag a selection on the waveform that is not word-aligned.
- [ ] Edges snap to word boundaries by default; holding a modifier allows free
      edges (exact modifier to be decided).
- [ ] If an edge falls inside a pause, the app offers/creates a pause token
      with explicit bounds.
- [ ] Pause tokens have editable start/end and persist in the project.
- [ ] A mark can cover words plus pause tokens without absorbing neighbouring
      words.
- [ ] Confirmation, skip, boundary editing and export treat tokens consistently.
- [ ] Undo/redo covers token edits if tokens become project state.
- [ ] Unit tests cover token bounds and mark membership.

### Out of scope

- Splitting or re-recognizing audio.
- Changing `Word` ids.
- Rendering pause tokens as words in the transcript.

## Verification

- Design/data-model review first.
- No e2e; extract range/token logic and unit-test it.