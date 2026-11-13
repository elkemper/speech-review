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
- Confirmation does not affect playback.
- Deleted automatic defects and manual marks are absent from the cut list.
- Disabled mode yields no intervals.
- Logical manual/automatic groups are already one defect and one interval.

### Story 26 — Per-type and group padding

**Status:** Done · **Priority:** P1

As a user, I want padding per type and per group, independent of whether
fast-forward is on.

- `playback.paddingByType[type]`, `playback.groupPadding`.
- Global `skipBeforeSec`/`skipAfterSec` are fallback.
- Defaults: pause `0/0`, filler `0.1/0.2`, group `0.15/0.35`.
- Padding is clamped to 0–5 s and to the recording.
- Settings remain editable when `skipEnabled` is false.

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

### Story 26

- [ ] Per-type padding is used; group padding for groups; global fallback.
- [ ] Padding is clamped to duration.
- [ ] Overlapping ranges merge.
- [ ] Changing padding while paused affects the next skip.
- [ ] Deleted items remain unskipped.
- [ ] Controls work while skip is off.

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

- `test/skip.test.ts` covers padding, dismissed filtering, merging, lookup.
- Add a pure "next target" helper test for story 28.
- Real playback and listen need a macOS run.