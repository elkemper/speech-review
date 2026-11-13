# 05 — Transcript

[Index](../SPEC.md) · Prev: [04 — Timeline](04-timeline.md) · Next:
[06 — Playback and skip](06-playback.md)

**Files:** `src/renderer/src/components/Transcript.tsx`,
`src/shared/transcript.ts`, `src/renderer/src/selection.ts`.
**Tests:** `test/core.test.ts`, `test/selection.test.ts`.

## Stories

### Story 18 — Word seeking and exact active word

**Status:** Fix now · **Priority:** P0

As a user, I want clicking a word to seek to it and the active highlight to be
the word under the playhead, not the previous one.

- Click seeks to `word.start` and selects the word.
- `findActiveWord(words, time)` returns the word containing the time.
- Selecting a mark highlights its first word, not the preceding word.
- A pause is represented by its chip, not by highlighting a spoken word.

### Story 19 — Selection sync with the defect list

**Status:** Fix now · **Priority:** P0

As a user, I want clicking a marked word in the transcript to select and scroll
to the matching item in the right defect list.

- Clicking a word with a defect sets `activeDefectId` and seeks.
- The list scrolls the active item into view (`scrollIntoView`).
- Selecting an item in the list selects/highlights the matching word(s) in the
  transcript.
- A deleted card focused from the transcript switches the type filter to
  «все», so the thin card is visible. If `showDismissed` is off, deleted cards
  stay hidden by the user's choice.
- Logical groups and automatic groups work the same way.

### Story 20 — Follow mode

**Status:** Done · **Priority:** P1

As a user, I want the transcript to follow the playing word, with a manual
free-scroll mode.

- Follow centers the active segment.
- Manual scrolling turns follow off.
- The button label reflects the state.

### Story 21 — Only with defects

**Status:** Done · **Priority:** P1

As a user, I want to show only segments that contain defects.

- Keeps segments with a defect word or a pause chip.
- Empty state explains whether there are no defects or no speech.

### Story 22 — Sentence pause rows

**Status:** Next · **Priority:** P1

As a user, I want long pauses after a sentence to get their own row with the
duration, while ordinary long pauses are not specially highlighted.

- At least 2.5 s and `endsSentence(previousWord)`.
- Row shows the duration (e.g. "5.2 c · пауза после фразы").
- Not a defect, not a mark, not exported as a defect.
- Ordinary long pauses inside a sentence get no special row.
- 5–15 s pauses remain readable and virtualized.

### Story 23 — Dim items skipped by fast-forward

**Status:** Next · **Priority:** P1

As a user, I want items skipped by fast-forward to look disabled/dimmed in the
transcript and defect list.

- Words and pause chips inside skip intervals get a dimmed/disabled style.
- The defect panel itself is not dimmed; cards stay interactive in skip mode.
- Every non-deleted item is dimmed when it is skipped.
- Turning fast-forward off restores normal style.
- Visual only; confirmation state is not mutated.

### Story 24 — Partial transcript visibility

**Status:** Done (verify) · **Priority:** P1

As a user, I want finished chunks to appear while the rest is still being
analyzed.

- After each chunk, transcript + peaks update.
- User can seek, click, mark and review during the job.
- Later partials keep marks, bookmarks, notes, overrides, confirmed/dismissed ids.
- First partial resets automatic confirmation state (invariant 11).
- "partial" badge stays until the final transcript.

## Acceptance criteria

### Story 18

- [ ] Click seeks to the word start.
- [ ] The active word is exactly the word under the playhead.
- [ ] Selecting a mark highlights its first word.
- [ ] No previous-word highlight for a filler/mark selection.
- [ ] Pause chips are used for pauses.
- [ ] Regression: `findActiveWord(words, defect.start + ε)` returns the first
      defect word.

### Story 19

- [ ] Clicking a marked word selects its defect in the list.
- [ ] The list scrolls the active item into view.
- [ ] Selecting a list item highlights the matching transcript word(s).
- [ ] Hidden-by-filter items are revealed or the filter is adjusted.
- [ ] A word covered only by a deleted card focuses its thin card.
- [ ] Logical/automatic groups sync correctly.
- [ ] Pause defects sync with their chip.

### Story 20

- [ ] Follow centers the active segment.
- [ ] Scrolling turns follow off.
- [ ] The label reflects the state.
- [ ] Follow does not fight manual panning.

### Story 21

- [ ] Segments with a defect word or pause chip remain.
- [ ] Other segments disappear.
- [ ] Turning it off restores the transcript.
- [ ] The empty state distinguishes no defects from no speech.

### Story 22

- [ ] Sentence-boundary silence ≥ 2.5 s creates a row.
- [ ] The row shows the duration.
- [ ] It is not a defect/mark/export item.
- [ ] Ordinary long pauses get no special row.
- [ ] Long rows do not break virtualization or scrolling.

### Story 23

- [ ] Words and pause chips inside skip intervals are dimmed.
- [ ] The defect panel is not dimmed in skip mode.
- [ ] Deleted items are not dimmed as skipped.
- [ ] Disabling skip restores normal style.
- [ ] No review mutation from styling.

### Story 24

- [ ] Partial transcript and peaks appear after each chunk.
- [ ] Review/seek/mark works during the job.
- [ ] Later partials preserve local edits for the visible prefix.
- [ ] First partial resets automatic confirmation state.
- [ ] Partial badge is visible until done.

## Verification

- `test/core.test.ts` covers active word and segments.
- `test/selection.test.ts` covers selection-to-defect mapping.
- Partial transcript behaviour needs a macOS run with a real job.