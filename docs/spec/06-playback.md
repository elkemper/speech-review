# 06 — Playback and skip

[Index](../SPEC.md) · Prev: [05 — Transcript](05-transcript.md) · Next:
[07 — Layout, history, visual](07-layout-history-visual.md)

**Files:** `src/renderer/src/components/Player.tsx`,
`src/renderer/src/player.ts`, `src/renderer/src/skip.ts`,
`src/renderer/src/store.ts`.
**Tests:** `test/skip.test.ts`, `test/marks.test.ts`.

## Stories

### Story 25 — Skip rules

**Status:** Done · **Priority:** P0

As a user, I want fast-forward to cut every defect and manual mark except
deleted ones, and to treat a logical group as one item.

- `buildSkipIntervals` uses every non-dismissed defect and manual mark.
- A revealed minimum-duration candidate is a temporary defect, so it is cut
  while it is active and stops being cut after switching away.
- Confirmation does not decide whether an item is cut. It freezes the cut range
  at confirmation time (story 50): later padding changes do not move a
  confirmed defect, and a deleted defect keeps its status because automatic ids
  are stable (story 51).
- Deleted automatic defects and manual marks are absent from the cut list.
- Disabled mode yields no intervals.
- Logical manual/automatic groups are already one defect and one interval.
- `K` toggles the mode from the workspace.

### Story 26 — Per-type and group padding, pause room tone

**Status:** Done · **Priority:** P1

As a user, I want padding per type and per group, independent of whether
fast-forward is on, and a pause that is shortened without gluing words
together.

- `playback.paddingByType[type]`, `playback.groupPadding`.
- Global `skipBeforeSec`/`skipAfterSec` are fallback.
- `playback.pauseKeepSec` keeps room tone inside a standalone pause: 0.4 s by
  default, split evenly between both edges. `0` removes the whole silence.
- The pause type padding applies on top of the keep and can widen the cut into
  the kept silence.
- A derived pause cut shorter than 0.2 s is not performed, and a pause shorter
  than the kept silence is left untouched. An explicit `cutOverrides` range is
  honoured even when shorter.
- A grouped pause uses `groupPadding`, not the keep.
- `Project.cutOverrides[defectId]` is the final cut. It wins over every padding
  setting; double-clicking a handle deletes it and restores the derived cut.
  A confirmed defect stores a `pinned` override instead (story 50): the range is
  frozen at confirmation and a double-click re-pins the derived range.
- `buildCutList` is independent of `skipEnabled` and feeds the timeline
  hatching, the mini timeline, JSON export and video export. `buildSkipIntervals`
  is `skipEnabled ? buildCutList : []`.
- The timeline fill is the original defect; the handles are the final cut. The
  gap is hatched: padding outside the fill in the defect type color, kept
  room tone inside it as a neutral track-background hatch (a slightly lighter
  shade of the background) because that part still plays.
- Defaults: pause `0/0`, filler `0.1/0.2`, group `0.15/0.35`.
- Padding is clamped to 0–5 s and to the recording; the keep is clamped to
  0–3 s.
- Settings remain editable when `skipEnabled` is false.
- Padding changes are undoable together with the cut ranges they produce
  (story 47).

### Story 27 — Listen starts playback

**Status:** Fix now · **Priority:** P0

As a user, I want "прослушать" in the defect list to actually start playback,
not only move the playhead.

- Seeks to a short pre-roll.
- Calls `play()` and reflects the playing state.
- Skip bypass is active for the listened defect.
- Works when paused and when already playing.
- A rejected play promise is surfaced, not swallowed.
- No proxy file.

### Story 28 — Fast-forward robustness

**Status:** Fix now · **Priority:** P0

As a user, I want fast-forward to survive overlapping/adjacent intervals and
never freeze.

- Intervals are merged before playback.
- Never reassign `currentTime` to the same value.
- After a seek wait for progress, then resume skipping.
- If a jump does not advance, recover or pause with a visible state.
- Listen bypass expires and does not disable skipping permanently.

### Story 29 — Clean playback without marked places

**Status:** Backlog · **Priority:** P2 / Decision needed

As a user, I want a separate mode that plays the recording without any marked
places, with per-cut padding, without rendering a proxy or a new file.

Detail: [`06a-clean-playback.md`](06a-clean-playback.md).

### Story 30 — Bookmarks

**Status:** Done · **Priority:** P1

As a user, I want bookmarks so I can remember where I stopped and resume later.

- `B` or the player button adds a bookmark at the current time.
- Header shows the count and opens the list.
- Click seeks; note/delete; "continue from last".
- Persist in `project.json`; survive partial transcripts.
- Not in history, skip or export.

## Acceptance criteria

### Story 25

- [ ] Every non-dismissed defect and manual mark is skipped.
- [ ] A revealed candidate is skipped only while it stays active.
- [ ] Confirmation does not change the cut list.
- [ ] Deleted items are not in the cut list.
- [ ] Logical group is skipped/played as one.
- [ ] Disabled mode returns `[]`.
- [ ] `K` toggles fast-forward and the player button state follows.

### Story 26

- [ ] Per-type padding is used; group padding for groups; global fallback.
- [ ] A standalone pause keeps `pauseKeepSec` of silence split across both
      edges; `0` removes the whole silence.
- [ ] A derived pause shorter than the keep or a cut shorter than 0.2 s is not
      cut; an explicit override is honoured.
- [ ] A grouped pause uses group padding and is not affected by the keep.
- [ ] An explicit cut override wins over padding and survives settings changes.
- [ ] Double-clicking a handle deletes the override and restores the derived
      cut.
- [ ] Padding is clamped to duration.
- [ ] Overlapping ranges merge.
- [ ] `buildCutList` works with skip mode off; `buildSkipIntervals` is empty.
- [ ] Changing padding while paused affects the next skip.
- [ ] Deleted items remain unskipped.
- [ ] Controls work while skip is off.
- [ ] Undo/redo restores padding and recalculates cuts.

### Story 27

- [ ] The button starts playback.
- [ ] Playing state updates in the UI.
- [ ] Skip bypass covers the listened defect.
- [ ] Works from paused and playing states.
- [ ] `play()` rejection is reported.
- [ ] No proxy is created.

### Story 28

- [ ] Overlapping/adjacent intervals merge.
- [ ] `currentTime` is not reassigned to its current value.
- [ ] Seeking waits before the next skip decision.
- [ ] A failed jump recovers or pauses visibly.
- [ ] Skip bypass expires.
- [ ] Tests cover merged overlaps and next-target lookup.

### Story 29

- [ ] Parent story for `06a`; detail lives there.
- [ ] Do not implement without explicit approval because of invariant 6.

### Story 30

- [ ] `B` adds a bookmark.
- [ ] Header count/list works.
- [ ] Click seeks and closes the list.
- [ ] Note and delete work.
- [ ] "Continue from last" seeks to the latest bookmark.
- [ ] Persist across reloads and partials.
- [ ] Excluded from history, skip and export.

## Verification

- `test/skip.test.ts` covers padding, pause room tone, cut overrides, cut view,
  minimum cut, dismissed filtering, merging, lookup and complement ranges.
- Add a pure "next target" helper test for story 28.
- Real playback and listen need a macOS run.