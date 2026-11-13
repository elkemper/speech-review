# 01 — Settings

[Index](../SPEC.md) · Next: [02 — Defects](02-defects.md)

Settings hold global defaults. Project-specific rules are copied into the open
project when settings change.

**Files:** `src/renderer/src/components/SettingsDialog.tsx`,
`src/renderer/src/components/DefectRulesSection.tsx`,
`src/renderer/src/components/SettingsRangeField.tsx`,
`src/shared/settings.ts`, `src/shared/format.ts`, `src/main/settings.ts`.

## Stories

### Story 1 — Settings tabs, model management, recognition placement

**Status:** Done · **Priority:** P0 (already delivered)

As a user, I want engine, model and recognition settings in **General**, so I
can download/delete models and configure the recognizer in one place.

- Three tabs: **General**, **Defects**, **Export**.
- General: engine paths, model cards, download/delete, language, backend,
  chunk length, licenses.
- Defects: show-deleted (story 3) at the top, per-type rows (story 43), rules
  and minimum duration (stories 4–5), automatic grouping (stories 6 and 44),
  padding (story 26), the mini-timeline padding (story 40) and the waveform
  contrast (story 42).
- Export: [story 38](09-export.md).
- The earlier "Recognition" tab is superseded: recognition lives in General.
- Skip mode itself is toggled only in the player; Settings no longer owns it.

### Story 2 — Slider plus numeric input for thresholds

**Status:** Done · **Priority:** P1 (delivered)

As a user, I want every threshold to have a slider **and** a numeric field, so I
can adjust it quickly or precisely.

- Applies to pause threshold, critical pause, repetition window, elongation
  repeats.
- Also used by minimum duration (story 5) and padding (story 26).
- Values persist in `settings.json` and the project `rules`.

### Story 3 — Show or hide deleted defects

**Status:** Done · **Priority:** P1 (delivered)

As a user, I want deleted defects to stay visible as thin cards with an undo
button, and I want to hide them completely when the list gets noisy.

- Toggle in **Defects**, persisted as `showDismissed`; on by default.
- When on, a deleted card remains in place, is marked as deleted and has a
  restore button on the right.
- When off, deleted items disappear from the right panel.
- Transcript, timeline and export always exclude deleted items.
- If everything is hidden, the panel explains why.

### Story 43 — Defect settings rows and reliable sliders

**Status:** Done · **Priority:** P1

As a user, I want each defect type to be one row in **Defects**, with its
minimum duration, skip padding and type-specific controls together, so I can
configure one type without scanning several sections.

- `showDismissed` sits at the very top of the tab.
- Row order: filler, repetition, elongation, false start, vocal sound,
  unclear (disabled, "в разработке"), **pause last**.
- Every row has a checkbox that enables/disables detection for that type
  (story 44), a minimum-duration field and a before/after padding pair.
- Type-specific controls live in the same row: filler → lexical-filler toggle;
  repetition → repetition window; elongation → letter repeats; pause → pause
  threshold, critical pause and sentence-end exclusion in a sub-row.
- Manual-mark and group padding stay as a compact pair under the table.
- Automatic grouping has its own checkbox and gap slider (story 44).
- Timeline contrast and mini-timeline padding follow in their own sections.
- Skip mode is removed from Settings; the player owns the ⏭ toggle. There is no skip scope.
- Slider + numeric field never desync: empty or half-typed text (`0.`, `0,`,
  `-`) is not coerced to `0`, both a comma and a dot are accepted, and values
  are snapped to the step grid before they reach the store.
- Sliders are painted with CSS (`-webkit-appearance: none`, fill from the
  value) so the thumb cannot lag behind the numeric field.
- The modal does not use `backdrop-filter` over the playing video; the card is
  its own isolated compositing layer, and the scroll body uses
  `overscroll-behavior: contain` and a stable scrollbar gutter.

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
- [ ] Defects contains the waveform contrast setting (0–100, default 55).
- [ ] Export contains CSV fields, delimiter and header.
- [ ] No separate "Recognition" tab exists.
- [ ] Skip mode is not editable in Settings; there is no skip scope.

### Story 2

- [ ] Every threshold has a range slider and a numeric field showing the same
      value.
- [ ] Moving the slider updates the field and the open project immediately.
- [ ] Typing in the field updates the slider and clamps to the valid range.
- [ ] Empty, partial and localized input never turns into `0`; both `0.5` and
      `0,5` parse.
- [ ] The stored value is snapped to the step grid, so the field and the thumb
      cannot disagree because of float noise.
- [ ] Sliders use the existing Russian labels and do not add a new dependency.
- [ ] Values survive a settings reload.

### Story 3

- [ ] The toggle lives in Defects and persists.
- [ ] Deleted defects and marks remain as thin cards when on.
- [ ] Turning the toggle off hides them from the panel.
- [ ] The transcript/timeline/export keep their normal state and exclude deleted items.
- [ ] The empty state distinguishes "all deleted and hidden" from "no defects".

### Story 43

- [ ] Pause is the last row and carries threshold, critical pause and
      sentence-end exclusion.
- [ ] Each type row shows its checkbox, minimum duration, before/after padding
      and type-specific controls.
- [ ] Manual and group padding remain editable.
- [ ] Turning a type off keeps its stored values and dims its controls.
- [ ] The reset button restores every rule field, including the new toggles.
- [ ] Settings no longer contains skip-mode controls.
- [ ] The player has no scope selector next to the ⏭ button.
- [ ] A numeric field can be typed as `0,5` or `0.5`; clearing it does not
      write `0`.
- [ ] The slider fill follows the value without native-thumb ghost frames.
- [ ] Rule and padding changes are undoable; `Cmd+Z` works while the dialog is
      open and is limited to changes made after opening it.
- [ ] Without an open project the Defects tab is disabled and General is shown.
- [ ] While recognition is active the whole settings form is disabled.

## Verification

- Unit tests: settings normalization in `test/grouping.test.ts`; number
  parsing and step snapping in `test/format.test.ts`.
- Manual: settings reload, slow scrolling and slider dragging on macOS (not
  possible in this container).