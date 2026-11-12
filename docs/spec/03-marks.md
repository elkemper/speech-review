# 03 — Manual marks and review

[Index](../SPEC.md) · Prev: [02 — Defects](02-defects.md) · Next:
[04 — Timeline](04-timeline.md)

**Files:** `src/shared/marks.ts`, `src/renderer/src/selection.ts`,
`src/renderer/src/store.ts`, `src/renderer/src/history.ts`.
**UI:** `Transcript.tsx`, `DefectPanel.tsx`, `Timeline.tsx`.

## Stories

### Story 8 — Exact manual mark

**Status:** Fix now · **Priority:** P0

As a user, I want a manual mark to contain exactly the word(s) I selected, not a
neighbouring word.

- With a selection, `M` uses the exact `wordIds` and the first word's start /
  last word's end.
- Without a selection, the playhead fallback is used and `wordIds` are stored
  explicitly.
- Logical grouping may widen the *group* span; the underlying mark still keeps
  its own `wordIds`.
- `markRangeForSelection` + `findWordIdsInRange` use strict overlap.
- Regression test required (no e2e).

### Story 9 — Multi-word selection and marks

**Status:** Done (verify) · **Priority:** P1

As a user, I want to select several words and create one mark over all of them.

- Click selects one word; `Shift`+click extends; dragging selects a range.
- Selection works in the transcript and on the timeline.
- `M` creates one mark with all selected ids.
- The selection badge shows the count and offers mark/review actions.

### Story 10 — Logical marks

**Status:** Done · **Priority:** P0

As a user, I want adjacent marks to become one logical mark that can be
reviewed once, split back, and merged again when a boundary reaches another
mark.

- Shared `groupId`; id `manual-group-${groupId}`.
- Merge on add and on boundary move only.
- Split removes `groupId`, keeps words and copies the group note to each mark.
- Delete removes the whole group, its notes and review ids.
- Old adjacent marks do not merge until one is added/moved.

### Story 11 — Bulk review of a selection

**Status:** Done · **Priority:** P1

As a user, I want to mark every defect in a word selection as reviewed in one
action.

- `Shift+R` reviews all defects touched by the selection (transcript or
  timeline).
- Toolbar and defect panel show the count and an explicit button.
- A selection with no defects reports that.
- One history entry for the whole action.

### Story 12 — Manual boundary editing and overrides

**Status:** Done · **Priority:** P1

As a user, I want to drag the boundaries of the selected defect/mark on the
timeline and have word membership follow.

- Automatic defect: store `Project.defectOverrides[defectId]`.
- Manual mark: update `start`/`end`, recompute `wordIds` with strict overlap.
- Dragging onto a neighbour merges the mark into a logical group.
- Boundaries cannot cross or invert; minimum length is preserved.
- Undoable and saved.

### Story 13 — Reviewed-state reconciliation

**Status:** Done · **Priority:** P0

As a user, I want reviewed state to survive merge, split and boundary moves
without silently reviewing new marks.

- `reconcileReviewedIds(before, after, reviewedIds)`.
- New mark is never reviewed.
- Merged reviewed + unreviewed = unreviewed group.
- Split reviewed group = all parts reviewed.
- Removing a mark removes its review ids and notes.
- Automatic ids are never removed by manual reconciliation.

## Acceptance criteria

### Story 8

- [ ] `mark.wordIds` equals exactly the selected words.
- [ ] `mark.start`/`mark.end` equal the first/last selected word boundaries.
- [ ] A single-word mark never includes the previous or next word.
- [ ] When grouped, the underlying mark still keeps only its own words.
- [ ] Regression: select a filler, create a mark, assert `wordIds === [fillerId]`.
- [ ] Regression: no selection falls back to playhead and stores explicit ids.

### Story 9

- [ ] Click selects one word; `Shift`+click extends from the anchor.
- [ ] Drag selects a contiguous range and seeks to its start.
- [ ] `M` creates one mark with all selected ids.
- [ ] Regression: a three-word range produces three `wordIds`.

### Story 10

- [ ] Adding next to an existing mark shares a `groupId`.
- [ ] Moving a boundary onto another mark merges.
- [ ] Group is reviewed/deleted as a whole.
- [ ] Split preserves words and notes.
- [ ] Old adjacent marks do not re-merge on render.

### Story 11

- [ ] `Shift+R` reviews every touched defect.
- [ ] The toolbar count and button match.
- [ ] The panel offers the same action.
- [ ] No defects in the selection gives feedback.
- [ ] Bulk review is one history entry.

### Story 12

- [ ] Selecting a defect/mark shows draggable boundaries.
- [ ] Automatic edits go to `defectOverrides`.
- [ ] Manual edits update marks and `wordIds`.
- [ ] Reaching a neighbour merges.
- [ ] Min length and duration clamps hold.
- [ ] Every change is undoable and saved.

### Story 13

- [ ] New marks are unreviewed.
- [ ] Merge reviewed + unreviewed = unreviewed.
- [ ] Split reviewed = all parts reviewed.
- [ ] Delete removes review id and notes.
- [ ] Automatic review ids are untouched.

## Verification

- `test/marks.test.ts`, `test/core.test.ts`, `test/selection.test.ts`.
- Add the exact-mark regression from story 8 before changing selection code.