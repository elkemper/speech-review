import { describe, expect, it } from 'vitest'
import {
  clampToStep,
  formatShortSeconds,
  formatStepValue,
  parseNumberInput,
  rangeProgress,
  stepDecimals
} from '../src/shared/format'

describe('parseNumberInput', () => {
  it('accepts dots and commas', () => {
    expect(parseNumberInput('0.5')).toBe(0.5)
    expect(parseNumberInput('0,5')).toBe(0.5)
    expect(parseNumberInput(' 1.2 ')).toBe(1.2)
    expect(parseNumberInput('3')).toBe(3)
  })

  it('returns null for empty or incomplete text instead of 0', () => {
    expect(parseNumberInput('')).toBeNull()
    expect(parseNumberInput('   ')).toBeNull()
    expect(parseNumberInput('-')).toBeNull()
    expect(parseNumberInput('.')).toBeNull()
    expect(parseNumberInput('-.')).toBeNull()
    expect(parseNumberInput('abc')).toBeNull()
    expect(parseNumberInput('1,2,3')).toBeNull()
  })

  it('treats a trailing separator as the number itself', () => {
    expect(parseNumberInput('0.')).toBe(0)
    expect(parseNumberInput('2,')).toBe(2)
  })
})

describe('clampToStep', () => {
  it('removes floating point noise', () => {
    expect(clampToStep(0.1 + 0.2, 0, 5, 0.05)).toBe(0.3)
    expect(clampToStep(0.30000000000000004, 0.3, 5, 0.1)).toBe(0.3)
  })

  it('clamps to the range before snapping', () => {
    expect(clampToStep(-1, 0.3, 5, 0.1)).toBe(0.3)
    expect(clampToStep(99, 0.3, 5, 0.1)).toBe(5)
  })

  it('snaps to the grid anchored at min', () => {
    expect(clampToStep(1.23, 0.3, 5, 0.1)).toBe(1.2)
    expect(clampToStep(3.14, 0, 10, 0.5)).toBe(3)
    expect(clampToStep(2.6, 2, 10, 1)).toBe(3)
  })

  it('keeps non-finite input at the minimum', () => {
    expect(clampToStep(Number.NaN, 0.3, 5, 0.1)).toBe(0.3)
  })
})

describe('number formatting', () => {
  it('picks sensible decimals for a step', () => {
    expect(stepDecimals(1)).toBe(0)
    expect(stepDecimals(5)).toBe(0)
    expect(stepDecimals(0.1)).toBe(1)
    expect(stepDecimals(0.05)).toBe(2)
    expect(stepDecimals(0.5)).toBe(1)
  })

  it('shows a clean value without float noise', () => {
    expect(formatStepValue(0.30000000000000004, 0.05)).toBe('0.3')
    expect(formatStepValue(3, 0.5)).toBe('3')
    expect(formatStepValue(1.2, 0.1)).toBe('1.2')
  })

  it('formats defect duration with up to two decimals', () => {
    expect(formatShortSeconds(0.8333)).toBe('0,83 с.')
    expect(formatShortSeconds(0.8)).toBe('0,8 с.')
    expect(formatShortSeconds(12)).toBe('12 с.')
    expect(formatShortSeconds(-1)).toBe('0 с.')
    expect(formatShortSeconds(Number.NaN)).toBe('0 с.')
  })

  it('computes the slider fill percentage', () => {
    expect(rangeProgress(0, 0, 10)).toBe(0)
    expect(rangeProgress(5, 0, 10)).toBe(50)
    expect(rangeProgress(10, 0, 10)).toBe(100)
    expect(rangeProgress(99, 0, 10)).toBe(100)
    expect(rangeProgress(5, 5, 5)).toBe(0)
  })
})
