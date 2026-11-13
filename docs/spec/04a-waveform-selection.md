# 04a — Arbitrary waveform selection and pause tokens

[Index](../SPEC.md) · Parent: [04 — Timeline](04-timeline.md) · Story 17

**Status:** Done (area selection) · **Priority:** P1

This is a logically autonomous part of story 17. The transcript keeps
word-aligned selection; the main timeline uses an exact time range instead of
snapping the drag to nearby words.

## Story 17 (detail) — Arbitrary time range

As a user, I want to drag an exact time range on the waveform, so I can create a
manual mark that is not tied to word boundaries.

- `Shift`+drag on the main timeline sets `timeSelection: { start, end }` with
  the exact dragged edges, clamped to the recording.
- The timeline does not jump the selection to the nearest word.
- `wordsInRange(words, start, end)` collects only words that overlap the area;
  it may be empty for a selection inside silence.
- `M` or «＋ метка» creates a normal manual mark with the exact selection bounds
  and the existing `ManualMark` model. No pause tokens are required for this.
- Manual grouping is unchanged: the new mark goes through
  `mergeMarkNeighbours` and absorbs touching or overlapping marks into one
  logical group. `reconcileConfirmedIds` still runs.
- `Shift+Enter` / `Shift+R` on a time selection apply to defects that overlap
  the area; `Esc` clears the time selection.
- The transcript still uses word selection and `M` still creates a mark with
  exact word boundaries there.

## Pause tokens (deferred)

Generated pause tokens remain in `docs/BACKLOG.md`. They are not needed for an
arbitrary manual mark: `ManualMark.start/end` already store floating-point
bounds and `wordIds` can be a subset or empty. A future token entity can be
added without changing the selection or grouping rules above.

## Acceptance criteria

- [ ] `Shift`+drag produces exact `start/end`, not word-snapped bounds.
- [ ] The range is clamped to the recording and works in either direction.
- [ ] `wordsInRange` returns only overlapping words and handles empty ranges.
- [ ] `M` creates a manual mark with the exact area bounds.
- [ ] Touching/overlapping existing marks still merge into a logical group.
- [ ] `Shift+Enter` / `Shift+R` use defects overlapping the time range.
- [ ] `Esc` clears the range selection.
- [ ] The transcript keeps word-based selection and word-exact marks.
- [ ] Unit tests cover range normalization, exact bounds, word membership and
      defect overlap.

### Out of scope

- Splitting or re-recognizing audio.
- Changing `Word` ids.
- Rendering pause tokens as words in the transcript.

## Verification

- `test/selection.test.ts` covers range normalization, exact mark bounds,
  `wordsInRange` and `defectIdsInRange`.
- `test/marks.test.ts` covers logical grouping and confirmation reconciliation.
- Trackpad and pointer behaviour need a real macOS run.
