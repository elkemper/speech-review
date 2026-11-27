# Backlog

A list of work deliberately deferred from the current release. The order roughly reflects usefulness for the "review a webinar" scenario.

Current feature requests, their triage (fix now / next / backlog) and acceptance criteria live in [`docs/SPEC.md`](SPEC.md). This file is the long-term list of deferred work.

## 1. Word-level confidence and the "unclear" type

**Status:** waiting for audio.cpp support.

`audiocpp_cli --words-out` currently writes `confidence: 0` for every word, so unreliable words cannot be identified. The parser is ready: if the JSON contains a positive `confidence`, `buildTranscript` stores it in `Word.confidence`, and `detectDefects` enables the `unclear` rule using `lowConfidenceThreshold`.

What to do when the engine starts returning real values:

1. Check the scale: 0…1 or 0…100, and update `lowConfidenceThreshold`.
2. Enable the "Unclear words by confidence" checkbox in settings (it is currently disabled with a "work in progress" badge).
3. Add a separate color/filter for `unclear` in the UI.
4. Add a test using real engine output.

The rule is disabled for now because `0` means "no data", not "poor recognition". Otherwise the whole transcript would become one defect.

## 2. Avoid reloading the model between chunks

Currently a new `audiocpp_cli` process is started for every 5–15 minute chunk, and the model is read from disk again. For a one-hour webinar this is a noticeable share of the time.

Options:

- audio.cpp `--request-sequence` / batch mode: several WAV files in one session.
- A long-lived process with IPC and repeated requests.
- Slice all chunks up front and pass them in one batch call.

Measure the gain on M4 Pro: 10 minutes ≈ 1.5 minutes now (RTF ≈ 0.15).

## 3. Resume interrupted transcription

If the app crashes, an unfinished job starts over. Completed chunks could be saved in the project folder and skipped on the next run.

## 4. Developer ID signing and notarization

The build is currently ad-hoc signed, and the first launch may require `xattr -cr` or "Open" from the context menu. To distribute to users without Terminal, the following are needed:

- Apple Developer ID Application;
- `notarytool` + stapling;
- hardened runtime and entitlements for JIT/unsigned executable memory (Electron).

## 5. Diarization and speakers

CrisperWhisper 2.0 does ASR but does not label speakers. For webinars with audience questions, useful additions are:

- diarization (for example, a separate audio.cpp model if one appears);
- a "host only" filter;
- different track colors on the timeline.

## 6. Codec check and proxy transcode for video

Transcription works with any file ffmpeg can read, but Chromium does not play some MKV/HEVC/AV1 files. Currently the user sees a "re-encode" message. It would be possible to automatically create an MP4/H.264 proxy in a temporary folder and play it without touching the original.

## 7. SRT/VTT export and editing marks

CSV/JSON already exist. Useful for editing:

- SRT/VTT with marked defects;
- EDL/FCPXML with a cut list;
- `file:///...#t=12.34` links for jumping from a table.

## 8. Transcript search

There is no word search field. Needed:

- search with highlighting and next/previous match navigation;
- a time-range filter;
- search in notes.

## 9. Optimize defect recomputation

`detectDefects` is recomputed on every change to `confirmedDefectIds`, `dismissedDefectIds` or notes, even though the transcript itself has not changed. For a one-hour recording that is tens of thousands of words. It should be split:

- `autoDefects` — memoized by `(transcript, rules)`;
- `confirmed/dismissed/notes` — applied separately.

## 10. Waveform performance

`peaks.json` for a 3-hour recording contains hundreds of thousands of values, a file of several megabytes, and the canvas is redrawn on every `currentTime` change. Options:

- binary format or Float32Array over IPC;
- draw the playhead on a separate layer/canvas;
- downsample peaks to the window width.

## 11. Fine-tune rules for language and speaker

Rules are currently shared for the project. Useful additions:

- profiles "lecturer", "interview", "fast pace";
- exceptions for words the model constantly marks as fillers;
- a pause minimum duration that depends on speech rate.

## 12. Improve chunking

If there is no silence in a 5–15 minute window, the chunk is cut at the ideal length and may split a word. Possible improvements:

- widen the silence search window;
- use VAD instead of `silencedetect`;
- overlap chunks by 0.5–1 s and merge by timestamps.

## 13. Windows and Linux

Path and engine-loader code is partially cross-platform, but only macOS arm64 has been verified. Needed:

- ffmpeg/audio.cpp builds for the target platforms;
- verification of `app-media://` and Metal/CUDA/Vulkan;
- separate icons and labels.

## 14. Engine and ffmpeg integrity checks

`npm run fetch:engine` downloads binaries without SHA-256. Checksums should be added and verified by `npm run check:resources` to rule out corrupted downloads.

## 15. Auto-update

The app does not update itself. For a single user this is not critical, but multiple copies need `electron-updater` and signed releases.

## 16. Accessibility and UI polish

- Full keyboard navigation in the defect panel.
- Configurable hotkeys.
- Undo/redo for notes.
- An "About" screen with engine and model versions. Model versions are already tracked (see `docs/spec/11-model-updates.md`); only the screen is missing.
- A "model is loading" indicator with phases, not just a percentage.

## 17. Tests

- parsing `silencedetect` and ffmpeg progress;
- model resume and SHA-256 verification;
- project save/load and defect-state reset;
- partial transcripts and confirmation-state merging;
- IPC contracts;
- component rendering.

## 18. Streaming recognition inside a chunk

Currently a partial result appears only after a whole chunk (the first one up to 3 minutes). Even faster startup needs streaming ASR: emit words as they are decoded. audio.cpp currently runs on a whole file, so first check whether it has a streaming mode or can emit partial output.

## 19. Editable pause tokens

Pauses are shown as separate chips and separator rows, but they cannot be turned into a transcript word or have their boundaries edited directly in the text. Ad-hoc pause tokens with editable start/end are needed so the editing list matches the user's edits exactly.

## 20. Light theme and appearance switcher for the main window

The defect table window already has an opt-in light theme (story 56). The main window is still dark only, in the spirit of Photoshop. Needed: a light palette for the whole app, a switcher in settings, and persistence of the choice. Defect colors, the waveform and the timeline hatching need a contrast pass on a light background.

## 21. Audio-only export and audio-file cuts

Video export is implemented as story 48. Recordings without a video track still
cannot be exported: the app creates a project for MP3/WAV/M4A, but the export
dialog rejects a source without a video stream.

Needed:

- an audio-only path that uses the same `buildCutList`/`complementRanges` and
  AAC re-encode;
- an output container that follows the source (M4A/MP3/WAV/Opus);
- the same progress, cancellation and `.part`/rename safety as video export.

Do not introduce a second cut model: playback, the timeline hatching, CSV/JSON
and both export paths must use the same `buildCutList`.

## 22. Stream-copy video export (без перекодирования)

Video export always re-encodes so that cuts are frame-accurate. A fast
keyframe-bound mode was removed; it would use the concat demuxer with
`inpoint`/`outpoint` and `-c copy`, keep the source container, and warn that
boundaries snap to keyframes. Return it only if the speed/quality trade-off is
requested again, and reuse `buildCutList`/`complementRanges`.
