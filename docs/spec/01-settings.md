# 01 — Settings

[Index](../SPEC.md) · Next: [02 — Defects](02-defects.md)

Settings hold global defaults. Project-specific rules are copied into the open
project when settings change.

**Files:** `src/renderer/src/components/SettingsDialog.tsx`,
`src/shared/settings.ts`, `src/main/settings.ts`.

## Stories

### Story 1 — Settings tabs, model management, recognition placement

**Status:** Done · **Priority:** P0 (already delivered)

As a user, I want engine, model and recognition settings in **General**, so I
can download/delete models and configure the recognizer in one place.

- Three tabs: **General**, **Defects**, **Export**.
- General: engine paths, model cards, download/delete, language, backend,
  chunk length, licenses.
- Defects: story 2, story 3, plus rules/grouping/padding from 02 and 06, and the mini-timeline padding (story 40).
- Export: [story 38](09-export.md).
- The earlier "Recognition" tab is superseded: recognition lives in General.

### Story 2 — Slider plus numeric input for thresholds

**Status:** Done · **Priority:** P1 (delivered)

As a user, I want every threshold to have a slider **and** a numeric field, so I
can adjust it quickly or precisely.

- Applies to pause threshold, critical pause, repetition window, elongation
  repeats.
- Also used by minimum duration (story 5) and padding (story 26).
- Values persist in `settings.json` and the project `rules`.

### Story 3 — Hide reviewed defects

**Status:** Done · **Priority:** P1 (delivered)

As a user, I want to remove reviewed defects from the defect list completely.

- Toggle in **Defects**, persisted in settings (`hideReviewed`).
- Hides reviewed items from the right panel only.
- Transcript, timeline and export are unaffected.
- If everything is hidden, the panel explains why.

## Acceptance criteria

### Story 1

- [ ] Exactly three tabs exist: General, Defects, Export.
- [ ] General contains engine paths, model cards, download/delete, language,
      backend, chunk length and licenses.
- [ ] Download verifies SHA-256; delete removes the model, `.sha256` marker and
      `.part` file.
- [ ] Changing language/model/backend persists immediately and refreshes
      engine status.
- [ ] Defects contains the mini-timeline context setting (default 3 s per side).
- [ ] Export contains CSV fields, delimiter and header.
- [ ] No separate "Recognition" tab exists.

### Story 2

- [ ] Every threshold has a range slider and a numeric field showing the same
      value.
- [ ] Moving the slider updates the field and the open project immediately.
- [ ] Typing in the field updates the slider and clamps to the valid range.
- [ ] Sliders use the existing Russian labels and do not add a new dependency.
- [ ] Values survive a settings reload.

### Story 3

- [ ] The toggle lives in Defects and persists.
- [ ] Reviewed defects and marks disappear from the list when on.
- [ ] The transcript/timeline/export keep their normal state.
- [ ] The empty state distinguishes "all reviewed and hidden" from "no defects".

## Verification

- Unit tests: settings normalization in `test/grouping.test.ts`.
- Manual: settings reload on macOS (not possible in this container).