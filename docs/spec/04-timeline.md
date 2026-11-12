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

### Story 16 — Skip and bookmark overlays

**Status:** Done · **Priority:** P1

As a user, I want skip ranges and bookmarks visible on the timeline.

- Skip intervals use the same data as playback (story 26).
- Reviewed items are not shown as skipped.
- Bookmarks render as green flags + dashed lines.
- Overlays update when padding/review state changes.

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
- [ ] Pause defects render as blocks; other defects as markers.
- [ ] Tests cover the thresholds and the hide-again case.

### Story 16

- [ ] Skip intervals are a distinct translucent overlay.
- [ ] Bookmarks are green flags with dashed lines.
- [ ] Reviewed items are not drawn as skipped.
- [ ] Overlays update after padding/review changes.
- [ ] Rendering does not block word drawing.

### Story 17

- [ ] Parent story for `04a`; the detailed criteria live there.
- [ ] Do not implement until the pause-token data model is approved.

## Verification

- `test/selection.test.ts` covers LOD math and boundary dragging.
- `test/skip.test.ts` covers interval merging.
- Trackpad behaviour needs a real macOS run.