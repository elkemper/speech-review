# Architecture

This document describes the current MVP implementation, not the desired state. Deferred improvements are listed in `docs/BACKLOG.md`, and consolidated requirements with status/acceptance criteria are in `docs/SPEC.md`.

## 1. Purpose and scope

The app helps review a webinar recording:

1. extract audio and transcribe speech locally;
2. find fillers, pauses, repetitions, elongations, false starts and vocal sounds;
3. jump quickly to each place and mark it as reviewed;
4. add manual marks and notes;
5. export the result to CSV/JSON.

MVP limitations:

- macOS 13+ on Apple Silicon;
- Russian is the default language (English can be selected, but quality has not been verified);
- one active project per window, no background job queue;
- dark theme only;
- word-level confidence and the `unclear` type are disabled until audio.cpp provides real values.

## 2. Processes and layers

```
┌──────────────────────────────────────────────────────────────┐
│ Renderer (React + zustand)                                   │
│  Workspace, Player, Timeline, Transcript, DefectPanel        │
│  store.ts: state, history, autosave                          │
└──────────────────────────────┬───────────────────────────────┘
                               │ window.api (contextBridge)
┌──────────────────────────────▼───────────────────────────────┐
│ Preload                                                      │
│  src/preload/index.ts — typed AppApi                         │
└──────────────────────────────┬───────────────────────────────┘
                               │ ipcRenderer.invoke / on
┌──────────────────────────────▼───────────────────────────────┐
│ Main (Electron)                                              │
│  ipc.ts, jobs.ts, projects.ts, settings.ts, export.ts        │
│  engine/: ffmpeg, chunks, wav, models, crisperwhisper, proc  │
└──────────────────────────────┬───────────────────────────────┘
                               │ spawn
┌──────────────────────────────▼───────────────────────────────┐
│ ffmpeg + audiocpp_cli + GGUF model                           │
│  fully local, no Python/torch                                │
└──────────────────────────────────────────────────────────────┘
```

`src/shared` is a common layer with no Electron or Node dependencies: types, defect rules, transcript parsing, manual marks, CSV and formatting. It is used by main, renderer and Vitest.

## 3. Module map

| Module | Responsibility |
|---|---|
| `src/main/index.ts` | app lifecycle, single-instance mode, window, menu, `app-media://` |
| `src/main/ipc.ts` | IPC handlers, dialogs, engine status, projects, export |
| `src/main/jobs.ts` | `TranscriptionManager`: start, cancel, progress, partial and final events |
| `src/main/projects.ts` | create/load/save/delete projects, write transcript and peaks |
| `src/main/settings.ts` | load/save settings, normalize old and broken values |
| `src/main/paths.ts` | `userData`, `resources`, model, project and temporary job paths |
| `src/main/mediaServer.ts` | privileged `app-media://` scheme with Range support |
| `src/main/export.ts` | save dialog and CSV/JSON writing |
| `src/main/engine/ffmpeg.ts` | probe, 16 kHz mono WAV extraction, `silencedetect` |
| `src/main/engine/chunks.ts` | silence-aware chunk plan with a shorter first chunk |
| `src/main/engine/wav.ts` | WAV parsing, slicing by seconds, waveform peaks |
| `src/main/engine/models.ts` | model download, resume, SHA-256, delete, state |
| `src/main/engine/crisperwhisper.ts` | `audiocpp_cli` invocation, `words.json` parsing, sample offset |
| `src/main/engine/proc.ts` | child processes, stdout/stderr collection, `AbortSignal` cancellation |
| `src/preload/index.ts` | `contextBridge.exposeInMainWorld('api', …)` |
| `src/shared/transcript.ts` | `parseRawWords`, `buildTranscript`, segments, active word lookup |
| `src/shared/defects.ts` | automatic rules, overrides, ordering and deduplication |
| `src/shared/marks.ts` | logical manual marks, merging, reviewed-state reconciliation |
| `src/shared/exportCsv.ts` | CSV cells, timecodes, export fields |
| `src/renderer/src/store.ts` | single app state, actions, autosave, history |
| `src/renderer/src/history.ts` | editable-state snapshots, undo/redo, action log |
| `src/renderer/src/player.ts` | `<video>` control, seek, loop, skip bypass |
| `src/renderer/src/skip.ts` | skip intervals and interval lookup by time |
| `src/renderer/src/selection.ts` | word selection, manual-mark range, nearest word |
| `src/renderer/src/timelineView.ts` | zoom, pan, LOD, ticks, defect boundaries |
| `src/renderer/src/defectsUi.ts` | labels, colors, type ordering |
| `src/renderer/src/hooks/useHotkeys.ts` | hotkeys, bulk review and bookmark shortcut |
| `src/renderer/src/components/Bookmarks.tsx` | bookmark list, notes and resume |

## 4. Startup and security

- `app.requestSingleInstanceLock()` prevents a second window; a second launch focuses the existing one.
- `BrowserWindow` uses `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`. The renderer has no direct Node access.
- Preload exposes only `window.api`, described in `src/shared/api.ts`.
- External links open through `shell.openExternal`; window navigation to `http(s)` is blocked.
- Video is served not through a local HTTP server but through the privileged `app-media://media/<token>` scheme. The token is a SHA-1 of the absolute path. `mediaServer.ts` supports `HEAD`, normal responses and `Range` (including suffix ranges), so `<video>` can seek in large files.
- CSP is not relaxed for external sources; `bypassCSP` is needed only for the `app-media` scheme.

## 5. User flow

1. **Welcome** shows the project list and an open-file button. A file can be dropped into the window.
2. `media:open` or `media:open-path` validates the extension and returns `MediaInfo`.
3. `projects:create` uses ffmpeg to check for an audio track and the duration, then creates `project.json`.
4. The user starts transcription. The store saves the project with current settings and calls `transcribe:start`.
5. The main process runs the job and sends `progress`, `partial`, `done`, `error`.
6. The renderer builds defects from the transcript, rules and manual marks and shows them on the timeline, in the transcript and in the right panel.
7. Every change to review state, notes, marks or boundaries is saved with a debounce and recorded in history.
8. Export calls `export:project`; main opens a save dialog and writes the file.

## 6. Transcription pipeline

`TranscriptionManager.start` creates a job with an `AbortController`. Only one job per project is allowed at a time.

Phases (`TranscribeProgress.phase`):

| Phase | What happens | Progress |
|---|---|---|
| `prepare` | load project, check paths, model, engine | 1–3% |
| `audio` | `probeMedia`, extract 16 kHz mono PCM WAV | 4–30% |
| `silence` | `silencedetect` to find pauses | indeterminate |
| `peaks` | waveform at 20 peaks/s, `peaks.json` | 33–44%, indeterminate |
| `transcribe` | slice and transcribe chunks | 0–100% by duration |
| `merge` | sort words, build final transcript | 98%, indeterminate |
| `done` | `done` event | 100% |

Details:

1. **Model check.** `ensureModel` verifies size and SHA-256. The result is cached in `<model>.sha256` so 1.7 GB is not hashed on every launch.
2. **Audio extraction.** ffmpeg: `-vn -map 0:a:0 -ac 1 -ar 16000 -c:a pcm_s16le`; progress is read from `-progress pipe:1`.
3. **Pauses.** `silencedetect=noise=-38dB:d=0.45`. Intervals are used only for chunking.
4. **Peaks.** `computePeaks` reads the 16-bit WAV in blocks and stores min/max per bucket. A peaks failure does not fail transcription: `peaks` stays `null`.
5. **Chunk plan.** `planChunks` cuts at silence midpoints near the target length. The first chunk is shorter (up to 3 minutes) so the first words appear sooner. The target length is configured in settings (2–15 minutes); min/max are 0.5×/1.5× of the target.
6. **WAV slicing.** `sliceWav` copies the selected frames and writes a new 44-byte header. Words are not cut in the middle when a pause is nearby.
7. **Chunk transcription.** `audiocpp_cli` runs for each chunk:
   ```
   --task asr --family crisperwhisper --model <gguf> --backend metal
   --audio <chunk.wav> --request-option language=ru
   --request-option transcription_mode=verbatim
   --request-option return_timestamps=true
   --text-out <chunk.txt> --words-out <chunk.json> --log
   ```
   The model is reloaded for each chunk — a deliberate MVP trade-off.
8. **Time offset.** `words.json` contains `start_sample`/`end_sample` at 16 kHz. `transcribeChunk` adds `offsetSec * 16000` so words land on the global recording timeline.
9. **Partial result.** After each chunk, `buildTranscript` builds the prefix, `writeTranscript(..., complete=false, resetReview=firstPartial)` writes `transcript.json`, and the renderer receives `partial`.
10. **Final result.** Words are sorted by `start_sample`, the full transcript is written with `transcriptComplete: true`, then `done` is emitted.

Cancellation: `cancel(jobId)` or `cancelProject(projectId)` calls `AbortController.abort()`. `runProcess` sends `SIGTERM`, then `SIGKILL` after 3 seconds. The temporary folder `userData/tmp/jobs/<jobId>` is removed in `finally`.

## 7. Defects and manual marks

`detectDefects(transcript, rules, marks)` is a pure function. It returns automatic and manual defects sorted by time, type and severity. Automatic defects are filtered by `minDurationByType` and optionally merged by `groupAutoDefects` before manual marks are appended.

Automatic rules (`DEFAULT_RULES`):

| Type | Condition |
|---|---|
| `filler` | event `[UH]`, `[UM]`, `[ER]`, `[HM]`, `[AH]`, `[EH]`, `[MM]` |
| `filler` | lexical fillers from `fillerWords` and `multiWordFillers` |
| `pause` | gap between adjacent words ≥ `pauseThresholdSec`; after `.?!…` it can be excluded |
| `repetition` | identical normalized words within `repetitionWindowSec` |
| `elongation` | 3+ identical letters in a row (threshold configurable) |
| `false_start` | word longer than 2 characters ends with `-` |
| `vocal_sound` | events `[LAUGHTER]`, `[COUGH]`, etc. |
| `unclear` | confidence below the threshold; effectively disabled while the engine writes `0` |

Every automatic defect is also filtered by `rules.minDurationByType[type]`. A pause measures the silence, a repetition the shorter of the repeated words.

Automatic defect ID: `auto-${type}-${sequence}`, where `sequence` is the global insertion order. IDs are not stable when rules change or the recording is re-transcribed.

**Automatic grouping.** When `rules.autoGroupGapSec > 0`, `groupAutoDefects` walks the sorted automatic defects and merges neighbours while the gap is within the limit and no other spoken word lies in that gap. A pause spans only the silence, so a filler immediately before it forms one group, while a filler separated by a real word does not. The group gets the id `auto-group-${firstDefectId}`, combined bounds and words, `groupIds`, `groupTypes` and the highest severity. `0` disables grouping, which is the default.

`applyDefectOverrides` applies `Project.defectOverrides` on top of automatic defects. Manual marks do not use overrides: their boundaries are stored in the marks themselves.

Manual marks:

- `ManualMark` contains exact `wordIds`, `start`, `end`, an optional `groupId`, a note and `createdAt`.
- `groupManualMarks` groups by `groupId`; a mark without a group is treated as a single mark.
- `mergeMarkNeighbours` merges only changed marks with those they touch (gap ≤ 0.2 s). This happens on add and on boundary move, not on every render.
- `detectDefects` builds one `Defect` for a group with ID `manual-group-${groupId}` or `manual-${markId}` and combined `wordIds`.
- Old marks without `wordIds` use strict interval overlap (`findWordIdsInRange`), not boundary touching.

## 8. Review, history and skip

- `Project.reviewedDefectIds` stores reviewed defect IDs. Manual marks use `manual-${markId}` or `manual-group-${groupId}`.
- `reconcileReviewedIds(before, after, reviewedIds)` recomputes manual IDs after add, merge, split or move. A logical mark stays reviewed only if all its parts were reviewed before the change.
- Notes are stored in `Project.defectNotes` by defect ID; for manual marks they are duplicated in `ManualMark.note`.
- History (`src/renderer/src/history.ts`) stores snapshots of editable state only: `marks`, `reviewedDefectIds`, `defectNotes`, `defectOverrides`. Rapid changes with the same `mergeKey` within 2 seconds are coalesced. History lives in memory and is reset when a project is opened or closed.
- `buildSkipIntervals` takes defects only, excludes `reviewed`, adds before/after padding, clamps to the duration and merges overlapping intervals. Padding comes from `playback.paddingByType[defect.type]`; a logical group (manual or automatic) uses `playback.groupPadding` instead. `skipScope: 'marks'` keeps only `source === 'manual'`. Padding settings are editable regardless of `skipEnabled`.
- `player.ts` jumps over an interval once so it does not fight the seek. The "listen" button temporarily disables skipping for the selected defect.

## 9. UI

`Workspace` is the main grid: video and timeline on top, transcript on the left, defect panel on the right. The panel can be hidden and resized; width and visibility are stored in `localStorage` (`sr.panelWidth`, `sr.panelVisible`). Two horizontal splitters resize the video area (`sr.videoHeight`) and the timeline (`sr.timelineHeight`); the transcript takes the remaining height. A bookmarks popover lists `project.bookmarks` and seeks to them.

### Player

- `<video src="app-media://…">`, custom controls, speed 0.5–2×, volume, fullscreen.
- `requestAnimationFrame` updates `currentTime`, handles loop and skip.
- A codec error is shown to the user but does not prevent transcription: ffmpeg reads the file independently.

### Timeline

Canvas waveform with zoom and pan:

- `Ctrl`/`Cmd` + wheel zooms around the cursor, normal wheel pans;
- `+`, `−`, `⤢` buttons;
- `follow` keeps the playhead visible until the user starts panning;
- bookmarks are drawn as green flags and dashed lines;
- LOD: waveform and defect markers first, then word marks, boundaries and labels;
- click seeks; `Shift`+click/drag selects words; clicking a marker selects a defect;
- `Shift+R` reviews every defect touched by the current selection;
- the active defect has two draggable boundaries. An automatic defect is saved in `defectOverrides`; a manual mark updates its `start`/`end` and `wordIds`;
- skip intervals are highlighted in yellow.

### Transcript

- Virtualized segment list (`@tanstack/react-virtual`).
- Click a word to seek; `Shift`+click and drag select; `M` creates a mark using exact boundaries.
- A selection that contains defects can be reviewed at once with `Shift+R`; the toolbar shows the count.
- Pauses are shown as chips after a word; long sentence-boundary pauses are shown as a separate row.
- Defect, reviewed-word and skipped-place highlighting.
- "Only with defects", "Follow" and "Copy" buttons.

### DefectPanel

- Filters by type, "only unreviewed", counters; `settings.hideReviewed` removes reviewed items entirely.
- A selected range with defects shows "проверить выделение" (review the selection).
- Mark as reviewed, note, "listen", loop, delete and "split" for manual marks.
- Jump to the next unreviewed defect.
- CSV/JSON export.

### SettingsDialog

Three tabs:

- **General** — engine, model (download/delete), language, backend, chunk size, licenses;
- **Defects** — skip mode, per-type and group padding, defect rules with sliders, per-type minimum duration, automatic grouping and hiding reviewed defects;
- **Export** — CSV fields, delimiter, header.

### Hotkeys

`useHotkeys` matches `event.code` first, so the Russian keyboard layout does not break `R`, `M`, `B`, `[`, `]`, `J`, `K`. Hotkeys are disabled in input fields. `Shift+R` reviews the selected words, `B` adds a bookmark.

## 10. Export

- CSV: selected fields in the configured order, delimiter `;` or `,`, BOM `\uFEFF`, CRLF. Fixed-width `HH:MM:SS.mmm` timecodes.
- JSON: project metadata, `counts` by type, full `defects` and `marks` arrays.
- The file is written to the selected path; the dialog defaults to Downloads.

## 11. Persistence and IPC

Schema, IDs and migration rules are described in `docs/DATA_MODEL.md`.

Main IPC groups:

| Group | Channels |
|---|---|
| Engine/settings | `engine:status`, `settings:get`, `settings:save` |
| Media | `media:open`, `media:open-path`, `media:register` |
| Projects | `projects:list`, `projects:create`, `projects:load`, `projects:save`, `projects:delete` |
| Transcription | `transcribe:start`, `transcribe:cancel`, `transcribe:progress`, `transcribe:partial`, `transcribe:done`, `transcribe:error` |
| Models | `models:download`, `models:state`, `models:delete`, `models:progress` |
| Export/shell | `export:project`, `shell:show-item` |

## 12. Known limitations

- The model is reloaded between chunks.
- Interrupted transcription cannot be resumed.
- Automatic IDs depend on order, so changing rules resets the review mapping.
- No diarization, transcript search, SRT/VTT or light theme.
- No e2e tests and no real Electron/engine verification in the Linux container.

Full list — `docs/BACKLOG.md`.
