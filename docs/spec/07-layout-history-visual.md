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

As a user, I want undo/redo with a log covering marks, review state, notes and
defect overrides.

- `Cmd+Z` / `Ctrl+Z` undo; `Shift+Cmd+Z` / `Ctrl+Y` redo.
- History dialog lists actions with timestamps and supports jumping.
- Same `mergeKey` within 2 s coalesces.
- Snapshot = marks + reviewed ids + notes + overrides only.
- Bookmarks, playback, selection, filters, transcript and settings excluded.
- History resets when a project is opened/closed.

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

- [ ] Undo/redo works for marks, review, notes, overrides.
- [ ] The dialog lists actions and jumps correctly.
- [ ] Merge key coalesces within 2 s.
- [ ] Only editable project state is snapshotted.
- [ ] Bookmarks/playback/selection/filters/settings are not snapshotted.
- [ ] History resets on project change.
- [ ] Tests cover index math and coalescing (`test/history.test.ts`).

### Story 33

- [ ] Parent story for `07a`; detail lives there.
- [ ] Do not mix the refresh with functional fixes.
- [ ] Dark-only, no behaviour change.

### Story 34

- [ ] No light theme is added.
- [ ] New UI uses existing variables and keeps contrast.
- [ ] Defect colors and waveform remain readable.

## Verification

- `test/history.test.ts` covers undo/redo and merge keys.
- Panel resize and visual changes need a macOS run.