import type { Peaks } from '@shared/types'

/**
 * Display-only contrast for the waveform. The recorded speech has a very wide
 * dynamic range, so a linear envelope makes normal speech look almost flat
 * next to the loudest syllables. We therefore subtract the estimated noise
 * floor, normalise to the loud part and apply a gamma curve — all on the
 * already stored peaks, without touching the transcript or the audio.
 */

export const WAVE_LUT_SIZE = 1024
export const MIN_WAVE_CONTRAST = 0
export const MAX_WAVE_CONTRAST = 100
export const DEFAULT_WAVE_CONTRAST = 55

/** Histogram resolution for the percentile estimate. */
const HISTOGRAM_BINS = 512
/** Percentile of the envelope treated as the noise floor. */
const FLOOR_PERCENTILE = 0.15
/** Percentile treated as the loud part of the speech. */
const REFERENCE_PERCENTILE = 0.98
/** The floor may never cut more than this share of the loud level. */
const MAX_FLOOR_SHARE = 0.2
/** Gate above the estimated floor, so residual noise does not leave a thin fuzz. */
const GATE_MARGIN = 2
/** Gamma at contrast 100. At contrast 0 the curve is linear. */
const MIN_GAMMA = 0.35

export interface WaveStats {
  /** Estimated noise floor in peak units (0–1). */
  floor: number
  /** Level of the loud part of the speech in peak units (0–1). */
  ref: number
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Value of a normalised percentile from a histogram over [0, 1]. */
function histogramPercentile(hist: Uint32Array, total: number, fraction: number): number {
  const wanted = Math.max(1, Math.round(clampNumber(fraction, 0, 1) * total))
  let seen = 0
  for (let i = 0; i < hist.length; i++) {
    seen += hist[i]
    if (seen >= wanted) return (i + 0.5) / hist.length
  }
  return (hist.length - 0.5) / hist.length
}

/**
 * Noise floor and loud reference of a recording, from a histogram of the peak
 * envelope. O(N) with a single pass over the stored peaks, so it is cheap even
 * for a multi-hour recording.
 */
export function computeWaveStats(peaks: Peaks | null): WaveStats | null {
  if (!peaks) return null
  const count = Math.min(peaks.max.length, peaks.min.length)
  if (count <= 0) return null

  const hist = new Uint32Array(HISTOGRAM_BINS)
  for (let i = 0; i < count; i++) {
    const high = Math.abs(peaks.max[i])
    const low = Math.abs(peaks.min[i])
    const level = clampNumber(high > low ? high : low, 0, 1)
    hist[Math.min(HISTOGRAM_BINS - 1, (level * HISTOGRAM_BINS) | 0)]++
  }

  const ref = Math.max(histogramPercentile(hist, count, REFERENCE_PERCENTILE), 0.002)
  const floor = Math.min(histogramPercentile(hist, count, FLOOR_PERCENTILE), ref * MAX_FLOOR_SHARE)
  return { floor: Math.max(0, floor), ref }
}

/**
 * Lookup table mapping an absolute peak amplitude (0–1) to the drawn one
 * (0–1). `contrast` 0 keeps the envelope linear, 100 applies the gate and the
 * strongest gamma.
 */
export function buildWaveLut(
  stats: WaveStats | null,
  contrast: number = DEFAULT_WAVE_CONTRAST
): Float32Array {
  const lut = new Float32Array(WAVE_LUT_SIZE)
  const strength = clampNumber(contrast / 100, 0, 1)
  const gate = stats
    ? Math.min(stats.floor * GATE_MARGIN, stats.ref * MAX_FLOOR_SHARE) * strength
    : 0
  const span = stats ? Math.max(1e-4, stats.ref - gate) : 1
  const gamma = 1 - (1 - MIN_GAMMA) * strength

  for (let i = 0; i < WAVE_LUT_SIZE; i++) {
    const x = i / (WAVE_LUT_SIZE - 1)
    const normalised = clampNumber((x - gate) / span, 0, 1)
    lut[i] = normalised <= 0 ? 0 : Math.pow(normalised, gamma)
  }
  return lut
}

/** Map one signed peak (min or max) through the lookup table. */
export function waveAmp(lut: Float32Array, value: number): number {
  if (!Number.isFinite(value) || value === 0) return 0
  const magnitude = Math.abs(value)
  const index = Math.min(lut.length - 1, (magnitude * (lut.length - 1)) | 0)
  const mapped = lut[index]
  return value < 0 ? -mapped : mapped
}
