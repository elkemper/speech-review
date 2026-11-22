import { describe, expect, it } from 'vitest'
import {
  cutRangeFor,
  pinCutFor,
  withoutPinnedCuts
} from '../src/renderer/src/skip'
import type { Defect, DefectBoundsOverride, PlaybackSettings } from '../src/shared/types'

const settings: PlaybackSettings = {
  skipEnabled: true,
  skipBeforeSec: 0.2,
  skipAfterSec: 0.3,
  pauseKeepSec: 0.4,
  paddingByType: {
    filler: { before: 0.1, after: 0.2 },
    pause: { before: 0, after: 0 },
    manual: { before: 0.15, after: 0.35 }
  },
  groupPadding: { before: 0.5, after: 0.5 }
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
    confirmed: true,
    dismissed: false,
    note: '',
    ...options
  }
}

describe('pinned cut ranges', () => {
  it('pins the derived range of a confirmed defect', () => {
    const pinned = pinCutFor(defect('a', 10, 11), settings, 60)
    expect(pinned).toEqual({ start: 9.9, end: 11.2, pinned: true })
  })

  it('pins a group through group padding', () => {
    const group = defect('auto-group-x', 10, 12, {
      groupIds: ['auto-filler-w0', 'auto-pause-w1_2']
    })
    expect(pinCutFor(group, settings, 60)).toEqual({
      start: 9.5,
      end: 12.5,
      pinned: true
    })
  })

  it('keeps the pinned range when padding changes', () => {
    const pinned = pinCutFor(defect('a', 10, 11), settings, 60)
    const widened: PlaybackSettings = {
      ...settings,
      paddingByType: { ...settings.paddingByType, filler: { before: 1, after: 1 } }
    }

    expect(cutRangeFor(defect('a', 10, 11), widened, 60, pinned)).toEqual({
      start: 9.9,
      end: 11.2
    })
  })

  it('pins a defect that has no cut as an empty range', () => {
    // A pause shorter than the kept room tone is not cut at all.
    const shortPause = defect('p', 10, 10.2, { type: 'pause' })
    expect(cutRangeFor(shortPause, settings, 60)).toBeNull()

    const pinned = pinCutFor(shortPause, settings, 60)
    expect(pinned).toEqual({ start: 10, end: 10, pinned: true })

    const widened: PlaybackSettings = {
      ...settings,
      paddingByType: { ...settings.paddingByType, pause: { before: 1, after: 1 } }
    }
    expect(cutRangeFor(shortPause, widened, 60, pinned)).toBeNull()
  })

  it('does not pin a defect that is not confirmed', () => {
    expect(pinCutFor(defect('a', 10, 11, { confirmed: false }), settings, 60)).toBeNull()
  })

  it('drops only pinned overrides', () => {
    const overrides: Record<string, DefectBoundsOverride> = {
      a: { start: 1, end: 2, pinned: true },
      b: { start: 3, end: 4 },
      c: { start: 5, end: 6, pinned: true }
    }

    expect(withoutPinnedCuts(overrides, ['a', 'c'])).toEqual({ b: { start: 3, end: 4 } })
  })

  it('keeps an explicit manual cut when the confirmation is removed', () => {
    const overrides: Record<string, DefectBoundsOverride> = {
      a: { start: 9, end: 12 }
    }

    expect(withoutPinnedCuts(overrides, ['a'])).toEqual({ a: { start: 9, end: 12 } })
  })

  it('keeps other defects when removing one pinned cut', () => {
    const overrides: Record<string, DefectBoundsOverride> = {
      a: { start: 1, end: 2, pinned: true },
      b: { start: 3, end: 4, pinned: true }
    }

    expect(withoutPinnedCuts(overrides, ['a'])).toEqual({
      b: { start: 3, end: 4, pinned: true }
    })
  })
})
