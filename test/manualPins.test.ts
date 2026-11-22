import { describe, expect, it } from 'vitest'
import { reconcileManualPins } from '../src/shared/pinnedCuts'
import type { ManualMark, PlaybackSettings } from '../src/shared/types'

const playback: PlaybackSettings = {
  skipEnabled: true,
  skipBeforeSec: 0.15,
  skipAfterSec: 0.35,
  pauseKeepSec: 0.4,
  paddingByType: { manual: { before: 0.2, after: 0.4 } },
  groupPadding: { before: 0.5, after: 0.5 }
}

function mark(id: string, start: number, end: number, groupId?: string): ManualMark {
  return {
    id,
    type: 'manual',
    start,
    end,
    wordIds: [],
    note: '',
    createdAt: new Date(0).toISOString(),
    ...(groupId ? { groupId } : {})
  }
}

describe('manual pin reconciliation', () => {
  it('re-pins a confirmed single mark after a regroup dropped its override', () => {
    const marks = [mark('m1', 10, 11)]
    const result = reconcileManualPins(marks, ['manual-m1'], {}, playback, 60, ['manual-m1'])

    expect(result).toEqual({ 'manual-m1': { start: 9.8, end: 11.4, pinned: true } })
  })

  it('re-pins a confirmed group through group padding', () => {
    const marks = [mark('m1', 10, 11, 'g1'), mark('m2', 11.1, 12, 'g1')]
    const result = reconcileManualPins(marks, ['manual-group-g1'], {}, playback, 60, [
      'manual-group-g1'
    ])

    expect(result).toEqual({
      'manual-group-g1': { start: 9.5, end: 12.5, pinned: true }
    })
  })

  it('does not touch an unconfirmed mark', () => {
    expect(
      reconcileManualPins([mark('m1', 10, 11)], [], {}, playback, 60, ['manual-m1'])
    ).toEqual({})
  })

  it('does not pin a confirmed mark that was not affected by the change', () => {
    // A mark confirmed before pinning existed must keep following the padding.
    const marks = [mark('m1', 10, 11), mark('m2', 20, 21)]
    const result = reconcileManualPins(marks, ['manual-m1', 'manual-m2'], {}, playback, 60, [
      'manual-m2'
    ])

    expect(result).toEqual({ 'manual-m2': { start: 19.8, end: 21.4, pinned: true } })
  })

  it('keeps a hand-dragged override', () => {
    const existing = { 'manual-m1': { start: 8, end: 13 } }
    const result = reconcileManualPins(
      [mark('m1', 10, 11)],
      ['manual-m1'],
      existing,
      playback,
      60,
      ['manual-m1']
    )

    expect(result).toEqual(existing)
  })

  it('keeps unrelated overrides', () => {
    const existing = { 'auto-filler-w0': { start: 1, end: 2, pinned: true } }
    const result = reconcileManualPins(
      [mark('m1', 10, 11)],
      ['manual-m1'],
      existing,
      playback,
      60,
      ['manual-m1']
    )

    expect(result['auto-filler-w0']).toEqual({ start: 1, end: 2, pinned: true })
    expect(result['manual-m1']).toBeDefined()
  })
})
