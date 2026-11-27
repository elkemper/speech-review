import { describe, expect, it } from 'vitest'
import { normalizeTableTheme } from '../src/shared/tableTheme'

describe('normalizeTableTheme', () => {
  it('accepts only the light theme as an opt-in', () => {
    expect(normalizeTableTheme('light')).toBe('light')
    expect(normalizeTableTheme('dark')).toBe('dark')
  })

  it('falls back to dark for missing or unknown stored values', () => {
    expect(normalizeTableTheme(null)).toBe('dark')
    expect(normalizeTableTheme(undefined)).toBe('dark')
    expect(normalizeTableTheme('')).toBe('dark')
    expect(normalizeTableTheme('LIGHT')).toBe('dark')
  })
})
