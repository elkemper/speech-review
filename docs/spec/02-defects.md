# 02 — Defect detection and grouping

[Index](../SPEC.md) · Prev: [01 — Settings](01-settings.md) · Next:
[03 — Marks and review](03-marks.md)

**Files:** `src/shared/defects.ts`, `src/shared/types.ts`, tests in
`test/core.test.ts`, `test/grouping.test.ts`, `test/candidates.test.ts`.

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
- UI: the per-type row in Defects, next to the type name (story 43).

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

### Story 44 — Enable/disable a defect type and automatic grouping

**Status:** Done · **Priority:** P1

As a user, I want to switch a whole defect type off for the project, and to
switch automatic grouping on and off with a checkbox, without losing the
values I already set.

- Field: `rules.enabledTypes: Record<DefectType, boolean>`. Missing entries
  mean on, except `unclear`, which stays off while the engine writes
  `confidence: 0` (presentation is also marked "в разработке").
- `manual` is never filtered: manual marks are explicit user work.
- A disabled type produces no defects, but the detection sequence still
  advances, so ids of the other types do not shift.
- Field: `rules.autoGroupEnabled: boolean` plus the existing
  `rules.autoGroupGapSec`.
- Old rules with `autoGroupGapSec > 0` migrate to enabled; storing an explicit
  `false` keeps the gap for when grouping is turned on again.
- The UI is a checkbox per type and a checkbox plus gap slider for grouping
  (story 43).

### Story 46 — Minimum-duration candidates

**Status:** Done · **Priority:** P1

As a user, I want a suppressed short defect to be inspectable when I click its
word, without changing the minimum-duration rule globally.

- `detectDefectsWithCandidates` returns `{ defects, candidates }`; the existing
  `detectDefects` remains a wrapper.
- A below-threshold match keeps its normal automatic id and order. Lowering the
  threshold later produces the same id.
- A candidate is revealable only for `min-duration`; a disabled type stays off.
- While `activeDefectId` matches a candidate, the renderer adds a computed
  `candidate: true` defect to the list. It has the normal pending controls,
  mini-timeline, timeline markers and skip intervals.
- Candidate cards show the «кандидат» badge and are excluded from export and
  confirmation progress while they stay candidates.
- Promotion is implicit through existing editable state: bounds override,
  confirmation, deletion or a note makes the id `promoted` and it survives
  switching and reload.
- If the user only clicked and then moved to another word/defect, the candidate
  disappears and is not skipped.

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
- [ ] A defect below the value is not reported as a defect, but remains a
      hidden candidate (story 46).
- [ ] Old projects without the field load with zeros.
- [ ] `normalizeRules` fills and clamps the field.

### Story 6

- [ ] Gap limit is clamped (0–10 s) and `0` disables grouping.
- [ ] A real word inside the gap blocks grouping.
- [ ] A filler directly before a pause groups; a filler separated by a word
      does not.
- [ ] Group counts contribute to every type in `groupTypes`.
- [ ] Group is confirmed/skipped as one item.
- [ ] Regression tests cover gap limit, word blocker and counts.

### Story 7

- [ ] Pause after `.?!…` is not a pause defect when enabled.
- [ ] The transcript can still show the gap as a row.
- [ ] Non-sentence long pauses are pause defects with no special styling.
- [ ] The fixture pause after "пользу." stays excluded.

### Story 44

- [ ] A disabled type produces no defects of that type.
- [ ] Manual marks are still detected when `enabledTypes.manual` is false.
- [ ] Turning a type off does not renumber the other automatic defects.
- [ ] Old rules without `enabledTypes` load with every usable type enabled and
      `unclear` off.
- [ ] Grouping runs only when `autoGroupEnabled` is true and the gap is positive.
- [ ] Turning grouping off keeps `autoGroupGapSec` for the next enable.
- [ ] Old rules with a positive gap migrate to enabled.
- [ ] Regression tests cover on/off, id stability and migration.

### Story 46

- [ ] A below-threshold match is returned as a candidate, not a defect.
- [ ] The candidate id equals the id it would get at a lower threshold.
- [ ] Other automatic ids do not shift around a candidate.
- [ ] Promoting the id includes it as a defect; disabled types stay off.
- [ ] Candidates are excluded from export and confirmation progress.
- [ ] Revealed candidates are skipped, and disappear after switching away.
- [ ] Bounds, confirm, delete or note keep the promoted defect.

## Verification

- `test/core.test.ts` — fixture, rule counts, sentence pause.
- `test/grouping.test.ts` — minimum duration, grouping, enabled types,
  normalization.
- `test/candidates.test.ts` — suppressed candidates, id stability, promotion.
- Real recognition still needs a macOS run.