# 14 — Defect table window

[Index](../SPEC.md) · Prev: [13 — Review panel](13-defect-panel.md)

The defect table is a second, non-modal window that shows the exportable defect
list the way the CSV looks when opened in Excel. It is a passive mirror of the
main window: the main window owns the project, the table only renders a snapshot
and sends edits back as commands. This keeps one source of truth for ids,
grouping, confirmation, cut overrides, history and autosave.

**Files:** `src/shared/defectTable.ts`, `timeInput.ts`, `exportRows.ts`,
`cutEdit.ts`, `manualMarkAdd.ts`, `src/main/index.ts`, `src/main/ipc.ts`,
`src/preload/index.ts`, `src/shared/ipc.ts`, `src/shared/api.ts`,
`src/renderer/src/main.tsx`, `src/renderer/src/defectTableBridge.ts`,
`src/renderer/src/tableSelection.ts`, `tableColumns.ts`, `tableDraft.ts`,
`src/renderer/src/components/DefectTableApp.tsx`, `DefectTable.tsx`,
`AddTableRowDialog.tsx`, `DefectPanel.tsx`, `Workspace.tsx`, `store.ts`.
**Tests:** `test/timeInput.test.ts`, `test/exportRows.test.ts`,
`test/cutEdit.test.ts`, `test/manualMarkAdd.test.ts`,
`test/tableSelection.test.ts`, `test/tableColumns.test.ts`,
`test/tableDraft.test.ts`.

## Stories

### Story 56 — Excel-like table of exported rows

**Status:** Done · **Priority:** P1

As a user, I want a spreadsheet-like window with the exported defect rows, so I
can review, edit and clean up the list quickly and always see which defect is
being reviewed in the main window.

- The entry point is **«Таблица…»** in the defect-panel footer next to CSV and
  JSON. It opens one non-modal window and focuses it on repeated clicks.
- The window closes with the project and with the main window; without the main
  window there is no state owner.
- Columns are `ExportSettings.fields` in their configured order. Header labels
  are localized with `exportFieldLabel`; `includeHeader` only affects the CSV.
  Cell values are `exportValue` — the same values the CSV contains, without
  quoting, so `type`/`severity`/`source`/`cut`/`confirmed` stay English.
- A frozen row-number column (1…N) and a frozen header. The grid uses its own
  `.defect-grid` class; it must not reuse `.defect-table`, which is the settings
  rules table and lays out as flex.
- Widths are dragged from the right border of a header and persisted in
  `localStorage` (`sr.tableColumns`); a double-click resets that column. The
  header width and the stored width are the same value: each `<col>` and
  `<th>` gets the width and the table width is their sum.
- Rows are exactly the export rows: every non-dismissed defect and manual mark,
  without transient minimum-duration candidates. The display-only type filter of
  the panel does not affect the table, matching CSV/JSON/video export.
- Selection: click one row, Cmd/Ctrl+click toggles, Shift+click selects an
  inclusive range from the anchor, Cmd/Ctrl+A selects all, `Esc` clears. A
  selection pointing at rows that a new snapshot no longer contains is pruned.
- **Clicking a row activates it in the main window**: the card is focused, the
  display filter is cleared, the player seeks to the defect start and the main
  window follows playback. The active defect is mirrored back: the row is
  highlighted and scrolled into view when the user selects a card, a word or a
  timeline marker, or moves with `[`/`]`.
- **Dragging over the row-number column** selects the same inclusive range as
  Shift+click: pressing on one number and dragging to another extends the range.
  The click that follows the drag does not collapse the selection. Dragging is
  only started from the number column, so it never interferes with cell editing.
- **Delete** (toolbar button, `Delete`/`Backspace`) applies the panel's
  `removeDefects`: automatic ids are dismissed together with their group
  members, manual marks move to `dismissedMarks`. There is no confirmation, as
  in the panel. A toast points at the main window for undo; it is shown only
  after the main window confirms the delete, and a rejected command shows an
  error toast instead.
- **Undo/redo buttons** sit in the toolbar and reflect `canUndo`/`canRedo` from
  the main window's history. They call the normal `undo`/`redo`, so they are the
  same actions as in the main window, not a second history.
- **Add row** inserts an editable draft row, not a modal dialog:
  - below the last selected row, or where a row at the main player's playhead
    would sort when nothing is selected;
  - its start defaults to the selected row's cut end (or the playhead) and its
    end to start + 1 s, clamped to the recording;
  - start, end and note are typed in their visible columns; the other columns
    preview the future row (`manual`, `medium`, `manual`, `no`, `yes`, the same
    text and defect bounds as the export);
  - the draft is saved as a normal `ManualMark` when focus moves to another row
    or another control, or on Enter; `Esc` discards it;
  - an invalid draft stays open, marks the field, refocuses it and shows the
    validation message — the row is not created until it is valid;
  - a draft is local to the table window and is never sent before it commits.
  - The "row added" toast appears only when the main window confirms the add; a
    rejected command (for example stale bounds) shows an error toast.
  - If the export columns have no start/end pair, the old modal dialog is used
    as a fallback.
- An added row is a normal `ManualMark`. It runs `mergeMarkNeighbours`,
  `reconcileConfirmedIds` and `reconcileManualPins` through the shared
  `addManualMark` core, so the existing mark rules are not duplicated. The typed
  range is also written as an explicit cut override, so the cut columns show
  exactly what was entered. If the mark merges into a logical group the override
  is skipped: the group is cut by its `groupPadding`, otherwise only part of the
  group would be removed.
- **Editable cells:** the note and the cut time columns (`start_tc`, `end_tc`,
  `start_sec`, `end_sec`, `duration_sec`). Double-click starts, Enter/Tab/blur
  commits, `Esc` cancels. A note commit calls `setNote`; a cut commit calls
  `setCutBounds` with the edited edge, exactly as a timeline handle.
  `duration_sec` keeps the start.
  - A cut edit is validated by `cutEditFor`, which rejects inverted, negative,
    too short and out-of-range values instead of clamping them. The table sends
    the edge and value; the main window resolves the other edge from its current
    state, so a stale snapshot cannot overwrite a concurrent change.
  - An uncut row (for example a standalone pause shorter than the kept room
    tone) has empty time cells that are still editable: the other edge comes
    from the defect bounds, so a typed start creates a cut to the defect end and
    a typed end creates a cut from the defect start. Closing the cell unchanged,
    including typing the same moment in another accepted format, keeps the row
    uncut.
  - An invalid value stays in the open editor with the field highlighted and the
    error toast; the typed text is not discarded. `Esc` closes it.
  - `defect_start_*`, `defect_end_*` and `defect_duration_sec` are read-only:
    they describe detection or the mark and do not move with the cut.
  - `type`, `severity`, `source`, `confirmed`, `cut` and `text` are read-only.
- **Note copy/paste:** a single click on a note cell focuses it; Cmd/Ctrl+C
  copies its note to the system clipboard, and Cmd/Ctrl+V on another focused
  note cell replaces that note (an empty paste clears it). The DOM `copy`/`paste`
  events are used, because the macOS Edit menu roles dispatch them; editors and
  inputs keep their native behaviour.
- An open cell editor survives a snapshot with the same row; it closes if the
  row or the column disappears (undo, partial transcript, deletion in the main
  window).
- **Theme:** a toolbar button switches this window between dark and light. The
  choice is stored as `sr.tableTheme` in `localStorage`, applied as
  `data-theme="light"` on the window's own document, and is independent of the
  main window, which always stays dark. It is UI-only: it never enters settings,
  the project or undo/redo. The first paint already uses the stored theme.
- The window shows the project name, row count and selected count. An empty
  table distinguishes "no transcript yet" from "no rows left".
- No project schema changes or migrations: column widths are UI-only and never
  enter the project or undo/redo. No new dependencies.

## Acceptance criteria

### Story 56

- [ ] «Таблица…» opens one separate window and focuses it when already open.
- [ ] Columns follow `settings.export.fields`; headers are localized.
- [ ] Row numbers are shown and stay visible while scrolling horizontally.
- [ ] Dragging a header border changes that column's width, the width persists,
      and the header/text do not lag behind the stored width.
- [ ] Rows are the CSV export set; the type filter does not hide rows.
- [ ] Click, Cmd/Ctrl+click, Shift+click, Cmd/Ctrl+A and a drag on the row
      numbers select rows correctly.
- [ ] Clicking a row seeks the main player and highlights the panel card; the
      main window's active defect highlights and scrolls to the row.
- [ ] Deleting rows removes them from skip intervals, CSV/JSON and video export
      exactly like the panel's delete.
- [ ] Adding a row opens a draft below the selected row (or at the playhead
      position), saves on leaving it, and validates before creating the mark.
- [ ] An invalid draft stays open with the field highlighted; nothing is added.
- [ ] A note edit updates the defect note and, for a manual mark, the mark note.
- [ ] Cmd/Ctrl+C then Cmd/Ctrl+V copies a note into another note cell, replacing
      the old value.
- [ ] A cut edit updates the cut columns and skip intervals; invalid input shows
      an error and changes nothing, keeping the typed value open for correction.
- [ ] A `duration_sec` edit is treated as moving the end only, so it cannot
      group a neighbouring mark that the untouched start happens to reach.
- [ ] Add and delete toasts appear after the main window confirms the command,
      and a rejected command shows an error instead of success.
- [ ] Undo/redo buttons apply the main window's history and disable correctly.
- [ ] The theme button switches only the table window; the main window stays
      dark and the choice survives reopening the table.
- [ ] `defect_*` columns and all non-time/non-note columns are read-only.
- [ ] The table never writes project files or history directly; every edit is
      applied by the main window's store actions.
- [ ] Closing the project or the main window closes the table.
- [ ] Interface language changes update the table's headers and title.
- [ ] No new dependency and no schema migration; the theme is UI-only.

## Verification

- `test/timeInput.test.ts` covers accepted time formats, malformed input and
  comparing two time texts at display precision.
- `test/exportRows.test.ts` covers the export set, derived and overridden cuts,
  uncut pauses and immutability of the input defects.
- `test/cutEdit.test.ts` covers both edges, duration edits, the edge a duration
  edit moves, uncut fallbacks and every rejection path.
- `test/manualMarkAdd.test.ts` covers the shared mark core: standalone marks,
  exact cut overrides, notes in `defectNotes` and `ManualMark.note`, merging,
  confirmation reconciliation and frozen-cut cleanup.
- `test/tableSelection.test.ts` covers replace/toggle/range, stale anchors,
  select-all, pruning and the playhead insertion index.
- `test/tableColumns.test.ts` covers width normalization, per-field defaults,
  the total width and the columns an inline draft edits.
- `test/tableDraft.test.ts` covers validation, default bounds, field formatting
  and the draft position below the selection or at the playhead.
- `test/tableTheme.test.ts` covers the stored theme value: only `light` opts in.
- The multi-window runtime (creation, IPC relay, active sync, window closing),
  the DOM clipboard events, the drag selection and the light theme's visual
  pass need a manual `npm run dev` on macOS.
