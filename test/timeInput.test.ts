import { describe, expect, it } from 'vitest'
import { formatTimeInput, isSameTimeInput, parseTimeInput } from '../src/shared/timeInput'

describe('parseTimeInput', () => {
  it('reads plain seconds, including a comma decimal separator', () => {
    expect(parseTimeInput('10')).toBe(10)
    expect(parseTimeInput('754.5')).toBe(754.5)
    expect(parseTimeInput('754,5')).toBe(754.5)
    expect(parseTimeInput('0')).toBe(0)
  })

  it('reads minutes, hours and milliseconds', () => {
    expect(parseTimeInput('12:34')).toBe(754)
    expect(parseTimeInput('01:02:03')).toBe(3723)
    expect(parseTimeInput('01:02:03.500')).toBe(3723.5)
    expect(parseTimeInput(' 01:02:03,5 ')).toBe(3723.5)
    expect(parseTimeInput('00:00:00.050')).toBeCloseTo(0.05, 6)
  })

  it('is lenient about overflowing parts, like a spreadsheet', () => {
    expect(parseTimeInput('1:75')).toBe(135)
    expect(parseTimeInput('0:90')).toBe(90)
  })

  it('rejects empty, negative and malformed input', () => {
    expect(parseTimeInput('')).toBeNull()
    expect(parseTimeInput('   ')).toBeNull()
    expect(parseTimeInput('-1')).toBeNull()
    expect(parseTimeInput('-00:01')).toBeNull()
    expect(parseTimeInput('abc')).toBeNull()
    expect(parseTimeInput('1:2:3:4')).toBeNull()
    expect(parseTimeInput('1::2')).toBeNull()
    expect(parseTimeInput(':30')).toBeNull()
    expect(parseTimeInput('30:')).toBeNull()
    expect(parseTimeInput('1e3')).toBeNull()
    expect(parseTimeInput('1.2.3')).toBeNull()
  })
})

describe('isSameTimeInput', () => {
  it('ignores the format when the moment is the same', () => {
    expect(isSameTimeInput('10', '00:00:10.000')).toBe(true)
    expect(isSameTimeInput('754,5', '00:12:34.500')).toBe(true)
    expect(isSameTimeInput(' 0:90 ', '00:01:30.000')).toBe(true)
  })

  it('detects a real change and rejects malformed input', () => {
    expect(isSameTimeInput('10.001', '00:00:10.000')).toBe(false)
    expect(isSameTimeInput('10', '00:00:10.001')).toBe(false)
    expect(isSameTimeInput('10.0004', '00:00:10.000')).toBe(true)
    expect(isSameTimeInput('abc', '00:00:10.000')).toBe(false)
    expect(isSameTimeInput('10', '')).toBe(false)
  })
})

describe('formatTimeInput', () => {
  it('uses the fixed-width export timecode', () => {
    expect(formatTimeInput(3723.5)).toBe('01:02:03.500')
    expect(formatTimeInput(0)).toBe('00:00:00.000')
  })

  it('never emits a negative or non-finite timecode', () => {
    expect(formatTimeInput(-5)).toBe('00:00:00.000')
    expect(formatTimeInput(Number.NaN)).toBe('00:00:00.000')
  })
})
