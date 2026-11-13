import { describe, expect, it } from 'vitest'
import { buildSkipIntervals, intervalAt } from '../src/renderer/src/skip'
import type { Defect, PlaybackSettings } from '../src/shared/types'

const settings: PlaybackSettings = {
  skipEnabled: true,
  skipBeforeSec: 0.2,
  skipAfterSec: 0.3,
  pauseKeepSec: 0
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

describe('pause room tone', () => {
  const keep = (pauseKeepSec: number, extra: Partial<PlaybackSettings> = {}): PlaybackSettings => ({
    ...settings,
    pauseKeepSec,
    paddingByType: { pause: { before: 0, after: 0 } },
    ...extra
  })

  it('keeps silence on both edges instead of cutting the whole pause', () => {
    expect(
      buildSkipIntervals([defect('p', 10, 12, { type: 'pause' })], keep(0.4), 60)
    ).toEqual([{ start: 10.2, end: 11.8 }])
  })

  it('cuts the whole pause when the keep is zero', () => {
    expect(
      buildSkipIntervals([defect('p', 10, 12, { type: 'pause' })], keep(0), 60)
    ).toEqual([{ start: 10, end: 12 }])
  })

  it('does not cut a pause shorter than the kept silence', () => {
    expect(
      buildSkipIntervals([defect('p', 10, 10.3, { type: 'pause' })], keep(0.4), 60)
    ).toEqual([])
  })

  it('does not make a jump shorter than the minimum cut', () => {
    expect(
      buildSkipIntervals([defect('p', 10, 10.4, { type: 'pause' })], keep(0.3), 60)
    ).toEqual([])
  })

  it('leaves other defect types untouched', () => {
    expect(buildSkipIntervals([defect('a', 10, 11)], keep(0.4), 60)).toEqual([
      { start: 9.8, end: 11.3 }
    ])
  })

  it('falls back to the default keep when legacy settings omit it', () => {
    const legacy = { ...keep(0.4), pauseKeepSec: undefined } as unknown as PlaybackSettings
    expect(buildSkipIntervals([defect('p', 10, 12, { type: 'pause' })], legacy, 60)).toEqual([
      { start: 10.2, end: 11.8 }
    ])
  })

  it('adds the pause padding on top of the kept silence', () => {
    const padding = { pause: { before: 0.1, after: 0.1 } }
    expect(
      buildSkipIntervals(
        [defect('p', 10, 12, { type: 'pause' })],
        keep(0.4, { paddingByType: padding }),
        60
      )
    ).toEqual([{ start: 10.1, end: 11.9 }])
  })

  it('uses group padding for a grouped pause', () => {
    expect(
      buildSkipIntervals(
        [
          defect('g', 10, 12, {
            type: 'pause',
            groupIds: ['a', 'b'],
            groupTypes: ['filler', 'pause']
          })
        ],
        keep(0.4, { groupPadding: { before: 0.5, after: 0.5 } }),
        60
      )
    ).toEqual([{ start: 9.5, end: 12.5 }])
  })
})
