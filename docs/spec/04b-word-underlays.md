# 04b — Colored word underlays

[Index](../SPEC.md) · Parent: [04 — Timeline](04-timeline.md) ·
Related: [10 — Mini timeline](10-mini-timeline.md)

**Status:** Done · **Priority:** P1

**Files:** `src/renderer/src/defectsUi.ts` (`defectByWordId`),
`src/renderer/src/components/Timeline.tsx`,
`src/renderer/src/components/MiniTimeline.tsx`.

## Story

### Story 41 — Marked words use the defect/mark color

As a user, I want words that belong to a defect or mark to have a colored
underlay in both the main timeline and the mini timeline, so I can see *which*
words are marked without reading the defect list.

- The color comes from the defect/mark type (`DEFECT_COLORS`).
- Manual marks win over automatic defects when a word belongs to both.
- Pause defects do not color words: they describe a gap.
- The active defect's words are the strongest.
- Other marked words (including neighbours in the mini timeline) get a faint
  colored underlay.
- Confirmed words stay visible but dimmer.
- The underlay is drawn in the word strip/label area, not across the entire
  waveform, so the waveform and defect markers stay readable.
- This is visual only: no change to `wordIds`, `markIds`, confirmation or skip.

## Acceptance criteria

- [ ] A word covered by a filler/pause-adjacent mark is colored with that type.
- [ ] Manual marks override automatic colors for the same word.
- [ ] Pause defects produce no word underlay.
- [ ] The active defect's words are stronger than other marked words.
- [ ] Confirmed words are dimmer but not invisible.
- [ ] Neighbouring marked words in the mini timeline are faintly colored.
- [ ] The main timeline uses the same mapping.
- [ ] Text labels remain readable over the underlay.
- [ ] No data model or confirmation-state change.
- [ ] Unit test: `defectByWordId` excludes pauses and prefers manual marks.

## Verification

- Pure mapping is unit-tested.
- Color contrast must be checked on macOS with a real transcript.