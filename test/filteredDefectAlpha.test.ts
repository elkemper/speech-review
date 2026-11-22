import { describe, expect, it } from 'vitest'
import { filteredDefectAlpha } from '../src/renderer/src/timelineView'

describe('filteredDefectAlpha', () => {
  it('hides filtered defects completely at an overview', () => {
    expect(filteredDefectAlpha(0)).toBe(0)
    expect(filteredDefectAlpha(1.5)).toBe(0)
    expect(filteredDefectAlpha(39.9)).toBe(0)
  })

  it('fades the hint in as the user zooms', () => {
    const near = filteredDefectAlpha(60)
    const closer = filteredDefectAlpha(120)
    expect(near).toBeGreaterThan(0)
    expect(closer).toBeGreaterThan(near)
  })

  it('caps the hint so it stays a hint, never a full marker', () => {
    expect(filteredDefectAlpha(200)).toBeLessThanOrEqual(0.25)
    expect(filteredDefectAlpha(10_000)).toBeLessThanOrEqual(0.25)
  })
})
