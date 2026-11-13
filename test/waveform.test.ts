import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WAVE_CONTRAST,
  MAX_WAVE_CONTRAST,
  MIN_WAVE_CONTRAST,
  WAVE_LUT_SIZE,
  buildWaveLut,
  computeWaveStats,
  waveAmp
} from '../src/renderer/src/waveform'
import type { Peaks } from '../src/shared/types'

/** Build an envelope from a list of absolute amplitudes, mirrored around 0. */
function peaksFrom(levels: number[]): Peaks {
  return {
    peaksPerSecond: 20,
    duration: levels.length / 20,
    min: levels.map((level) => -level),
    max: levels.map((level) => level)
  }
}

/** 80 % near-silence, then quiet speech and a couple of loud syllables. */
function speechPeaks(): Peaks {
  const levels: number[] = []
  for (let i = 0; i < 800; i++) levels.push(0.004)
  for (let i = 0; i < 160; i++) levels.push(0.05)
  for (let i = 0; i < 36; i++) levels.push(0.3)
  for (let i = 0; i < 4; i++) levels.push(0.6)
  return peaksFrom(levels)
}

describe('waveform statistics', () => {
  it('returns null without peaks', () => {
    expect(computeWaveStats(null)).toBeNull()
    expect(computeWaveStats(peaksFrom([]))).toBeNull()
  })

  it('estimates a low noise floor and a loud reference', () => {
    const stats = computeWaveStats(speechPeaks())
    expect(stats).not.toBeNull()
    const { floor, ref } = stats!
    expect(floor).toBeLessThan(0.01)
    expect(ref).toBeGreaterThan(0.29)
    expect(ref).toBeLessThanOrEqual(1)
    expect(floor).toBeLessThanOrEqual(ref * 0.2)
    expect(Number.isFinite(floor)).toBe(true)
  })

  it('stays finite for silence and for a fully loud recording', () => {
    const silent = computeWaveStats(peaksFrom(new Array(50).fill(0)))!
    expect(silent.ref).toBeGreaterThan(0)
    expect(silent.floor).toBeLessThanOrEqual(silent.ref)

    const loud = computeWaveStats(peaksFrom(new Array(50).fill(1)))!
    expect(loud.ref).toBeLessThanOrEqual(1)
    expect(loud.floor).toBeLessThanOrEqual(loud.ref * 0.2)
  })
})

describe('waveform contrast', () => {
  const stats = { floor: 0.01, ref: 0.5 }

  it('is linear at 0 % contrast', () => {
    const lut = buildWaveLut({ floor: 0, ref: 1 }, MIN_WAVE_CONTRAST)
    expect(waveAmp(lut, 0.25)).toBeCloseTo(0.25, 2)
    expect(waveAmp(lut, 0.75)).toBeCloseTo(0.75, 2)
  })

  it('lifts quiet speech and keeps the loud part at full height', () => {
    const linear = buildWaveLut({ floor: 0, ref: 1 }, MIN_WAVE_CONTRAST)
    const lut = buildWaveLut(stats, DEFAULT_WAVE_CONTRAST)
    expect(waveAmp(lut, 0.05)).toBeGreaterThan(waveAmp(linear, 0.05) * 1.5)
    expect(waveAmp(lut, 0.05)).toBeLessThan(0.5)
    expect(waveAmp(lut, 0.5)).toBeGreaterThan(0.99)
  })

  it('flattens everything below the noise floor', () => {
    const lut = buildWaveLut(stats, MAX_WAVE_CONTRAST)
    expect(waveAmp(lut, 0.005)).toBe(0)
    expect(Math.abs(waveAmp(lut, -0.005))).toBe(0)
    expect(waveAmp(lut, 0.01)).toBe(0)
  })

  it('is monotonic and clamped to 0–1', () => {
    const lut = buildWaveLut(stats, DEFAULT_WAVE_CONTRAST)
    expect(lut.length).toBe(WAVE_LUT_SIZE)
    expect(lut[0]).toBe(0)
    expect(lut[lut.length - 1]).toBeCloseTo(1, 5)
    for (let i = 1; i < lut.length; i++) {
      expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1])
      expect(lut[i]).toBeGreaterThanOrEqual(0)
      expect(lut[i]).toBeLessThanOrEqual(1)
    }
  })

  it('keeps the sign of the peak and survives missing values', () => {
    const lut = buildWaveLut(stats, DEFAULT_WAVE_CONTRAST)
    expect(waveAmp(lut, -0.4)).toBeLessThan(0)
    expect(waveAmp(lut, 0.4)).toBeGreaterThan(0)
    expect(waveAmp(lut, 0)).toBe(0)
    expect(waveAmp(lut, Number.NaN)).toBe(0)
    expect(waveAmp(lut, 2)).toBeLessThanOrEqual(1)
  })

  it('falls back to a usable ramp without statistics', () => {
    const lut = buildWaveLut(null, DEFAULT_WAVE_CONTRAST)
    expect(waveAmp(lut, 0.1)).toBeGreaterThan(0)
    expect(waveAmp(lut, 0.5)).toBeGreaterThan(waveAmp(lut, 0.1))
    expect(waveAmp(lut, 0.5)).toBeLessThan(1)
    expect(Number.isFinite(waveAmp(lut, 0.9))).toBe(true)
  })
})
