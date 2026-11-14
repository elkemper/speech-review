# 09 — Export

[Index](../SPEC.md) · Prev: [08 — Processing](08-processing-progress.md)

**Files:** `src/shared/exportCsv.ts`, `src/main/export.ts`,
`src/renderer/src/components/DefectPanel.tsx`,
`src/renderer/src/components/SettingsDialog.tsx` (Export tab).

## Stories

### Story 38 — CSV export with configurable fields

**Status:** Done · **Priority:** P1

As a user, I want to choose CSV fields, delimiter and header, and get a correct
Excel-friendly file whose base time columns are the final cut bounds.

- Fields in `ExportSettings.fields` order, configurable in the Export tab.
- Base time fields (`start_tc`, `end_tc`, `start_sec`, `end_sec`,
  `duration_sec`) are the final cut bounds.
- Optional fields expose the original defect bounds (`defect_start_*`,
  `defect_end_*`) and a `cut` yes/no flag.
- An uncut defect (for example a pause shorter than the kept room tone) has
  empty cut cells and `cut = нет`.
- Delimiter `;` or `,`.
- Optional header.
- BOM `\uFEFF`, CRLF.
- Escaping for quotes, delimiters and newlines.
- Timecodes `HH:MM:SS.mmm`.

### Story 39 — JSON export with full data

**Status:** Done · **Priority:** P1

As a user, I want JSON with full defect and mark data, including counts per
type and the merged cut list for a video editor.

- Project metadata, counts, full defects, original marks.
- Each exported defect has `start/end` (original) and `cutStart/cutEnd` (final
  cut, `null` when not cut).
- A top-level `cuts` array contains the merged final cuts in playback order.
- Counts include every type (zeros included).
- Grouped defect counts once per type in `groupTypes`.
- Field selection applies to CSV only.

## Acceptance criteria

### Story 38

- [ ] Fields appear in the configured order.
- [ ] At least one field must remain selected.
- [ ] Delimiter and header are respected.
- [ ] BOM and CRLF are present.
- [ ] Quotes/delimiters/newlines are escaped.
- [ ] Timecodes are fixed-width.
- [ ] Base time fields use the final cut; optional fields use the original
      defect bounds.
- [ ] An uncut defect has empty cut cells and `cut = нет`.
- [ ] Export uses the current open project's defects and marks.

### Story 39

- [ ] JSON contains exportedAt, project metadata, counts, defects, cuts, marks.
- [ ] Each defect has original `start/end` and final `cutStart/cutEnd`.
- [ ] `cuts` is the merged, non-overlapping final cut list.
- [ ] Counts contain every type, including zeros.
- [ ] Grouped defects count once per `groupTypes` entry.
- [ ] Field selection does not reduce JSON.
- [ ] Exact manual mark notes and ids are preserved.

## Verification

- `test/export.test.ts` covers fields, escaping, delimiter, header, cut vs
  defect bounds and uncut rows.
- JSON shape is covered indirectly; extend the test when the shape changes.