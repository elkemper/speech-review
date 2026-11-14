# 09 — Export

[Index](../SPEC.md) · Prev: [08 — Processing](08-processing-progress.md)

**Files:** `src/shared/exportCsv.ts`, `src/shared/videoExport.ts`,
`src/main/export.ts`, `src/main/videoExport.ts`,
`src/renderer/src/components/DefectPanel.tsx`,
`src/renderer/src/components/VideoExportDialog.tsx`,
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

### Story 48 — Video export from the cut list

**Status:** Done · **Priority:** P1

As a user, I want to save a clean video with every marked place removed, choosing
resolution, quality and encoder.

- The entry point is a full-width **«Экспорт видео…»** button under the CSV and
  JSON buttons in the defect panel.
- Export uses the same cut model as playback and JSON export:
  `buildCutList` + `complementRanges`. Confirmation does not matter; dismissed
  defects and manual marks are excluded, and a transient minimum-duration
  candidate is not exported.
- Re-encoding: `trim`/`atrim` per kept range + `concat`, optional
  `scale=-2:<height>`, H.264/HEVC, AAC 192 kbps, MP4/MOV.
- Resolution: source / 1080p / 720p / 480p.
- Quality is three presets. Software encoders use CRF: H.264 18/23/28 and HEVC
  22/27/32. VideoToolbox has no CRF, so the same presets are sent to the
  hardware encoder as `-q:v` 75/60/45.
- Encoders: H.264 and HEVC, each in software (`libx264`/`libx265`) and hardware
  (`h264_videotoolbox`/`hevc_videotoolbox`) variants.
- The save dialog defaults to `<project>-clean.mp4` in Downloads. The output
  path cannot equal the source path. ffmpeg writes a `.part-<uuid>` file in the
  destination directory and the result is renamed into place only on success.
- One export runs at a time. Progress comes from `-progress pipe:1`; the dialog
  can cancel the ffmpeg process. The source file is never modified.
- The last choices live in `settings.videoExport` and are not part of undo/redo
  or project state.
- Audio-only recordings are out of scope; export reports that there is no video
  track. Audio-file export is tracked in `docs/BACKLOG.md`.

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

### Story 48

- [ ] The button sits under the CSV/JSON buttons and opens the video dialog.
- [ ] The dialog shows the number of cuts and the removed/remaining duration.
- [ ] Every non-dismissed cut is removed; dismissed items and candidates are not.
- [ ] Re-encode uses `trim`/`atrim` + `concat`, resets timestamps and optionally
      scales to the selected height.
- [ ] Software H.264/HEVC use the configured CRF; hardware encoders use `-q:v`.
- [ ] HEVC in MP4/MOV gets the `hvc1` tag.
- [ ] The source file is never overwritten; a successful export replaces the
      destination atomically.
- [ ] Progress and cancellation work; a cancelled or failed export leaves no
      partial output.
- [ ] `settings.videoExport` persists and does not enter history.
- [ ] An audio-only source is rejected with a clear message.

## Verification

- `test/export.test.ts` covers fields, escaping, delimiter, header, cut vs
  defect bounds and uncut rows.
- `test/videoExport.test.ts` covers settings normalization, filter graph,
  CRF/q:v args, kept ranges, duration and progress parsing.
- JSON shape is covered indirectly; extend the test when the shape changes.