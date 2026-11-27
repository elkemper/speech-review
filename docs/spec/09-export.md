# 09 — Export

[Index](../SPEC.md) · Prev: [08 — Processing](08-processing-progress.md)

**Files:** `src/shared/exportCsv.ts`, `src/shared/videoExport.ts`,
`src/main/export.ts`, `src/main/videoExport.ts`,
`src/main/engine/exportJob.ts`, `src/main/engine/exportPipeline.ts`,
`src/main/engine/audioMix.ts`,
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
  empty cut cells and `cut = no`.
- Delimiter `;` or `,`.
- Optional header.
- BOM `\uFEFF`, CRLF.
- Escaping for quotes, delimiters and newlines.
- Timecodes `HH:MM:SS.mmm`.
- Type/severity names and `yes`/`no` values are English and do not depend on
  the interface language ([story 54](12-i18n.md)). A manual mark with no words
  and no note exports the English fallback label, not the UI-language one.

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
- Re-encoding: the source is first mapped onto a constant frame grid
  (`fps=<fps>`), then the kept frames are picked in a single pass:
  `select` + `setpts` without a crossfade, or one `trim` branch per piece joined
  by `xfade` with a crossfade. Optional `scale=-2:<height>`, H.264/HEVC, AAC
  192 kbps, MP4/MOV. The frame grid matters: a variable-frame-rate recording cut
  by frame index as if every frame lasted `1/fps` drifts away from the audio.
  For the same reason the frame rate from the ffmpeg banner is snapped back to
  the exact NTSC rational — the banner rounds 23.976 to `23.98`, and retiming a
  90-minute recording at the rounded value makes the video run ahead by about a
  second. The audio is not cut in the filter graph: it is decoded once to PCM,
  cut sample-exact in the main process, and passed to ffmpeg as a second input.
  A `trim` branch per cut in a single-pass graph makes every branch receive
  every decoded frame of the source, so a 90-minute recording with 500 cuts
  spent minutes copying frames; `select` walks the source once and its cost is
  flat in the number of pieces, which is why the no-fade path uses it.
- Optional crossfade at every join (`videoExport.crossfade`, length
  `videoExport.crossfadeSec`, default 0.1 s, range 0–1 s). The fade is
  quantised to whole frames. Both tracks overlap the same material: the last
  `f` frames of one piece and the first `f` of the next occupy the same `f`
  output frames. The audio sums them with complementary raised-cosine ramps;
  the picture must dissolve over the same frames, otherwise the video would
  jump to the incoming piece while the audio is still blending the outgoing
  one, and the viewer would hear one sentence with the next sentence's mouth.
  The fade therefore switches the video graph to one `trim` branch per piece
  joined by `xfade`; that chain costs one extra pass over the material per
  join (measured at 720p with the capped pool: 0.02–0.06 s per join for a
  4-minute source, roughly 5–10 minutes extra on a 90-minute 1080p export with
  500 joins) on top of the single decode. Every join is a filter instance, and
  ffmpeg gives each one a slice of the graph thread pool, so the exporter caps
  that pool at two threads: at the default size a few hundred joins exhaust the
  process thread limit and the export fails before the first frame. Both tracks
  keep the same length at any number of cuts, and the export gets shorter by
  one fade per join; the dialog's kept/removed figures and the progress bar use
  the mixed length from that plan, not the sum of the kept ranges. The dialog
  gets the frame rate and sample rate from one probe of the source; without a
  usable probe it falls back to the cut-list totals.
- A kept fragment shorter than two fades is merged into the cut. Its fade-in
  and fade-out would overlap inside the fragment: `xfade` would blend three
  sources at once, and the audio mixer would copy the fragment twice, making
  the mix longer than the plan and leaving every later sample behind the
  picture. The two long neighbours therefore share one full fade across the
  merged cut. The first and last pieces have only one faded side and may be
  shorter. Rounding can still make the two sample overlaps of a piece one
  sample longer than its audio at 29.97 fps; the outgoing audio overlap is
  trimmed by that difference, the picture keeps its frame-accurate fade, and
  the mixer writes exactly `plan.audioSamples`.
- Resolution: source / 1080p / 720p / 480p.
- Quality is three presets. Software encoders use CRF: H.264 18/23/28 and HEVC
  22/27/32. VideoToolbox has no CRF, so the same presets are sent to the
  hardware encoder as `-q:v` 75/60/45.
- Encoders: H.264 and HEVC, each in software (`libx264`/`libx265`) and hardware
  (`h264_videotoolbox`/`hevc_videotoolbox`) variants.
- The save dialog defaults to `<project>-clean.mp4` in Downloads. The output
  path cannot equal the source path. ffmpeg writes a `.part-<uuid>` file in the
  destination directory and the result is renamed into place only on success.
- The export is split into three layers. `engine/exportJob.ts` resolves the
  request into a job (kept ranges, plan, output checks) without Electron, ffmpeg
  or the filesystem and returns error codes, not text. `engine/exportPipeline.ts`
  runs the stages against injected ports and reports language-neutral progress
  events; that is what makes cancellation, cleanup and failure paths testable
  without media. `main/videoExport.ts` keeps only the save dialog, the real
  ports and the single place where an error code becomes a localized message.
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
- [ ] An uncut defect has empty cut cells and `cut = no`.
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
- [ ] The dialog shows the number of cuts and the removed/remaining duration;
      the duration comes from the export plan when the source can be probed.
- [ ] Every non-dismissed cut is removed; dismissed items and candidates are not.
- [ ] Re-encode uses a single `select` pass for the video and a pre-cut PCM
      track as the second input; the audio never goes through a per-cut filter
      branch.
- [ ] With a crossfade the audio and video have the same length after any
      number of cuts; the fade is quantised to whole frames and the picture
      dissolves over exactly the frames and source moments the audio mixes.
- [ ] A kept fragment shorter than two fades is merged into the cut and the
      export stays in sync; the first and last pieces may be shorter than a
      fade.
- [ ] Video and audio point at the same source time at the same output
      position, including after several crossfade joins and on a
      variable-frame-rate source; NTSC rates are used exactly (24000/1001, not
      23.98).
- [ ] Every decoded frame of the export matches an independent model of the
      cut list: outside a crossfade it is the named source frame, inside it is
      a mixture of the two named frames, and both ends equal the original
      first and last frames when the ends are not cut.
- [ ] Software H.264/HEVC use the configured CRF; hardware encoders use `-q:v`.
- [ ] HEVC in MP4/MOV gets the `hvc1` tag.
- [ ] The source file is never overwritten; a successful export replaces the
      destination atomically.
- [ ] Progress and cancellation work; a cancelled or failed export leaves no
      partial output and no work directory.
- [ ] Export failures travel as codes through the job and pipeline layers and
      become user-facing text only at the IPC boundary.
- [ ] `settings.videoExport` persists and does not enter history.
- [ ] An audio-only source is rejected with a clear message.

## Verification

- `test/export.test.ts` covers fields, escaping, delimiter, header, cut vs
  defect bounds and uncut rows.
- `test/videoExport.test.ts` covers settings normalization, filter graph,
  CRF/q:v args, kept ranges, duration and progress parsing, the merge of a kept
  fragment shorter than two fades, and the one-sample NTSC overlap clamp.
- `test/audioMix.test.ts` covers the PCM mixer: sample-exact cutting without a
  crossfade, a constant level through every join, output length equal to the
  export plan, channel independence, abort and progress.
- `test/exportJob.test.ts` and `test/exportPipeline.test.ts` cover job
  resolution and the stage sequencing, cleanup, progress and cancellation
  through fake ports.
- `test/integration/contentMap.ts` is an independent model of the output built
  from the cut list, the frame rate and the fade length only; it names the
  source frame at any output frame and the source sample at any output sample,
  including inside dissolves. It is covered by `test/contentMap.test.ts`, and
  `test/integration/content.int.test.ts` uses it to check every decoded frame
  of the four-join scenario, both untouched ends against the original file
  (with negative controls that neighbouring frames differ) and the audio by
  waveform correlation at the start, inside every kept piece and at the end.
  A third scenario keeps only a three-frame fragment between two cuts under a
  five-frame fade: the fragment must be merged away, and the whole remaining
  track must still correlate with the source after the join.
- `test/integration/export.int.test.ts` (opt-in, `npm run test:integration`)
  runs the real job and pipeline against real ffmpeg: exact frame count, audio
  length against video length, a continuous colour/chirp timecode traced from
  chosen output positions back to source time (millisecond precision, so a
  sub-second drift fails), a 50/50 dissolve at the middle of a fade traced to
  the midpoint of the two source times (a hard cut would land on the incoming
  piece 0.7 s away), short-piece clamp, non-integer boundaries and 29.97 fps,
  randomised cut lists, a 400-join export that would fail to configure without
  the filter-thread cap, cancellation cleanup, scaling, and the hardware
  encoder where the host provides one.
- JSON shape is covered indirectly; extend the test when the shape changes.