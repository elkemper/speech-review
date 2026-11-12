# 02 — Defect detection and grouping

[Index](../SPEC.md) · Prev: [01 — Settings](01-settings.md) · Next:
[03 — Marks and review](03-marks.md)

**Files:** `src/shared/defects.ts`, `src/shared/types.ts`, tests in
`test/core.test.ts`, `test/grouping.test.ts`.

## Stories

### Story 4 — Automatic defect rules

**Status:** Done · **Priority:** P0

As a user, I want fillers, pauses, repetitions, elongations, false starts and
vocal sounds detected by rules that apply immediately, without re-transcribing.

- Rules live in `DefectRules` (`DEFAULT_RULES`).
- `detectDefects(transcript, rules, marks)` is pure.
- Types use the existing `DefectType` union.
- Automatic ids are `auto-${type}-${sequence}` in global insertion order.
- Rule changes recompute the open project and save with a debounce.

### Story 5 — Minimum duration per type

**Status:** Done · **Priority:** P1

As a user, I want each automatic type to have a minimum duration, so short
fillers, coughs and repetitions do not flood the list.

- Field: `rules.minDurationByType: Record<DefectType, number>`.
- `0` means no limit.
- Pause measures the silence; repetition measures the shorter repeated word;
  other types measure the defect span.
- UI in Defects → advanced block (story 2 supplies the slider control).

### Story 6 — Automatic grouping of neighbours

**Status:** Done · **Priority:** P1

As a user, I want neighbouring automatic defects to merge into one group when
the gap is small and no other word sits in the gap.

- Field: `rules.autoGroupGapSec`; `0` disables grouping (default).
- `groupAutoDefects` sorts by start, merges while gap ≤ limit and no spoken
  word is fully inside the gap.
- A pause spans only the silence, so a filler immediately before a pause can
  group; a filler separated by a real word cannot.
- Group id `auto-group-${firstDefectId}`; `groupIds`, `groupTypes`; earliest
  start, latest end, highest severity.
- One list item, one review action, one skip interval.
- Default `0` keeps existing projects and the fixture at 10 defects.

### Story 7 — Sentence-boundary pauses

**Status:** Done · **Priority:** P1

As a user, I do not want a normal stop after a sentence to be reported as a
pause defect.

- Controlled by `excludePauseAfterSentenceEnd`.
- Sentence end is `.`, `?`, `!`, `…` via `endsSentence`.
- The gap may still appear as a transcript row (story 22).
- Ordinary long pauses that are not sentence boundaries remain pause defects
  and get no extra transcript decoration.

## Acceptance criteria

### Story 4

- [ ] Types: filler, pause, repetition, elongation, false start, vocal sound;
      `unclear` stays disabled while confidence is `0`.
- [ ] Multi-word fillers ("как бы", "в общем") are one defect.
- [ ] Automatic ids are order-based and unique within one detection pass.
- [ ] Rule changes update the open project and save.
- [ ] The sample fixture still yields 6 fillers, 3 pauses, 1 false start = 10.

### Story 5

- [ ] Every type has a clamped value in `minDurationByType`.
- [ ] Pause uses the silence length, repetition the shorter word, others the
      defect span.
- [ ] A defect below the value is not reported.
- [ ] Old projects without the field load with zeros.
- [ ] `normalizeRules` fills and clamps the field.

### Story 6

- [ ] Gap limit is clamped (0–10 s) and `0` disables grouping.
- [ ] A real word inside the gap blocks grouping.
- [ ] A filler directly before a pause groups; a filler separated by a word
      does not.
- [ ] Group counts contribute to every type in `groupTypes`.
- [ ] Group is reviewed/skipped as one item.
- [ ] Regression tests cover gap limit, word blocker and counts.

### Story 7

- [ ] Pause after `.?!…` is not a pause defect when enabled.
- [ ] The transcript can still show the gap as a row.
- [ ] Non-sentence long pauses are pause defects with no special styling.
- [ ] The fixture pause after "пользу." stays excluded.

## Verification

- `test/core.test.ts` — fixture, rule counts, sentence pause.
- `test/grouping.test.ts` — minimum duration, grouping, normalization.
- Real recognition still needs a macOS run.