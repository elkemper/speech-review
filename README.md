# Speech Review

A local macOS app for reviewing webinar recordings. It transcribes the recording on your Mac, finds filler words, pauses, false starts, repetitions and elongations, and lets you jump to any moment by clicking a word. Confirm the real defects, delete false positives, then export a clean video or a list of cuts.

Everything runs on your machine: the recording and transcript never leave the computer. The network is used only for the one-time model download.

**Русская версия:** [`README.RU.md`](README.RU.md)

## Download and install

The ready-to-use DMG is published in the **Releases** section of the project page on GitHub: open the latest release and download the DMG for Apple Silicon.

Requirements: macOS 13 or newer on Apple Silicon, about 3 GB of free disk space and 8 GB of RAM.

1. Open the DMG and drag **Speech Review** into **Applications**.
2. On first launch macOS may block the app because the build is ad-hoc signed but not notarized. Right-click the app → **Open** → **Open**, or run once:
   ```bash
   xattr -cr "/Applications/Speech Review.app"
   ```
3. In **Settings → General** click **Download model** (Q8_0, ~1.6 GB). This is done once; the model is verified by SHA-256.

## Getting started

1. Click **Open recording** and choose an MP4, MOV, MKV, MP3 or WAV file.
2. Click **Transcribe**. Finished chunks appear in the transcript while the rest is still being processed.
3. Review the defects on the right: confirm real ones, delete false positives, add notes or manual marks.
4. Click a word or a marker to jump to it. Enable skip mode to listen without defects.
5. Export CSV/JSON or a clean video with **Export video…**.

## Features

- On-device transcription with CrisperWhisper 2.0 on the audio.cpp Metal runtime; long recordings are split at pauses, and the partial transcript is available as chunks finish.
- Waveform with zoom, pan, defect markers, colored word underlays and word selection; click a word or marker to seek.
- Automatic detection of fillers, pauses, false starts, repetitions, elongations and vocal sounds, with configurable thresholds and automatic grouping of neighbouring defects.
- Defect queue with filters, confirmation, deletion, notes and manual marks; adjacent marks merge into one logical mark that can be confirmed, split or deleted as a whole.
- Editable cut boundaries: the fill shows the detected span, draggable handles set the final cut, and per-type padding plus a configurable pause room tone keep cuts from sounding clipped.
- Skip mode during playback cuts every defect and manual mark except dismissed ones; a confirmed defect keeps the cut it had at confirmation.
- Undo/redo with an action history dialog, automatic project save after every action, bookmarks, loop and playback speed 0.5–2×.
- CSV/JSON export with configurable fields and delimiter; clean video export with resolution, quality presets, software or hardware VideoToolbox encoders, an optional audio/video crossfade at every join, progress and cancel.
- Excel-like **defect table** in a separate window: the exported CSV view with resizable columns, row selection and bulk delete, adding rows with an exact time and note, in-place editing of time and note cells, note copy/paste, undo/redo, click sync with the main window, and an optional light theme for the table window.
- Interface in Russian and English; the main window is dark, and the defect table window can switch to light.

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
| `Cmd+,` | settings |
| `Cmd+Z` / `Ctrl+Z` | undo |
| `Shift+Cmd+Z` / `Ctrl+Y` | redo |
| `Esc` | clear loop / selection |

In skip mode the confirm/delete/mark hotkeys work only while playback is paused.

## Working with the timeline and transcript

- Clicking the waveform seeks; clicking a defect marker or its cut region selects the defect. Clicking a word in the transcript seeks to its start.
- Word selection in the transcript: a normal click selects one word, `Shift`+click extends the range, dragging selects several words. The `M` mark uses the exact selection boundaries. On the timeline, `Shift`+drag selects an exact time range and `M` creates a manual mark with those bounds.
- Selecting a defect shows two cut handles on the timeline and a mini waveform with ±3 s of context in the right panel. The fill behind the handles is the original detected or marked span: padding appears as hatching in the defect type color outside it, kept room tone as a lighter neutral hatch inside it.
- Dragging a manual mark's cut handle onto a neighbouring mark merges them into a logical mark; the **split** button in the panel restores separate marks. Double-click a handle to drop the manual cut and return to the derived padding.
- Drag the left edge of the defect panel to resize it, `⟩` hides it, and **Defects** in the header brings it back. Horizontal splitters change the heights of the video area and the timeline.
- `Ctrl`/`Cmd`+wheel changes zoom, normal scrolling pans; the `+`, `−` and `⤢` buttons do the same with the mouse.
- On the **Defects** settings tab each defect type is one row: an enable checkbox, minimum duration, before/after skip padding and the controls that belong to that type. Pause is the last row; its minimum duration is the silence threshold, and the row also holds the kept room tone and the sentence-end rule. Auto-group has its own checkbox and maximum gap. Skip mode itself is toggled in the player (⏭), not in Settings.

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

A pause after `.`, `?`, `!` or `…` is not considered a defect by default: it is a normal inter-sentence stop. Thresholds, the repetition window and lexical fillers are configurable in the app without rebuilding or re-transcribing.

## Troubleshooting

**The app is blocked by macOS**

Right-click the app → **Open** → **Open**, or run `xattr -cr "/Applications/Speech Review.app"` once, as described in [Download and install](#download-and-install).

**The engine or ffmpeg is reported as missing**

The DMG bundles both. Reinstall the app from the latest release. If you run from source, execute `npm run fetch:engine` and restart.

**Video does not play**

Chromium does not support some codecs (for example certain MKV/HEVC files). Transcription still works because ffmpeg extracts the audio. Re-encode the file to MP4/H.264:

```bash
ffmpeg -i input.mkv -c:v libx264 -c:a aac -movflags +faststart output.mp4
```

**The model fails SHA-256 verification**

Delete the incomplete file in `~/Library/Application Support/Speech Review/models/CrisperWhisper2.0-GGUF/` and download it again. The download resumes after an interruption.

**It takes a long time**

Reference for M4 Pro: 10 minutes of audio ≈ 1.5 minutes of transcription (RTF ≈ 0.15). The lighter Q4_K model is faster but less accurate; select it in Settings.

## Limitations

- macOS on Apple Silicon only; Windows and Linux builds have not been tested.
- No word-level confidence yet, so the `unclear` defect type is disabled.
- No speaker diarization.
- One active project per window; background jobs are not queued.
- If the app crashes, an unfinished transcription starts over. Completed projects are saved.
- The model is distributed under a non-commercial research license.

## Data and privacy

Processing is fully local. Projects and settings live in `~/Library/Application Support/Speech Review/`; deleting a project in the app removes its folder. The source video is never copied or modified. The folder layout is documented in [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md).

## Building from source

On a Mac:

```bash
npm install
npm run fetch:engine
npm run dev
```

`npm run package:mac` builds the DMG into `dist/`. To check the logic without launching Electron, run `npm test` and `npm run typecheck`.

Developer documentation:

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
