# 03 — Manual marks and confirmation

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

- Click selects one word; `Shift`+click extends; dragging in the transcript
  selects a range.
- The main timeline uses exact time selection (story 17), not word snapping.
- `M` creates one mark with all selected ids.
- The selection badge shows the count and offers confirm/delete actions.

### Story 10 — Logical marks

**Status:** Done · **Priority:** P0

As a user, I want adjacent marks to become one logical mark that can be
confirmed once, split back, and merged again when a cut handle reaches another
mark.

- Shared `groupId`; id `manual-group-${groupId}`.
- Merge on add and when a cut handle captures a neighbour.
- Split removes `groupId`, keeps words and copies the group note to each mark.
- Delete removes the whole group, its notes and confirmation ids.
- Old adjacent marks do not merge until one is added/moved.

### Story 11 — Bulk confirmation and deletion of a selection

**Status:** Done · **Priority:** P1

As a user, I want to confirm or delete every defect in a word selection in one
action.

- `Shift+Enter` confirms all defects touched by the word selection (transcript)
  or by the exact timeline range.
- `Shift+R` deletes all defects touched by the selection.
- Toolbar and defect panel show both counts and explicit buttons.
- A selection with no defects reports that.
- Each bulk action is one history entry.

### Story 12 — Cut editing and overrides

**Status:** Done · **Priority:** P1

As a user, I want to drag the handles of the selected defect/mark on the
timeline and control the final cut, while the original detected/marked span
stays visible as the fill.

- Every defect uses `Project.cutOverrides[defectId]` for the final cut.
- `Defect.start/end` and `ManualMark.start/end` are the original span; handles
  do not move them.
- A manual mark's cut handle can capture a neighbouring mark: the marks join a
  logical group, the handle becomes the group cut, and every nested cut
  override is dropped.
- The fill is the original defect, the cut is the handle range, and the gap is
  hatched (padding in the type color outside, neutral background hatch inside).
- Double-clicking a handle deletes the override and restores the derived cut.
- Undoable and saved.
- The active item also shows an in-panel snippet with the same cut handles:
  [story 40](10-mini-timeline.md).

### Story 13 — Confirmation-state reconciliation

**Status:** Done · **Priority:** P0

As a user, I want confirmed state to survive merge, split and cut capture
without silently confirming new marks.

- `reconcileConfirmedIds(before, after, confirmedIds)`.
- New mark is never confirmed.
- Merged confirmed + unconfirmed = unconfirmed group.
- Split confirmed group = all parts confirmed.
- Removing a mark removes its confirmation ids and notes.
- Automatic ids are never removed by manual reconciliation.

### Story 45 — Defect card confirmation and deletion

**Status:** Done · **Priority:** P1

As a user, I want each defect card to have explicit **delete** and **confirm**
actions, so I can decide the fate of a defect without treating the checkmark as
"not a defect".

- Every unconfirmed card has a left rail with a red trash button and a green
  check button; delete sits above confirm.
- `Enter` confirms the active defect, `R` deletes it. `Shift+Enter` / `Shift+R`
  apply the same action to the selection.
- Confirming collapses the card into a compact row: time, type, duration, plus a
  right-side undo button. The item stays in the project and export and is cut in
  skip mode like every non-deleted item.
- Deleting a manual mark moves it to `Project.dismissedMarks`; deleting an
  automatic defect adds its ID to `Project.dismissedDefectIds`. Deleted items
  are excluded from export and skip mode but remain as thin cards with a
  restore button when `showDismissed` is on.
- The card header is time · type — cut duration (up to two decimals, `с.`). The
  separate severity/confidence badge and the boundary hints are removed.
- The mini-timeline loses its "границы дефекта" label and the zoom percentage;
  zoom stays on −/+ and resets on double-click.
- In skip mode, cards keep their actions. Pending cards retain the left rail;
  confirmed and deleted cards retain the right-side undo button.
- Confirming or deleting a card in skip mode collapses it exactly like outside
  skip mode. A compact card never shows its hidden text, including on hover.
- The automatic group marker («группа · N») stays visible in skip mode.
- The panel has no skip-mode annotation. While playback is running,
  confirm/delete/mark hotkeys are blocked; on pause they work again.
- The panel's "только непроверенные" checkbox is removed. Settings has
  `showDismissed` for deleted cards only.
- A revealed minimum-duration candidate uses the same pending card with a
  «кандидат» badge. It is not exported or counted until promoted.

### Story 50 — Review decisions freeze the cut

**Status:** Done · **Priority:** P1

As a user, I want a defect I already reviewed to keep its cut when I tune the
padding settings afterwards, so a confirmed or deleted decision never silently
changes under me.

- Confirming a defect writes a **pinned** cut: `Project.cutOverrides[id] =
  { start, end, pinned: true }` with the derived range at that moment.
  `cutRangeFor` already honours any override, so the pinned range wins over
  every padding field until it is removed.
- A defect that is not cut at all when confirmed (for example a pause shorter
  than the kept room tone) is pinned as an empty range, so later padding cannot
  start cutting it.
- Removing the confirmation drops **pinned** overrides only; a range dragged by
  hand is not pinned and survives.
- Dragging a handle writes an unpinned override. Double-clicking a handle on a
  confirmed defect re-pins the freshly derived range instead of unfreezing it.
- A confirmed manual mark or logical group keeps its pin across merge and split
  (`reconcileManualPins`); only the affected ids are touched.
- Deleting a defect stores its id in `dismissedDefectIds` / `dismissedMarks` as
  before. Because automatic ids are now stable (story 51), the deletion keeps
  pointing at the same defect when rules change, so a deleted item stays
  deleted and is never re-evaluated by new settings.
- Confirmation still does not decide *whether* an item is cut: it only freezes
  the range. Dismissed items remain uncut.
- Pinning is not applied retroactively: a defect confirmed before this change
  has no pinned override and keeps following the padding until it is confirmed
  again.
- Undo restores both the confirmation and the pin in one entry.

### Story 51 — Stable automatic defect ids and versioned migrations

**Status:** Done · **Priority:** P0

As a user, I want my review decisions to survive rule changes, and an old
project to open without losing them.

- Automatic ids are `auto-${type}-w${wordIds.join('_')}`. The id depends on the
  type and the covered words, not on detection order, so toggling a type,
  changing a filler word or moving a threshold never moves a decision onto
  another defect.
- When one word produces two defects of the same type, the second gets a `-2`
  suffix in detection order; the base id stays stable.
- `detectDefectsWithCandidates` also returns `matches`: every rule match in
  detection order, before filtering. Migrations use it to recover the old
  numbering.
- `project.json` and `settings.json` carry `schemaVersion`. `runMigrations`
  (`src/shared/migrations.ts`) applies named, pure, idempotent steps in order;
  a file without a version is version 0.
- Project steps (`src/shared/projectMigrations.ts`):
  - v1 folds the legacy `reviewedDefectIds` / `defectOverrides` fields and
    archives deleted manual marks;
  - v2 rewrites order-based automatic ids in `confirmedDefectIds`,
    `dismissedDefectIds`, `defectNotes` and `cutOverrides`, and in
    `auto-group-*` ids.
- The old counter included disabled types and below-threshold candidates, so v2
  re-runs detection with the filters neutralised. An id it cannot resolve is
  kept unchanged rather than dropped.
- `loadProject` migrates once and writes the upgraded file back. A project whose
  rules were edited after detection may not reproduce its old numbering; the
  unresolved ids stay as-is.
- Settings steps (`src/shared/settingsMigrations.ts`): v1 renames the legacy
  `reviewed` CSV column to `confirmed`. Defaults and clamping stay in
  `normalizeSettings`.


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
- [ ] Dragging a cut handle onto another mark merges.
- [ ] Group is confirmed/deleted as a whole.
- [ ] Split preserves words and notes.
- [ ] Old adjacent marks do not re-merge on render.

### Story 11

- [ ] `Shift+Enter` confirms every touched defect.
- [ ] `Shift+R` deletes every touched defect.
- [ ] The toolbar counts and buttons match.
- [ ] The panel offers the same actions.
- [ ] No defects in the selection gives feedback.
- [ ] Each bulk action is one history entry.

### Story 12

- [ ] Selecting a defect/mark shows draggable cut handles.
- [ ] The same handles are editable in the in-panel snippet (story 40).
- [ ] Every cut edit goes to `cutOverrides`.
- [ ] `Defect.start/end` and `ManualMark.start/end` stay unchanged.
- [ ] A cut handle reaching a neighbour groups the marks and drops nested
      overrides.
- [ ] Double-clicking a handle resets the derived cut.
- [ ] Min length and duration clamps hold.
- [ ] Every change is undoable and saved.

### Story 13

- [ ] New marks are unconfirmed.
- [ ] Merge confirmed + unconfirmed = unconfirmed.
- [ ] Split confirmed = all parts confirmed.
- [ ] Delete removes confirmation id and notes.
- [ ] Automatic confirmation ids are untouched.

### Story 45

- [ ] Each unconfirmed card has delete and confirm buttons in a left rail.
- [ ] `Enter` / `R` confirm/delete the active defect.
- [ ] `Shift+Enter` / `Shift+R` confirm/delete the selection.
- [ ] A confirmed card collapses to a compact row and stays in export/skip.
- [ ] A deleted automatic defect is stored in `dismissedDefectIds` and is undoable.
- [ ] A deleted manual mark is stored in `dismissedMarks` and is undoable.
- [ ] The header shows time · type — cut duration with up to two decimals.
- [ ] Skip mode keeps card actions.
- [ ] Confirming/deleting in skip mode collapses the card like outside it.
- [ ] A compact card does not reveal its hidden text on hover.
- [ ] The automatic group marker stays visible in skip mode.
- [ ] No skip-mode hint annotation is shown.
- [ ] Confirm/delete/mark hotkeys work in skip mode only while paused.
- [ ] The panel no longer has "только непроверенные"; `showDismissed` remains in Settings.
- [ ] A revealed candidate shows the «кандидат» badge and full pending controls.

### Story 50

- [ ] Confirming writes a pinned override with the current derived range.
- [ ] Changing padding does not move a pinned cut.
- [ ] An uncut defect is pinned as an empty range and stays uncut.
- [ ] Removing the confirmation drops pinned overrides and keeps hand-dragged ones.
- [ ] Double-click on a confirmed defect's handle re-pins the derived range.
- [ ] A confirmed manual mark keeps its pin across merge and split.
- [ ] A defect confirmed before pinning existed is not pinned retroactively.
- [ ] The confirmation and its pin are undone together.

### Story 51

- [ ] Automatic ids are `auto-${type}-w${wordIds}` and unique per pass.
- [ ] Changing filler words, thresholds or type toggles keeps other ids.
- [ ] A candidate has the same id as its promoted defect.
- [ ] `matches` lists every rule match in detection order.
- [ ] `runMigrations` runs steps in order, skips applied ones and is idempotent.
- [ ] Project v1 folds legacy review fields; v2 rewrites automatic ids.
- [ ] Unresolvable ids are kept, never dropped.
- [ ] `loadProject` writes the upgraded file once.
- [ ] Settings v1 renames the `reviewed` export column.

## Verification

- `test/defectCardView.test.ts`, `test/marks.test.ts`, `test/core.test.ts`, `test/selection.test.ts`.
- Add the exact-mark regression from story 8 before changing selection code.