import { describe, expect, it } from 'vitest'
import { cutEditFor, cutEditForBounds, movedCutEdge } from '../src/shared/cutEdit'
import { DEFAULT_SETTINGS } from '../src/shared/settings'
import type { Defect } from '../src/shared/types'

const bounds = { start: 10, end: 11 }

describe('cutEditForBounds', () => {
  it('moves one edge of an existing cut', () => {
    const cut = { start: 10, end: 12 }
    expect(cutEditForBounds(cut, bounds, 'start', 11, 60)).toEqual({ start: 11, end: 12 })
    expect(cutEditForBounds(cut, bounds, 'end', 13, 60)).toEqual({ start: 10, end: 13 })
    expect(cutEditForBounds(cut, bounds, 'duration', 1.5, 60)).toEqual({
      start: 10,
      end: 11.5
    })
  })

  it('uses the defect bounds as the other edge when the row is not cut', () => {
    expect(cutEditForBounds(null, bounds, 'start', 9, 60)).toEqual({ start: 9, end: 11 })
    expect(cutEditForBounds(null, bounds, 'end', 12, 60)).toEqual({ start: 10, end: 12 })
    expect(cutEditForBounds(null, bounds, 'duration', 2, 60)).toEqual({
      start: 10,
      end: 12
    })
  })

  it('rejects inverted, too short, negative and out-of-range cuts', () => {
    const cut = { start: 10, end: 12 }
    expect(cutEditForBounds(cut, bounds, 'start', 12, 60)).toBeNull()
    expect(cutEditForBounds(cut, bounds, 'start', 13, 60)).toBeNull()
    expect(cutEditForBounds(cut, bounds, 'end', 9.9, 60)).toBeNull()
    expect(cutEditForBounds(cut, bounds, 'end', 10.02, 60)).toBeNull()
    expect(cutEditForBounds(cut, bounds, 'start', -1, 60)).toBeNull()
    expect(cutEditForBounds(cut, bounds, 'end', 61, 60)).toBeNull()
    expect(cutEditForBounds(cut, bounds, 'duration', 60, 60)).toBeNull()
    expect(cutEditForBounds(cut, bounds, 'start', Number.NaN, 60)).toBeNull()
  })

  it('rejects an edit that cannot fit the recording', () => {
    const cut = { start: 50, end: 55 }
    expect(cutEditForBounds(cut, bounds, 'end', 61, 60)).toBeNull()
    expect(cutEditForBounds(null, { start: 58, end: 59 }, 'duration', 5, 60)).toBeNull()
  })

  it('returns null when the recording has no duration', () => {
    expect(cutEditForBounds({ start: 0, end: 1 }, bounds, 'end', 2, 0)).toBeNull()
  })
})

describe('movedCutEdge', () => {
  it('treats a duration edit as an end edit', () => {
    // The start is fixed by the duration cell, so only the end may capture a
    // neighbouring mark while grouping.
    expect(movedCutEdge('start')).toBe('start')
    expect(movedCutEdge('end')).toBe('end')
    expect(movedCutEdge('duration')).toBe('end')
  })
})

describe('cutEditFor', () => {
  const defect: Defect = {
    id: 'auto-filler-w1',
    type: 'filler',
    start: 10,
    end: 11,
    wordIds: [1],
    text: 'э',
    severity: 'low',
    source: 'auto',
    confirmed: false,
    dismissed: false,
    note: ''
  }
  const playback = DEFAULT_SETTINGS.playback

  it('derives the current cut with the actual padding', () => {
    // Filler padding: 0.1 before, 0.2 after → the cut is 9.9–11.2.
    const edited = cutEditFor(defect, playback, 60, null, 'start', 9.5)
    expect(edited?.start).toBe(9.5)
    expect(edited?.end).toBeCloseTo(11.2, 6)
  })

  it('honours an explicit override', () => {
    expect(
      cutEditFor(defect, playback, 60, { start: 9, end: 12 }, 'end', 13)
    ).toEqual({ start: 9, end: 13 })
  })
})
