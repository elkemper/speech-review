import { describe, expect, it } from 'vitest'
import {
  buildCutList,
  buildSkipIntervals,
  complementRanges,
  cutRangeFor,
  cutView,
  intervalAt,
  subtractRanges
} from '../src/renderer/src/skip'
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

describe('cut ranges', () => {
  it('derives a padded cut for an automatic defect', () => {
    expect(cutRangeFor(defect('a', 10, 11), settings, 60)).toEqual({
      start: 9.8,
      end: 11.3
    })
  })

  it('lets an explicit cut override win over padding', () => {
    expect(
      cutRangeFor(defect('a', 10, 11), settings, 60, { start: 10.5, end: 10.9 })
    ).toEqual({ start: 10.5, end: 10.9 })
  })

  it('normalizes and clamps an override', () => {
    expect(
      cutRangeFor(defect('a', 10, 11), settings, 12, { start: 15, end: 9 })
    ).toEqual({ start: 9, end: 12 })
  })

  it('honours a short explicit pause cut but drops a short derived one', () => {
    const pause = defect('p', 10, 10.3, { type: 'pause' })
    const keep = { ...settings, pauseKeepSec: 0.4, paddingByType: { pause: { before: 0, after: 0 } } }
    expect(cutRangeFor(pause, keep, 60)).toBeNull()
    expect(cutRangeFor(pause, keep, 60, { start: 10.05, end: 10.2 })).toEqual({
      start: 10.05,
      end: 10.2
    })
  })

  it('builds the cut list even when skip mode is off', () => {
    const off = { ...settings, skipEnabled: false }
    expect(buildCutList([defect('a', 10, 11)], off, 60)).toEqual([
      { start: 9.8, end: 11.3 }
    ])
    expect(buildSkipIntervals([defect('a', 10, 11)], off, 60)).toEqual([])
  })

  it('filters dismissed defects and merges overlapping cuts', () => {
    expect(
      buildCutList(
        [
          defect('a', 10, 11),
          defect('b', 11.1, 12),
          defect('c', 20, 21, { dismissed: true })
        ],
        settings,
        60
      )
    ).toEqual([{ start: 9.8, end: 12.3 }])
  })

  it('returns the keep ranges as the complement of the cuts', () => {
    expect(
      complementRanges(
        [
          { start: 2, end: 4 },
          { start: 6, end: 8 }
        ],
        10
      )
    ).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 6 },
      { start: 8, end: 10 }
    ])
    expect(complementRanges([], 10)).toEqual([{ start: 0, end: 10 }])
    expect(complementRanges([{ start: -2, end: 4 }], 10)).toEqual([
      { start: 4, end: 10 }
    ])
  })
})

describe('cut view', () => {
  it('has no hatching when the cut matches the fill', () => {
    expect(cutView({ start: 10, end: 12 }, { start: 10, end: 12 })).toEqual({
      defect: { start: 10, end: 12 },
      cut: { start: 10, end: 12 },
      outer: [],
      inner: []
    })
  })

  it('puts padding outside the fill', () => {
    const view = cutView({ start: 10, end: 12 }, { start: 9, end: 13 })
    expect(view.outer).toEqual([
      { start: 9, end: 10 },
      { start: 12, end: 13 }
    ])
    expect(view.inner).toEqual([])
  })

  it('puts kept room tone inside the fill', () => {
    const view = cutView({ start: 10, end: 12 }, { start: 10.2, end: 11.8 })
    expect(view.outer).toEqual([])
    expect(view.inner).toEqual([
      { start: 10, end: 10.2 },
      { start: 11.8, end: 12 }
    ])
  })

  it('handles a shifted cut and a missing cut', () => {
    const shifted = cutView({ start: 10, end: 12 }, { start: 9, end: 11 })
    expect(shifted.outer).toEqual([{ start: 9, end: 10 }])
    expect(shifted.inner).toEqual([{ start: 11, end: 12 }])
    expect(cutView({ start: 10, end: 12 }, null)).toEqual({
      defect: { start: 10, end: 12 },
      cut: null,
      outer: [],
      inner: []
    })
  })
})

describe('subtract ranges', () => {
  it('splits a range around kept holes', () => {
    expect(
      subtractRanges({ start: 1, end: 5 }, [
        { start: 1.5, end: 2 },
        { start: 3, end: 4 }
      ])
    ).toEqual([
      { start: 1, end: 1.5 },
      { start: 2, end: 3 },
      { start: 4, end: 5 }
    ])
  })

  it('ignores holes outside the range and keeps the whole range otherwise', () => {
    expect(subtractRanges({ start: 1, end: 2 }, [])).toEqual([{ start: 1, end: 2 }])
    expect(subtractRanges({ start: 1, end: 2 }, [{ start: 5, end: 6 }])).toEqual([
      { start: 1, end: 2 }
    ])
  })
})
