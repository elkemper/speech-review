# 10 — Selected defect mini timeline

[Index](../SPEC.md) · Related: [03 — Marks](03-marks.md) (story 12),
[04 — Timeline](04-timeline.md) (story 16)

**Files:** `src/renderer/src/components/MiniTimeline.tsx`,
`src/renderer/src/miniTimeline.ts`, `src/renderer/src/components/DefectPanel.tsx`.
**Tests:** `test/selection.test.ts` (mini window and handle hit-testing).

## Story

### Story 40 — In-panel snippet with editable boundaries

**Status:** Done · **Priority:** P1

As a user, I want the selected defect/mark in the right panel to show a small
piece of the timeline under its text, so I can adjust its boundaries without
hunting for it on the main timeline.

- The snippet appears only for the active defect/mark.
- The visible window contains the defect with generous context (at least 4 s
  when the recording allows it; more for long defects).
- It shows the waveform, word ticks/labels where they fit, the defect span,
  both boundary handles and the playhead.
- Dragging a handle calls the same `setDefectBounds` action as the main
  timeline: automatic defects go to `defectOverrides`, manual marks update
  `start`/`end` and `wordIds`.
- Clicking/dragging inside the snippet seeks, so the playhead moves in the
  snippet, the main timeline and the player.
- Selection and boundary changes made on the main timeline are reflected in the
  snippet.
- The snippet has a fixed base window: **±3 s around the defect by default**,
  configurable in Defects (`miniTimelinePadSec`).
- Zoom runs from 1× (the whole base window, fully zoomed out) to 4× (content
  four times as large, a quarter of the base span visible).
- Above 1× the visible part can be panned horizontally inside the base window
  with the scrollbar, `Shift`+wheel or two-finger horizontal scroll. At 1× the
  view hits the edges and cannot scroll further.
- `Ctrl`/`Cmd`+wheel or trackpad pinch zooms around the pointer; the percentage
  button resets to 100%.
- Other defects/marks inside the window are drawn faintly for context. Their
  boundaries are lighter than the active ones but still faint. They are never
  interactive and cannot be dragged from this snippet.
- Marked words get a colored underlay using their defect/mark type
  ([story 41](04b-word-underlays.md)). The active mark is stronger; other marked
  words are faint. Pauses do not color words.

## Acceptance criteria

- [ ] The snippet is rendered under the defect text for the active item only.
- [ ] The window contains the defect and provides at least 4 s of context
      (clamped to the recording).
- [ ] The waveform is drawn from `peaks`; if peaks are missing, the snippet
      still renders the grid, defect span, words and playhead.
- [ ] Word ticks appear at the bottom; labels appear only when they fit.
- [ ] Both boundaries are visible and draggable.
- [ ] Dragging uses the same clamp/min-length rules as the main timeline.
- [ ] Manual mark edits update `wordIds`; automatic defects use overrides.
- [ ] Clicking the snippet seeks; the playhead is shared with the main
      timeline and player.
- [ ] External boundary edits (main timeline, undo) reframe the snippet.
- [ ] The snippet does not hijack the list item click/selection.
- [ ] Interaction works with a narrow panel (≥ 280 px).
- [ ] Default context is ±3 s on both sides, configurable in Defects.
- [ ] Zoom is clamped to 1×–4×; the percentage is shown and resettable.
- [ ] At 1× the whole base window is visible, the scrollbar is hidden and the
      view cannot pan past the edges.
- [ ] At >1× the content is enlarged and can be panned with a horizontal
      scrollbar, its thumb, `Shift`+wheel or two-finger horizontal scroll.
- [ ] Panning is clamped to the original base window (content up to four times
      as large at 4×, not an infinite timeline).
- [ ] Neighbouring defect boundaries are lighter than the active handles but
      still faint and non-interactive.
- [ ] Marked words have a colored underlay; active words are stronger, other
      marked words are faint, reviewed words are dimmer.
- [ ] `Ctrl`/`Cmd`+wheel or pinch zooms around the pointer; plain wheel keeps
      scrolling the list unless it is a horizontal gesture.
- [ ] Selecting another defect resets the snippet zoom to 100%.
- [ ] Neighbouring defects/marks are faint and non-interactive (no handles, no
      drag, no selection change).
- [ ] Unit tests cover the window clamps, time↔x mapping, handle hit-testing
      and zoom clamping.

## Out of scope

- Full zoom/pan inside the snippet (use the main timeline for large moves).
- Arbitrary waveform selection and pause tokens (story 17 / `04a`).
- A second independent playhead; both views always read the same store value.

## Verification

- Unit tests pass in the Linux container.
- Real drag/playhead behaviour must be checked on macOS, including a narrow
  defect panel and a trackpad.