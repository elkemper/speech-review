import { describe, expect, it } from 'vitest'
import { buildSkipIntervals, intervalAt } from '../src/renderer/src/skip'
import type { Defect, PlaybackSettings } from '../src/shared/types'

const settings: PlaybackSettings = {
  skipEnabled: true,
  skipBeforeSec: 0.2,
  skipAfterSec: 0.3
}

function defect(
  id: string,
  start: number,
  end: number,
  options: Partial<Defect> = {}
): Defect {
  return {
    id,
    type: 'filler',
    start,
    end,
    wordIds: [],
    text: id,
    severity: 'medium',
    source: 'auto',
    confirmed: false,
    dismissed: false,
    note: '',
    ...options
  }
}

describe('skip intervals', () => {
  it('pads defects and merges overlapping ranges', () => {
    const intervals = buildSkipIntervals(
      [defect('a', 10, 11), defect('b', 11.2, 12)],
      settings,
      60
    )
    expect(intervals).toEqual([{ start: 9.8, end: 12.3 }])
  })

  it('skips automatic and manual defects regardless of confirmation', () => {
    expect(
      buildSkipIntervals(
        [
          defect('a', 10, 11),
          defect('m', 20, 21, { source: 'manual', type: 'manual', confirmed: true })
        ],
        settings,
        60
      )
    ).toEqual([
      { start: 9.8, end: 11.3 },
      { start: 19.8, end: 21.3 }
    ])
  })

  it('never skips dismissed defects', () => {
    expect(
      buildSkipIntervals(
        [defect('a', 10, 11, { dismissed: true }), defect('b', 20, 21)],
        settings,
        60
      )
    ).toEqual([{ start: 19.8, end: 21.3 }])
  })

  it('skips a revealed candidate while it is selected', () => {
    expect(
      buildSkipIntervals([defect('a', 10, 11, { candidate: true })], settings, 60)
    ).toEqual([{ start: 9.8, end: 11.3 }])
  })

  it('clamps to the recording and ignores disabled mode', () => {
    expect(buildSkipIntervals([defect('a', 0.1, 1)], settings, 60)[0]).toEqual({
      start: 0,
      end: 1.3
    })
    expect(buildSkipIntervals([defect('a', 59.5, 60)], settings, 60)[0]).toEqual({
      start: 59.3,
      end: 60
    })
    expect(
      buildSkipIntervals([defect('a', 10, 11)], { ...settings, skipEnabled: false }, 60)
    ).toEqual([])
  })

  it('finds the interval that contains the playhead', () => {
    const intervals = buildSkipIntervals([defect('a', 10, 11)], settings, 60)
    expect(intervalAt(intervals, 10.5)?.end).toBe(11.3)
    expect(intervalAt(intervals, 11.4)).toBeNull()
  })
})
