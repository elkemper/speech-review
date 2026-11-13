# 04 — Timeline and waveform

[Index](../SPEC.md) · Prev: [03 — Marks](03-marks.md) · Next:
[05 — Transcript](05-transcript.md)

**Files:** `src/renderer/src/components/Timeline.tsx`,
`src/renderer/src/timelineView.ts`, `src/renderer/src/skip.ts`,
`src/renderer/src/player.ts` (playhead only).
**Tests:** `test/selection.test.ts`, `test/skip.test.ts`.

## Stories

### Story 14 — Zoom and pan (mouse and trackpad)

**Status:** Next · **Priority:** P1

As a user, I want to zoom and pan the waveform with a mouse or trackpad,
anchored at the pointer.

- `Ctrl`/`Cmd` + wheel and trackpad pinch zoom around the cursor.
- Two-finger horizontal scroll pans.
- Two-finger vertical scroll pans the timeline, not the page.
- `+`, `−`, `⤢` duplicate the actions.
- Manual navigation turns follow off.
- Zoom is clamped to the recording.

### Story 15 — Progressive detail (LOD)

**Status:** Next · **Priority:** P1

As a user, I want the timeline to reveal detail gradually instead of showing
either everything or nothing.

Priority order:
1. Defect markers (always visible, even when the whole recording is zoomed
   out).
2. Word tick marks at medium zoom.
3. Word labels at close zoom, only where the label fits.
4. Labels disappear again when the view becomes denser.

`timelineView.ts` owns the thresholds (`wordDetail`, `wordMarksVisible`,
`minWordLabelWidth`).

Label rows are fixed by the word index (`wordLabelRow`: even indexes on top,
odd below), never by the viewport. Scrolling or zooming therefore never makes
the tiles jump between rows. A tile is only skipped when the previous word in
the same row is closer than `LABEL_MIN_GAP_PX` (`labelHasRoom`); both rules are
pure and depend on the zoom level only through pixel widths.

Marked words also get a colored underlay by type: [story 41](04b-word-underlays.md).

The waveform itself is drawn with a display-only contrast curve so quiet speech
stays readable: [story 42](04c-waveform-contrast.md).

### Story 16 — Skip and bookmark overlays

**Status:** Done · **Priority:** P1

As a user, I want skip ranges and bookmarks visible on the timeline.

- Skip intervals use the same data as playback (story 26).
- Deleted items are not shown as skipped.
- Bookmarks render as green flags + dashed lines.
- Overlays update when padding or skip settings change.

### Story 17 — Arbitrary selection and pause tokens

**Status:** Backlog · **Priority:** P2

As a user, I want to select an arbitrary time range on the waveform and have
ad-hoc pause tokens generated when the edges do not match word boundaries.

Detail and acceptance criteria: [`04a-waveform-selection.md`](04a-waveform-selection.md).

## Acceptance criteria

### Story 14

- [ ] `Ctrl`/`Cmd` + wheel or pinch zooms around the pointer.
- [ ] Two-finger horizontal and vertical scrolling pans the timeline.
- [ ] The page does not scroll and no browser zoom is triggered.
- [ ] `+`, `−`, `⤢` behave the same and turn follow off.
- [ ] Zoom is clamped; no blank area beyond the recording.
- [ ] Panning does not fight the playhead or the follow mode.
- [ ] Trackpad momentum does not produce NaN or an empty view.

### Story 15

- [ ] At the widest zoom, defect markers are visible.
- [ ] At medium zoom, word ticks appear.
- [ ] At close zoom, labels appear only where they fit.
- [ ] Labels hide again when they no longer fit.
- [ ] Label rows depend on the word index: panning left/right never reshuffles them.
- [ ] Zooming never moves a visible label to the other row.
- [ ] A tile is skipped only when the previous word in its row is closer than 4 px.
- [ ] No per-word layout state is stored; the rows are a pure function of the index.
- [ ] Pause defects render as blocks; other defects as markers.
- [ ] Tests cover the thresholds and the hide-again case.
- [ ] Marked words use the type color as an underlay (story 41).
- [ ] Quiet speech stays visible and silence collapses to the baseline (story 42).

### Story 16

- [ ] Skip intervals are a distinct translucent overlay.
- [ ] Bookmarks are green flags with dashed lines.
- [ ] Deleted items are not drawn as skipped.
- [ ] Overlays update after padding or skip settings change.
- [ ] Rendering does not block word drawing.

### Story 17

- [ ] Parent story for `04a`; the detailed criteria live there.
- [ ] Do not implement until the pause-token data model is approved.

## Verification

- `test/selection.test.ts` covers LOD math and boundary dragging.
- `test/skip.test.ts` covers interval merging.
- Trackpad behaviour needs a real macOS run.