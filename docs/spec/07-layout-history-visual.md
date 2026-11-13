# 07 — Layout, history and visual language

[Index](../SPEC.md) · Prev: [06 — Playback](06-playback.md) · Next:
[08 — Processing and progress](08-processing-progress.md)

**Files:** `src/renderer/src/components/Workspace.tsx`,
`src/renderer/src/components/HistoryDialog.tsx`,
`src/renderer/src/history.ts`, `src/renderer/src/styles.css`.

## Stories

### Story 31 — Resizable and hideable panels

**Status:** Done · **Priority:** P1

As a user, I want to resize the video, timeline, transcript area and defect
panel, and hide the defect panel completely.

- Video height draggable (`sr.videoHeight`).
- Timeline height draggable (`sr.timelineHeight`).
- Defect panel width draggable (`sr.panelWidth`).
- Transcript takes the remaining height.
- Defect panel hide/show (`sr.panelVisible`).
- Sizes persist in `localStorage`.

### Story 32 — Undo/redo with action log

**Status:** Done · **Priority:** P0

As a user, I want undo/redo with a log covering marks, confirmation state, notes,
defect overrides and project settings.

- `Cmd+Z` / `Ctrl+Z` undo; `Shift+Cmd+Z` / `Ctrl+Y` redo.
- History dialog lists actions with timestamps and supports jumping.
- Same `mergeKey` within 2 s coalesces.
- Snapshot = marks + confirmed ids + dismissed ids + notes + overrides + project
  rules + skip padding.
- Bookmarks, skip mode, playback, selection, filters, transcript, model/language,
  export and UI-only settings excluded.
- History resets when a project is opened/closed.
- While the settings dialog is open, undo/redo only covers settings changes
  recorded since it was opened; project edits are never rolled back from there.

### Story 33 — Professional desktop visual direction

**Status:** Backlog · **Priority:** P2

As a user, I want the app to look like a professional desktop tool from the
2010s–2020s (Photoshop/Audacity 3), not a generic AI app.

Detail: [`07a-visual-refresh.md`](07a-visual-refresh.md).

### Story 34 — Dark theme only

**Status:** Done (invariant) · **Priority:** P0

As a user, I want the app to stay dark-only.

- No light theme or switcher unless an explicit task asks for it.
- New components must use the existing CSS variables and contrast.

### Story 47 — Project settings in undo/redo

**Status:** Done · **Priority:** P1

As a user, I want changes to project rules and skip padding to be undone with
the defect list and skip intervals they recalculated.

- Snapshot includes `project.rules` and `playback.paddingByType`,
  `playback.groupPadding`, `playback.pauseKeepSec`, `playback.skipBeforeSec`,
  `playback.skipAfterSec`.
- `skipEnabled` is player state and stays out of history.
- Changing a rule or padding records one history entry; slider dragging
  coalesces through a per-field `mergeKey`.
- Undo/redo restores the project rules, the global settings copy and the
  editable review state in one update, then saves both files.
- While the settings dialog is open, undo/redo only covers settings entries
  recorded in that dialog session.
- Without an open project, the project-dependent Defects tab is disabled and
  the dialog falls back to General.
- During active recognition, the whole settings form is disabled.

## Acceptance criteria

### Story 31

- [ ] Video height is draggable.
- [ ] Timeline height is draggable.
- [ ] Defect panel width is draggable.
- [ ] Transcript uses the remaining height.
- [ ] Panel can be hidden and restored.
- [ ] Sizes persist in `localStorage`.
- [ ] Minimum sizes do not overlap/clip or make controls unreachable.

### Story 32

- [ ] Undo/redo works for marks, confirmation, deletion, notes, overrides.
- [ ] The dialog lists actions and jumps correctly.
- [ ] Merge key coalesces within 2 s.
- [ ] Only editable project state and project settings are snapshotted.
- [ ] Bookmarks, skip mode, playback position, selection, filters, model,
      language, export and UI-only settings are not snapshotted.
- [ ] History resets on project change.
- [ ] While settings are open, undo cannot cross its opening.
- [ ] Tests cover index math, coalescing and settings snapshots
      (`test/history.test.ts`).

### Story 33

- [ ] Parent story for `07a`; detail lives there.
- [ ] Do not mix the refresh with functional fixes.
- [ ] Dark-only, no behaviour change.

### Story 34

- [ ] No light theme is added.
- [ ] New UI uses existing variables and keeps contrast.
- [ ] Defect colors and waveform remain readable.

### Story 47

- [ ] Changing a rule adds one history entry and updates the defect list.
- [ ] Changing a padding adds one history entry and updates skip intervals.
- [ ] Undo/redo restores rules, paddings and review state together.
- [ ] `skipEnabled` does not change on undo/redo.
- [ ] `project.json` and `settings.json` are saved after undo/redo.
- [ ] History dialog labels name the changed rule or padding.
- [ ] With settings open, undo only covers changes made after opening it.
- [ ] Without a project, the Defects tab is disabled and General is selected.
- [ ] During recognition, the whole settings form is disabled.

## Verification

- `test/history.test.ts` covers undo/redo, merge keys, rules and padding
  snapshots; `test/settingsHistory.test.ts` covers labels and merge keys.
- Panel resize, settings locking and visual changes need a macOS run.
- Electron, real media and recognition are not verified in the Linux container.