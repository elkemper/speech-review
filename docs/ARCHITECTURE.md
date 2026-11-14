# Architecture

This document describes **how the current MVP is built**: processes, modules, data flow and runtime constraints. It does not own product behavior.

| Question | Owner |
|---|---|
| What must the app do, and what is its status? | `docs/SPEC.md` and `docs/spec/` |
| Where is data stored, and which IDs are stable? | `docs/DATA_MODEL.md` |
| What is deferred? | `docs/BACKLOG.md` |
| How are the pieces wired together? | this document |

If a sentence describes a user scenario, it belongs in the spec. If it names a field, an ID or a file on disk, it belongs in `DATA_MODEL.md`. Keep this file focused on processes, modules, ordering and implementation constraints.

## 1. Purpose and scope

Speech Review is a local macOS app for reviewing webinar recordings: it extracts audio, transcribes it with CrisperWhisper 2.0 through `audiocpp_cli`, detects speech defects and supports a review workflow with export.

MVP constraints:

- macOS 13+ on Apple Silicon is the only verified target.
- Everything is local: only the model and engine/ffmpeg downloads use the network.
- One project per window, no background job queue.
- Dark theme only.
- `unclear` / word-level confidence stays disabled while the engine writes `confidence: 0`.

User-facing features are listed in `README.md`; the requirement index is `docs/SPEC.md`.

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

`src/shared` is a dependency-free layer used by main, renderer and Vitest: types, transcript parsing, defect rules, manual marks, CSV and formatting. It must not import Electron, Node-only APIs or renderer code.

## 3. Module map

| Area | Modules | Responsibility |
|---|---|---|
| App shell | `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/components/Welcome.tsx`, `src/renderer/src/components/Workspace.tsx` | lifecycle, window, menu, typed bridge, entry screen and main grid |
| IPC and persistence | `src/main/ipc.ts`, `src/main/projects.ts`, `src/main/settings.ts`, `src/main/paths.ts`, `src/main/export.ts`, `src/main/videoExport.ts` | handlers and dialogs, project files, settings normalization, paths, CSV/JSON/video export |
| Media | `src/main/mediaServer.ts` | privileged `app-media://` scheme with Range support |
| Engine | `src/main/engine/ffmpeg.ts`, `chunks.ts`, `wav.ts`, `models.ts`, `crisperwhisper.ts`, `proc.ts` | probe/extract/silence, chunk plan, WAV slicing/peaks, model state, CLI invocation, child processes |
| Shared domain | `src/shared/types.ts`, `transcript.ts`, `defects.ts`, `marks.ts`, `settings.ts`, `models.ts`, `exportCsv.ts`, `videoExport.ts`, `format.ts`, `ipc.ts`, `api.ts` | canonical types, pure rules, parsing, export and formatting |
| Renderer state | `src/renderer/src/store.ts`, `history.ts`, `settingsHistory.ts` | app state, save orchestration, undo/redo snapshots and settings labels |
| Renderer logic | `src/renderer/src/player.ts`, `skip.ts`, `selection.ts`, `timelineView.ts`, `defectsUi.ts`, `defectCardView.ts`, `miniTimeline.ts`, `waveform.ts`, `hooks/useHotkeys.ts` | playback control, intervals, selection, timeline math, labels/cards, mini window, waveform, hotkeys |
| UI components | `src/renderer/src/components/Player.tsx`, `Timeline.tsx`, `Transcript.tsx`, `DefectPanel.tsx`, `SettingsDialog.tsx`, `DefectRulesSection.tsx`, `SettingsRangeField.tsx`, `HistoryDialog.tsx`, `Bookmarks.tsx`, `MiniTimeline.tsx`, `VideoExportDialog.tsx` | rendering and user interaction |

`AGENTS.md` contains the full repository tree; this table is the responsibility map.

## 4. Startup, security and media

- `app.requestSingleInstanceLock()` prevents a second window; a second launch focuses the existing one.
- `BrowserWindow` uses `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`. The renderer has no direct Node access.
- Preload exposes only `window.api`, described in `src/shared/api.ts`.
- External links open through `shell.openExternal`; navigation to `http(s)` inside the window is blocked.
- Video is served through the privileged `app-media://media/<token>` scheme, not a local HTTP server. The token is a SHA-1 of the absolute path. `mediaServer.ts` supports `HEAD`, normal responses and `Range` (including suffix ranges), so `<video>` can seek in large files.
- CSP is not relaxed for external sources; `bypassCSP` is needed only for the `app-media` scheme.

## 5. End-to-end flow

1. **Welcome** lists projects and opens a file (button or drop). `media:open` / `media:open-path` validates the extension and returns `MediaInfo`.
2. `projects:create` probes the audio track and duration with ffmpeg, then writes `project.json`.
3. The store saves the project with the current settings and calls `transcribe:start`.
4. Main runs the job and emits `progress`, `partial`, `done` or `error`.
5. The renderer derives defects from the transcript, project rules and manual marks, and updates the timeline, transcript and defect panel.
6. Editable changes are debounced to disk and recorded in history. Export calls `export:project` for CSV/JSON or `export:video` for the clean video; main opens a save dialog, runs ffmpeg for video, and writes the file.

Behavior of each screen and action is defined in the spec files listed in §10.

## 6. Transcription pipeline

`TranscriptionManager.start` creates a job with an `AbortController`. Only one job per project is allowed at a time.

| Phase | What happens | Progress |
|---|---|---|
| `prepare` | load project, check paths, model and engine | 1–3% |
| `audio` | `probeMedia`, extract 16 kHz mono PCM WAV | 4–30% |
| `silence` | `silencedetect` to find pauses | 31%, indeterminate |
| `peaks` | waveform at 20 peaks/s, write `peaks.json` | 33–44%, indeterminate |
| `transcribe` | slice and transcribe chunks | 0–100% by processed duration |
| `merge` | sort words, build the final transcript | 98%, indeterminate |
| `done` | `done` event | 100% |

Details:

1. **Model check.** `ensureModel` verifies size and SHA-256. The result is cached in `<model>.sha256`, so the 1.7 GB file is not hashed on every launch.
2. **Audio extraction.** ffmpeg runs `-vn -map 0:a:0 -ac 1 -ar 16000 -c:a pcm_s16le`; progress is read from `-progress pipe:1`.
3. **Pauses.** `silencedetect=noise=-38dB:d=0.45`. The intervals are used only for chunking.
4. **Peaks.** `computePeaks` reads the 16-bit WAV in blocks and stores min/max per bucket. A peaks failure does not fail transcription: `peaks` stays `null`.
5. **Chunk plan.** `planChunks` cuts at silence midpoints near the target length. The target is configurable (120–900 s, default 600); min/max are 0.5×/1.5× of the target. The first chunk is `clamp(30% of target, 90–180 s)` so the first words appear sooner.
6. **WAV slicing.** `sliceWav` copies the selected frames and writes a new 44-byte header. Cuts prefer a nearby pause so words are not split.
7. **Chunk transcription.** `audiocpp_cli` runs for each chunk:
   ```
   --task asr --family crisperwhisper --model <gguf> --backend metal
   --audio <chunk.wav> --request-option language=ru
   --request-option transcription_mode=verbatim
   --request-option return_timestamps=true
   --text-out <chunk.txt> --words-out <chunk.json> --log
   ```
   The model is reloaded for each chunk — a deliberate MVP trade-off.
8. **Time offset.** `words.json` contains `start_sample`/`end_sample` at 16 kHz. `transcribeChunk` adds `offsetSec * 16000`, so words land on the global recording timeline.
9. **Partial and final results.** After each chunk, the recognized prefix is written and emitted as `partial`; the first partial resets the review mapping because automatic IDs may change, later partials preserve edits in the visible prefix. Final words are sorted by `start_sample`, written with `transcriptComplete: true`, then `done` is emitted. The reset rules live in `DATA_MODEL.md` §10.
10. **Cancellation.** `cancel(jobId)` / `cancelProject(projectId)` aborts the controller. `runProcess` sends `SIGTERM`, then `SIGKILL` after 3 seconds. `userData/tmp/jobs/<jobId>` is removed in `finally`.

## 7. Derived review state

The defect list is computed, never stored. The renderer applies one ordered pipeline:

```
transcript + rules + marks
  → detectDefectsWithCandidates   (automatic rules, minimum-duration candidates,
                                   auto grouping, manual defects, dismissed members)
  → cutRangeFor(defect, playback, duration, project.cutOverrides[id])
  → confirmed / dismissed / notes injected from Project
  → Defect[] shown by the UI and used by skip intervals
```

- `src/shared/defects.ts` owns detection and grouping. `src/shared/marks.ts` owns logical marks and confirmation reconciliation. `src/shared/cuts.ts` owns the final cut range, the cut list and the complement used by video export. All three are pure and tested without Electron.
- `Project` is the source of truth for editable state: marks, cut overrides, confirmed IDs, dismissed IDs/marks, notes, rules and skip padding.
- History (`history.ts`) snapshots only that editable state; `skipEnabled` is player state. See `docs/SPEC.md` (story 32/47) and `DATA_MODEL.md` §9.
- `src/renderer/src/skip.ts` re-exports `shared/cuts.ts`. `buildCutList` derives every non-dismissed cut, applies per-type or group padding plus the pause room tone, clamps to the duration and merges overlaps; it does not depend on skip mode. `buildSkipIntervals` is the same list only while skip mode is on. Video export uses the same list through `complementRanges`.
- A revealed minimum-duration candidate is computed from the active ID and disappears when selection changes; only an explicit cut edit, confirmation, deletion or note promotes it into project state.

The rules themselves — thresholds, enable flags, grouping conditions, candidate promotion and confirmation semantics — are specified in `docs/spec/02-defects.md` and `docs/spec/03-marks.md` and stored as described in `DATA_MODEL.md` §6–8. Do not restate them here.

## 8. Renderer architecture

- `Workspace` is a grid: video and timeline on top, transcript on the left, defect panel on the right. Panel visibility/width and the two vertical sizes persist in `localStorage` (`sr.panelVisible`, `sr.panelWidth`, `sr.videoHeight`, `sr.timelineHeight`).
- `Player` wraps `<video src="app-media://…">` with custom controls. A `requestAnimationFrame` loop syncs `currentTime`, loop and skip. A codec error is shown to the user but does not block transcription, because ffmpeg reads the file independently.
- `Timeline` draws a canvas waveform. `timelineView.ts` owns zoom/pan, ticks and level-of-detail thresholds; `waveform.ts` owns the display-only contrast lookup table. The timeline reads defects, selection and skip intervals from the store rather than deriving its own.
- `Transcript` uses `@tanstack/react-virtual` for the segment list. Word selection and exact time selection stay separate: the transcript is word-based, the timeline is exact-time based.
- `DefectPanel` renders computed `Defect` objects; `defectCardView.ts` derives card layout from the defect and skip state. The mini timeline reuses the shared playhead and the same `setCutBounds` action as the main timeline.
- `SettingsDialog` owns the tabbed settings UI. While a recognition job runs, the tabs and body sit inside an `inert` flex container; the scroll body keeps its constrained layout.
- `useHotkeys` matches `event.code` first, so hotkeys keep working on the Russian keyboard layout. They are disabled in text fields.

Interaction details, acceptance criteria and statuses are defined in the spec files below; this section only names the implementation boundary of each component.

## 9. Persistence, export and IPC

Project, transcript, peaks and settings schemas, IDs, migrations and write ordering live in `docs/DATA_MODEL.md`. File writes are atomic (`*.tmp` + `rename`). CSV/JSON details and field selection are defined in `docs/spec/09-export.md` and `DATA_MODEL.md` §12.

Main IPC groups:

| Group | Channels |
|---|---|
| Engine/settings | `engine:status`, `settings:get`, `settings:save` |
| Media | `media:open`, `media:open-path`, `media:register` |
| Projects | `projects:list`, `projects:create`, `projects:load`, `projects:save`, `projects:delete` |
| Transcription | `transcribe:start`, `transcribe:cancel`; events: `transcribe:progress`, `transcribe:partial`, `transcribe:done`, `transcribe:error` |
| Models | `models:download`, `models:state`, `models:delete`; event: `models:progress` |
| Export/shell | `export:project`, `export:video`, `export:video:cancel`, `shell:show-item`; event: `export:video:progress` |

`invoke` channels return a result and fail through a rejected promise. Progress, partial, done, error and model-progress channels are main→renderer events and are subscribed to through preload.

## 10. Spec map

| Subsystem | Spec files |
|---|---|
| Settings, model management, recognition placement | [`01-settings.md`](spec/01-settings.md) |
| Defect rules, minimum duration, candidates, grouping | [`02-defects.md`](spec/02-defects.md) |
| Manual marks, selection, confirmation, defect cards | [`03-marks.md`](spec/03-marks.md), [`10-mini-timeline.md`](spec/10-mini-timeline.md) |
| Timeline, waveform, exact time selection, underlays, contrast | [`04-timeline.md`](spec/04-timeline.md), [`04a`](spec/04a-waveform-selection.md), [`04b`](spec/04b-word-underlays.md), [`04c`](spec/04c-waveform-contrast.md) |
| Transcript, seeking, sync, follow, partials | [`05-transcript.md`](spec/05-transcript.md) |
| Playback, skip/padding, listen, bookmarks, clean playback | [`06-playback.md`](spec/06-playback.md), [`06a`](spec/06a-clean-playback.md) |
| Layout, undo/redo, visual language | [`07-layout-history-visual.md`](spec/07-layout-history-visual.md), [`07a`](spec/07a-visual-refresh.md) |
| Progress, chunk length, streaming ASR | [`08-processing-progress.md`](spec/08-processing-progress.md), [`08a`](spec/08a-streaming-asr.md) |
| CSV, JSON and video export | [`09-export.md`](spec/09-export.md) |

Status triage and cross-cutting product invariants are in [`SPEC.md`](SPEC.md).

## 11. Known limitations

- The model is reloaded between chunks, and interrupted transcription cannot be resumed.
- Automatic IDs depend on detection order, so changing rules can reset the review mapping.
- No diarization, transcript search, SRT/VTT or light theme.
- Video export in stream-copy mode cuts at keyframes; only a re-encode is
  frame-accurate. Audio-only export is not implemented.
- No e2e tests; Electron, real media playback, the engine and packaging are not verified in the Linux development container.

Full deferred list — `docs/BACKLOG.md`; platform and test limits — `docs/TESTING.md` and `docs/DEVELOPMENT.md`.
