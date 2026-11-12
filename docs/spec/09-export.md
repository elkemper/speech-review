# 09 — Export

[Index](../SPEC.md) · Prev: [08 — Processing](08-processing-progress.md)

**Files:** `src/shared/exportCsv.ts`, `src/main/export.ts`,
`src/renderer/src/components/DefectPanel.tsx`,
`src/renderer/src/components/SettingsDialog.tsx` (Export tab).

## Stories

### Story 38 — CSV export with configurable fields

**Status:** Done · **Priority:** P1

As a user, I want to choose CSV fields, delimiter and header, and get a correct
Excel-friendly file.

- Fields in `ExportSettings.fields` order, configurable in the Export tab.
- Delimiter `;` or `,`.
- Optional header.
- BOM `\uFEFF`, CRLF.
- Escaping for quotes, delimiters and newlines.
- Timecodes `HH:MM:SS.mmm`.

### Story 39 — JSON export with full data

**Status:** Done · **Priority:** P1

As a user, I want JSON with full defect and mark data, including counts per
type.

- Project metadata, counts, full defects, original marks.
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
- [ ] Export uses the current open project's defects and marks.

### Story 39

- [ ] JSON contains exportedAt, project metadata, counts, defects, marks.
- [ ] Counts contain every type, including zeros.
- [ ] Grouped defects count once per `groupTypes` entry.
- [ ] Field selection does not reduce JSON.
- [ ] Exact manual mark notes and ids are preserved.

## Verification

- `test/export.test.ts` covers fields, escaping, delimiter and header.
- JSON shape is covered indirectly; extend the test when the shape changes.