# 04c — Waveform contrast

[Index](../SPEC.md) · Parent: [04 — Timeline](04-timeline.md) ·
Related: [10 — Mini timeline](10-mini-timeline.md)

**Status:** Done · **Priority:** P1

**Files:** `src/renderer/src/waveform.ts`,
`src/renderer/src/components/Timeline.tsx`,
`src/renderer/src/components/MiniTimeline.tsx`,
`src/shared/settings.ts` (`waveformContrast`).
**Tests:** `test/waveform.test.ts`, `test/grouping.test.ts`.

## Story

### Story 42 — Readable waveform across a wide dynamic range

As a user, I want to see where speech happens and where the recording is
actually silent, even though the loudest syllables are far louder than normal
speech, so I can navigate and adjust marks by eye.

- The recorded envelope stays linear in the data; the transform is
  **display-only**.
- The renderer estimates the noise floor (15th percentile of the peak envelope)
  and the loud reference (98th percentile) once per project, in a single pass
  over the stored peaks.
- Quiet speech is lifted by a gamma curve; everything at or below the noise
  floor collapses onto a thin baseline.
- The loud part keeps full height, so nothing clips into neighbouring rows.
- Gated silence still draws a thin baseline line across the waveform, so the
  recording never looks like disconnected islands with empty holes between
  words.
- The same lookup table is used by the main timeline and the mini timeline, so
  a word looks the same in both.
- Contrast is configurable in Settings → Defects (`waveformContrast`, 0–100,
  default 55). `0` is the plain linear envelope.
- Changing the setting only rebuilds the lookup table; nothing on disk is
  rewritten and no re-recognition or re-extraction is needed. Projects created
  before this story pick the new rendering up immediately.
- Missing or degenerate peaks fall back to a monotonic ramp without errors.

## Acceptance criteria

- [ ] Quiet speech is visibly taller than in the linear rendering.
- [ ] Silence below the noise floor collapses to a thin baseline line and no
      gap in the waveform looks completely empty.
- [ ] The loud part still reaches full height and never exceeds the drawing area.
- [ ] The same word has the same height on both timelines at the same zoom.
- [ ] Contrast 0 % reproduces the linear envelope.
- [ ] The setting persists and is normalized to 0–100.
- [ ] Existing projects render with the new contrast without any reprocessing.
- [ ] Degenerate peaks (all zeros, all maximum) produce no NaN and no crash.
- [ ] Unit tests cover statistics, clamping, monotonicity and the linear mode.

## Verification

- Pure math is unit-tested.
- Visual contrast must be checked on macOS with a real recording; peaks are
  stored at 20 buckets/s, so at 4× zoom the envelope may still look blocky.
  Raising the peak resolution is a separate change and would require
  recomputing `peaks.json`.
