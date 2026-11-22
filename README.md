# Speech Review

A local app for reviewing webinar recordings: it transcribes speech, finds fillers, pauses, false starts, repetitions and elongations, and lets you jump to any moment by clicking a word.

The MVP targets macOS + Apple Silicon. Processing is fully local: the recording and transcript never leave the machine. The network is used only for the one-time model download.

**Русская версия:** [`README.RU.md`](README.RU.md)

## Features

- Transcription with **CrisperWhisper 2.0** through the native **audio.cpp** runtime with Metal.
- Long recordings are split at pauses; the first chunk is shorter, so the first words appear sooner.
- The partial transcript is saved after every chunk and is immediately available for review.
- Waveform with zoom, pan, defect markers, colored word underlays and word selection.
- Display-only waveform contrast lifts quiet speech above the noise floor, so speech and real silence are easy to tell apart; adjustable in Settings.
- Click a word or a marker to seek the video to that point.
- Defect queue: filters, confirmation/deletion, notes, manual marks.
- Adjacent manual marks merge into one logical mark: it can be confirmed once, split back or deleted as a whole.
- The selected defect or mark shows its original span as a fill and its final cut as draggable handles; dragging a cut handle onto a neighbouring mark merges them.
- Undo/redo (`⌘Z` / `⇧⌘Z`) with an action history dialog; defect-rule and skip-padding changes roll back together with the recalculated defect list and intervals.
- The defect panel can be resized by dragging its edge and hidden completely; the video and timeline heights are adjustable the same way.
- The selected defect shows a mini waveform in the right panel with ±3 s context (configurable), draggable cut handles, 1–4× zoom with horizontal panning, faint neighbouring marks, colored word underlays and the same playhead as the main timeline.
- Word selection with click, `Shift`+click or drag; a mark uses the exact selection boundaries.
- Selected words can be confirmed with `Shift+Enter` or deleted with `Shift+R` when they contain defects.
- Bookmarks: `B` remembers a place, the list returns to it and can resume from the last one.
- Thresholds are edited with a slider and a number field; every defect type has a minimum duration, and neighbouring defects can be grouped automatically.
- A word whose short defect is below the threshold opens a temporary «кандидат» card when clicked. Resize, confirm, delete or add a note to keep it as a real defect.
- Skip padding is configured per defect type and per group; a pause keeps a configurable amount of room tone instead of being cut to zero. The handles on the timeline set the final cut; the fill stays the original defect. Double-click a handle to return to the derived cut.
- Loop over a fragment, speed 0.5–2×, hotkeys.
- Skip mode: during playback, automatically cut every defect and manual mark except deleted ones, with configurable padding. A confirmed defect keeps the cut it had at confirmation, so later padding changes do not move it.
- Deleted defects stay as thin cards with an undo button when "Show deleted defects" is enabled. Confirmed cards collapse to a compact row with an undo button. Pending cards have delete/confirm buttons on the left.
- Export defects to CSV (Excel) and JSON; CSV fields and delimiter are configurable. The base CSV columns are the final cut bounds; the original defect bounds are optional extra columns. JSON also contains the merged `cuts` list for a video editor.
- Export a clean video from the current marks: resolution, three quality presets, and software H.264/HEVC or hardware VideoToolbox encoders. Progress can be cancelled; the source file is never modified.
- Photoshop-like dark theme, automatic project save after every action.

## Requirements

- macOS 13+ on Apple Silicon (M1/M2/M3/M4/M5).
- Node.js 20+ and npm for building.
- ~3 GB of free space: engine ~100 MB, ffmpeg ~80 MB, model ~1.6 GB.
- 8 GB RAM or more.

## Quick start

```bash
npm install
npm run fetch:engine
npm run dev
```

`npm run fetch:engine` downloads into `resources/`:

- `engine/` — `audiocpp_cli` from audio.cpp v0.9.4 (macOS arm64 Metal);
- `ffmpeg/ffmpeg` — static ffmpeg 6.1.1.

Then in the app:

1. Open **Settings** → **General** → **Download model** (Q8_0, ~1.6 GB). A downloaded model can also be deleted there.
2. Click **Open recording** and choose MP4/MOV/MKV/MP3/WAV.
3. Click **Transcribe**. Finished chunks appear in the transcript as they are processed.
4. Review defects on the right: confirm real ones or delete false positives, then export CSV/JSON or a clean video with **Экспорт видео…**.

The model is downloaded from Hugging Face and verified by SHA-256. It does not need to be downloaded again.

## Building a DMG

```bash
npm run package:mac
```

The script checks the platform (`npm run check:platform`), checks for the engine and ffmpeg (`npm run check:resources`), builds the app and places the DMG in `dist/`.

Checking the logic without launching Electron:

```bash
npm test
npm run typecheck
```

The build is ad-hoc signed (`codesign --sign -`) but not notarized. If macOS blocks the first launch:

```bash
xattr -cr "/Applications/Speech Review.app"
open "/Applications/Speech Review.app"
```

Or right-click the app → **Open** → **Open**.

## Hotkeys

| Keys | Action |
|---|---|
| `Space` | play / pause |
| `←` / `→` | −2 / +2 seconds |
| `Shift` + `←` / `→` | −10 / +10 seconds |
| `[` / `]` | previous / next defect |
| `K` | toggle fast-forward (skip) mode |
| `Enter` | confirm the active defect |
| `R` | delete the active defect |
| `Shift+Enter` | confirm every defect in the selection |
| `Shift+R` | delete every defect in the selection |
| `M` | add a manual mark: over selected words or at the current position |
| `B` | add a bookmark at the current position |
| `L` | toggle loop over the active defect |
| `F` | follow the currently playing word |
| `1`–`6` | speed 0.5, 0.75, 1, 1.25, 1.5, 2× |
| `Home` / `End` | jump to the start / end |
| `Cmd+O` | open a recording |

In skip mode the confirm/delete/mark hotkeys work only while playback is paused.
| `Cmd+,` | settings |
| `Cmd+Z` / `Ctrl+Z` | undo |
| `Shift+Cmd+Z` / `Ctrl+Y` | redo |
| `Esc` | clear loop / selection |

Clicking the waveform seeks; clicking a defect marker or its cut region selects the defect. Clicking a word in the transcript seeks to its start.

Word selection in the transcript: a normal click selects one word, `Shift`+click extends the range, dragging selects several words. The `M` mark uses the exact selection boundaries. On the timeline, `Shift`+drag selects an exact time range and `M` creates a manual mark with those bounds. `Ctrl`/`Cmd`+wheel changes zoom, normal scrolling pans; the `+`, `−` and `⤢` buttons duplicate this with the mouse.

Selecting a defect in the list or transcript shows two vertical cut handles on the timeline; they can be dragged with the mouse. The fill behind them is the original detected/marked span: padding appears as a hatch in the defect type color outside it, kept room tone as a neutral, slightly lighter background hatch inside it. Dragging a manual mark's cut handle onto a neighbouring mark merges them into a logical mark; the "split" button in the panel restores separate marks. Double-click a handle to drop the manual cut and return to the derived padding. The defect panel width is changed by dragging its left edge; it is hidden with the `⟩` button and restored with the "Defects" button in the header. Dragging the horizontal splitters changes the height of the video area and the timeline; the transcript takes the remaining space.

On the **Defects** settings tab, each defect type is one row: an enable checkbox, minimum duration, before/after skip padding and the controls that belong to that type (pause is the last row; its minimum duration is the silence threshold, and the row also holds the kept room tone and sentence-end rule). "Auto-group" has its own checkbox and maximum gap; turning it off keeps the gap for next time. Skip mode and what it skips are controlled in the player (the ⏭ button), not in Settings.

## Default defect rules

| Type | Condition | Severity |
|---|---|---|
| `filler` | `[UH]`, `[UM]`, `[ER]`, `[HM]` from CrisperWhisper | high |
| `filler` | words "э", "эм", "ну", "вот", "типа", "короче", "как бы", etc. | low |
| `pause` | gap between words ≥ 1.2 s (minimum duration) | medium |
| `repetition` | the same word within 2 s | medium |
| `elongation` | 3+ identical letters in a row | medium |
| `false_start` | word longer than 2 characters ends with `-` | medium |
| `vocal_sound` | other events `[laughter]`, `[cough]`, etc. | low |
| `unclear` | low confidence | **disabled** |

A pause after `.`, `?`, `!` or `…` is not considered a defect by default: it is a normal inter-sentence stop. The threshold, repetition window and lexical fillers are configurable in the app without rebuilding or re-transcribing.

## How it works

```
React renderer
   │  window.api (preload, contextBridge)
   ▼
Electron main
   ├─ ffmpeg: extract 16 kHz mono WAV, silencedetect
   ├─ split WAV at pause midpoints; first chunk up to 3 min, later chunks per setting
   ├─ audiocpp_cli --family crisperwhisper --backend metal
   ├─ merge words.json from all chunks → transcript.json
   ├─ waveform peaks.json
   └─ project: project.json + transcript.json + peaks.json
```

- Video is served to the renderer through the privileged `app-media://` scheme with HTTP Range support. No separate HTTP server is started.
- The engine runs as a separate process for each chunk. The model is reloaded between chunks — a deliberate trade-off for MVP simplicity.
- `words.json` from audio.cpp contains `start_sample`/`end_sample` at 16 kHz. The parser tolerates trailing commas.
- Defects are computed in the renderer from the transcript and rules. Confirmed and dismissed IDs, deleted manual marks and notes are stored in `project.json`.
- The partial transcript is written with `transcriptComplete: false`; on the first partial result, old confirmation and dismissal state is reset because the transcript was rebuilt and old matches may have changed. Manual marks are preserved.
- Skip mode does not re-encode video: during playback the position jumps over the final cut ranges built from all defects and marks except deleted ones. "Before/after" padding is configured per defect type and per group, and pauses keep a configurable amount of silence so cuts do not sound clipped. Dragging a handle stores an explicit cut that wins over padding; double-clicking it restores the derived cut. Confirming a defect freezes its cut at the current padding, so later padding changes do not move it.

## Where data lives

```
~/Library/Application Support/Speech Review/
├── settings.json
├── models/CrisperWhisper2.0-GGUF/
├── projects/<uuid>/
│   ├── project.json
│   ├── transcript.json
│   └── peaks.json
└── tmp/jobs/
```

Deleting a project in the app deletes its folder. The video file is not copied or modified.

## Troubleshooting

**"audio.cpp engine not found" / "ffmpeg not found"**

```bash
npm run fetch:engine
```

Then restart the app. Settings has a "check" button and the binary paths.

**The model fails SHA-256 verification**

Delete the incomplete file in `~/Library/Application Support/Speech Review/models/CrisperWhisper2.0-GGUF/` and download it again. The download supports resuming after an interruption.

**Video does not play**

Chromium does not support some codecs (for example, certain MKV/HEVC files). Transcription still works because ffmpeg extracts the audio. To play the file, re-encode it to MP4/H.264:

```bash
ffmpeg -i input.mkv -c:v libx264 -c:a aac -movflags +faststart output.mp4
```

**It takes a long time**

Reference for M4 Pro: 10 minutes of audio ≈ 1.5 minutes of transcription (RTF ≈ 0.15). M5 Air may be a little slower. To speed it up, select the Q4_K model in settings — quality will be lower.

**The app is blocked by macOS**

See the ad-hoc signing section above.

## MVP limitations

- Apple Silicon and macOS only. Windows/Linux builds have not been tested.
- No word-level confidence: audio.cpp writes `confidence: 0`, so the `unclear` type is disabled. See `docs/BACKLOG.md`.
- No diarization or speaker separation.
- One active project per window; background jobs are not queued.
- If the app crashes, an unfinished transcription starts over. Completed projects are saved.
- The model is distributed under a non-commercial research license.

## Developer documentation

- [`docs/SPEC.md`](docs/SPEC.md) — spec index; ordered story files in [`docs/spec/`](docs/spec/) with acceptance criteria.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — processes, modules, transcription pipeline, IPC and UI.
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — setup, scripts, resources, DMG build and debugging.
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) — project, transcript, defects, manual marks, IDs and history.
- [`docs/TESTING.md`](docs/TESTING.md) — tests, fixtures, coverage and environment limits.
- [`docs/BACKLOG.md`](docs/BACKLOG.md) — deferred work.
- [`AGENTS.md`](AGENTS.md) — rules and invariants for coding agents.

## Licenses

- Application code — MIT.
- audio.cpp — Apache-2.0.
- ffmpeg 6.1.1 (static build from `ffmpeg-static` releases) — GPL-3.0.
- CrisperWhisper 2.0 weights — **Nyra Health Non-Commercial Research License**. Use of the model is governed by its license; commercial use requires separate permission from the rights holder.

See [`docs/BACKLOG.md`](docs/BACKLOG.md) for the list of improvements.
