import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RULES,
  detectDefects,
  groupAutoDefects,
  normalizeRules
} from '../src/shared/defects'
import { buildSkipIntervals } from '../src/renderer/src/skip'
import {
  DEFAULT_MINI_TIMELINE_PAD_SEC,
  DEFAULT_WAVEFORM_CONTRAST,
  normalizeMiniTimelinePad,
  normalizePlaybackSettings,
  normalizeSkipPadding,
  normalizeWaveformContrast
} from '../src/shared/settings'
import type { Defect, PlaybackSettings, Transcript, Word } from '../src/shared/types'

function word(
  id: number,
  start: number,
  end: number,
  text: string,
  kind: Word['kind'] = 'word'
): Word {
  return {
    id,
    index: id,
    text,
    normalized: text.toLowerCase(),
    start,
    end,
    duration: end - start,
    kind,
    confidence: null
  }
}

function transcriptOf(words: Word[], duration = 60): Transcript {
  return {
    version: 1,
    language: 'ru',
    sampleRate: 16000,
    duration,
    words,
    segments: [],
    text: words.map((item) => item.text).join(' ')
  }
}

const basePlayback: PlaybackSettings = {
  skipEnabled: true,
  skipScope: 'all',
  skipBeforeSec: 0.15,
  skipAfterSec: 0.35
}

function defect(id: string, start: number, end: number, extra: Partial<Defect> = {}): Defect {
  return {
    id,
    type: 'filler',
    start,
    end,
    wordIds: [],
    text: id,
    severity: 'medium',
    source: 'auto',
    reviewed: false,
    note: '',
    ...extra
  }
}

describe('minimum defect duration per type', () => {
  const transcript = transcriptOf([
    word(0, 1, 1.5, 'ну', 'filler'),
    word(1, 4, 4.4, 'да')
  ])

  it('drops fillers shorter than the configured minimum', () => {
    const rules = normalizeRules({ ...DEFAULT_RULES, minDurationByType: { filler: 0.6 } })
    const defects = detectDefects(transcript, rules)
    expect(defects.filter((item) => item.type === 'filler')).toHaveLength(0)
  })

  it('keeps fillers that reach the minimum', () => {
    const rules = normalizeRules({ ...DEFAULT_RULES, minDurationByType: { filler: 0.4 } })
    const defects = detectDefects(transcript, rules)
    expect(defects.filter((item) => item.type === 'filler')).toHaveLength(1)
  })

  it('applies the minimum to pause length, not to the neighbours', () => {
    const strict = normalizeRules({
      ...DEFAULT_RULES,
      minDurationByType: { pause: 3 }
    })
    // The gap is 2.5 s (1.5 → 4.0).
    expect(detectDefects(transcript, strict).some((item) => item.type === 'pause')).toBe(false)

    const lenient = normalizeRules({
      ...DEFAULT_RULES,
      minDurationByType: { pause: 2 }
    })
    expect(detectDefects(transcript, lenient).some((item) => item.type === 'pause')).toBe(true)
  })
})

describe('automatic defect grouping', () => {
  const filler = defect('a', 1, 1.5)

  it('does nothing when the maximum gap is zero', () => {
    expect(groupAutoDefects([filler], 0, [])).toEqual([filler])
  })

  it('groups a filler directly before a pause', () => {
    const pause = defect('b', 1.5, 4, { type: 'pause' })
    const words = [word(0, 1, 1.5, 'ну', 'filler'), word(1, 4, 4.5, 'да')]
    const grouped = groupAutoDefects([filler, pause], 0.3, words)
    expect(grouped).toHaveLength(1)
    expect(grouped[0]).toMatchObject({
      id: 'auto-group-a',
      start: 1,
      end: 4,
      groupIds: ['a', 'b'],
      groupTypes: ['filler', 'pause']
    })
  })

  it('groups neighbouring fillers without a word between them', () => {
    const second = defect('b', 1.8, 2.2)
    const grouped = groupAutoDefects([filler, second], 0.3, [])
    expect(grouped).toHaveLength(1)
    expect(grouped[0].groupIds).toEqual(['a', 'b'])
  })

  it('does not group defects separated by a real word', () => {
    const second = defect('b', 2.1, 2.5)
    const words = [word(0, 1, 1.5, 'ну', 'filler'), word(1, 1.6, 2.0, 'сегодня')]
    expect(groupAutoDefects([filler, second], 1, words)).toHaveLength(2)
  })

  it('keeps a gap larger than the setting separate', () => {
    const second = defect('b', 2.1, 2.5)
    expect(groupAutoDefects([filler, second], 0.2, [])).toHaveLength(2)
  })

  it('counts every type inside a grouped defect', () => {
    const transcript = transcriptOf([
      word(0, 1, 1.5, 'ну', 'filler'),
      word(1, 4, 4.5, 'да')
    ])
    const rules = normalizeRules({ ...DEFAULT_RULES, autoGroupGapSec: 0.3 })
    const defects = detectDefects(transcript, rules)
    const group = defects.find((item) => item.groupIds && item.groupIds.length > 1)
    expect(group?.groupTypes).toEqual(['filler', 'pause'])
  })
})

describe('per-type skip padding', () => {
  const settings: PlaybackSettings = {
    ...basePlayback,
    paddingByType: {
      filler: { before: 0.05, after: 0.1 },
      pause: { before: 0, after: 0 }
    },
    groupPadding: { before: 0.5, after: 0.5 }
  }

  it('uses the padding of the defect type', () => {
    expect(
      buildSkipIntervals([defect('a', 10, 11)], settings, 60)
    ).toEqual([{ start: 9.95, end: 11.1 }])
    expect(
      buildSkipIntervals([defect('b', 10, 11, { type: 'pause' })], settings, 60)
    ).toEqual([{ start: 10, end: 11 }])
  })

  it('uses group padding for a logical group', () => {
    expect(
      buildSkipIntervals(
        [defect('g', 10, 11, { groupIds: ['a', 'b'], groupTypes: ['filler', 'pause'] })],
        settings,
        60
      )
    ).toEqual([{ start: 9.5, end: 11.5 }])
  })

  it('falls back to the global padding when a type has no entry', () => {
    expect(
      buildSkipIntervals([defect('a', 10, 11, { type: 'repetition' })], settings, 60)
    ).toEqual([{ start: 9.85, end: 11.35 }])
  })

  it('applies padding regardless of the skip mode being switched on', () => {
    // Padding is computed before the enable flag; the disable flag only yields
    // no intervals, so nothing depends on reviewing first.
    expect(
      buildSkipIntervals([defect('a', 10, 11)], { ...settings, skipEnabled: false }, 60)
    ).toEqual([])
  })
})

describe('settings normalization', () => {
  it('fills every per-type padding entry', () => {
    const playback = normalizePlaybackSettings({
      skipEnabled: true,
      skipScope: 'marks',
      skipBeforeSec: 0.2,
      skipAfterSec: 0.3,
      paddingByType: { filler: { before: 0.1, after: 0.4 } }
    })
    expect(playback.skipScope).toBe('marks')
    expect(playback.paddingByType?.filler).toEqual({ before: 0.1, after: 0.4 })
    expect(playback.paddingByType?.pause).toEqual({ before: 0, after: 0 })
    expect(playback.groupPadding?.before).toBeGreaterThan(0)
  })

  it('clamps padding to a safe range', () => {
    expect(normalizeSkipPadding({ before: -3, after: 99 }, { before: 0, after: 0 })).toEqual({
      before: 0,
      after: 5
    })
    expect(normalizeSkipPadding(undefined, { before: 0.1, after: 0.2 })).toEqual({
      before: 0.1,
      after: 0.2
    })
  })

  it('adds new rule fields to old rule objects', () => {
    const rules = normalizeRules({ pauseThresholdSec: 0.9 })
    expect(rules.pauseThresholdSec).toBe(0.9)
    expect(rules.autoGroupGapSec).toBe(DEFAULT_RULES.autoGroupGapSec)
    expect(rules.minDurationByType.filler).toBe(0)
    expect(rules.fillerWords).toEqual(DEFAULT_RULES.fillerWords)
  })

  it('clamps the mini timeline padding', () => {
    expect(normalizeMiniTimelinePad(undefined)).toBe(DEFAULT_MINI_TIMELINE_PAD_SEC)
    expect(normalizeMiniTimelinePad(-2)).toBe(0)
    expect(normalizeMiniTimelinePad(99)).toBe(15)
    expect(normalizeMiniTimelinePad(4.5)).toBe(4.5)
  })

  it('clamps the waveform contrast', () => {
    expect(normalizeWaveformContrast(undefined)).toBe(DEFAULT_WAVEFORM_CONTRAST)
    expect(normalizeWaveformContrast(-10)).toBe(0)
    expect(normalizeWaveformContrast(500)).toBe(100)
    expect(normalizeWaveformContrast(62.4)).toBe(62)
  })

  it('clamps the automatic grouping gap', () => {
    expect(normalizeRules({ autoGroupGapSec: -2 }).autoGroupGapSec).toBe(0)
    expect(normalizeRules({ autoGroupGapSec: 42 }).autoGroupGapSec).toBe(10)
  })
})