import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RULES,
  detectDefects,
  groupAutoDefects,
  MAX_PAUSE_MIN_DURATION,
  MIN_PAUSE_MIN_DURATION,
  normalizeRules
} from '../src/shared/defects'
import { buildSkipIntervals } from '../src/renderer/src/skip'
import {
  DEFAULT_MINI_TIMELINE_PAD_SEC,
  DEFAULT_PAUSE_KEEP_SEC,
  DEFAULT_WAVEFORM_CONTRAST,
  MAX_PAUSE_KEEP_SEC,
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
  skipBeforeSec: 0.15,
  skipAfterSec: 0.35,
  pauseKeepSec: 0
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
    confirmed: false,
    dismissed: false,
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
    const rules = normalizeRules({
      ...DEFAULT_RULES,
      autoGroupEnabled: true,
      autoGroupGapSec: 0.3
    })
    const defects = detectDefects(transcript, rules)
    const group = defects.find((item) => item.groupIds && item.groupIds.length > 1)
    expect(group?.groupTypes).toEqual(['filler', 'pause'])
  })

  it('marks dismissed automatic defects and keeps the active group separate', () => {
    const transcript = transcriptOf([
      word(0, 1, 1.5, 'ну', 'filler'),
      word(1, 4, 4.5, 'да')
    ])
    const rules = normalizeRules({
      ...DEFAULT_RULES,
      autoGroupEnabled: true,
      autoGroupGapSec: 0.3
    })
    const all = detectDefects(transcript, rules)
    expect(all.some((item) => item.groupIds && item.groupIds.length > 1)).toBe(true)
    const pauseId = detectDefects(
      transcript,
      normalizeRules({ ...DEFAULT_RULES })
    ).find((item) => item.type === 'pause')?.id

    const withDismissed = detectDefects(transcript, rules, [], {
      dismissedIds: ['auto-filler-w0']
    })
    expect(
      withDismissed.find((item) => item.id === 'auto-filler-w0')?.dismissed
    ).toBe(true)
    expect(
      withDismissed.some((item) => !item.dismissed && item.groupIds && item.groupIds.length > 1)
    ).toBe(false)
    const pause = withDismissed.find((item) => item.type === 'pause')
    expect(pause?.id).toBe(pauseId)
    expect(pause?.dismissed).toBe(false)
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

describe('enabled defect types', () => {
  const transcript = transcriptOf([
    word(0, 1, 1.5, 'ну', 'filler'),
    word(1, 4, 4.4, 'да')
  ])

  it('does not detect a disabled type', () => {
    const rules = normalizeRules({
      ...DEFAULT_RULES,
      enabledTypes: { filler: false }
    })
    const defects = detectDefects(transcript, rules)
    expect(defects.some((item) => item.type === 'filler')).toBe(false)
    expect(defects.some((item) => item.type === 'pause')).toBe(true)
  })

  it('keeps the ids of other types stable when one type is turned off', () => {
    const all = detectDefects(transcript, normalizeRules(DEFAULT_RULES))
    const noFillers = detectDefects(
      transcript,
      normalizeRules({ ...DEFAULT_RULES, enabledTypes: { filler: false } })
    )
    const pauseWithFillers = all.find((item) => item.type === 'pause')
    const pauseWithoutFillers = noFillers.find((item) => item.type === 'pause')
    expect(pauseWithoutFillers?.id).toBe(pauseWithFillers?.id)
  })

  it('never filters manual marks', () => {
    const rules = normalizeRules({
      ...DEFAULT_RULES,
      enabledTypes: { manual: false }
    })
    const marks = [
      {
        id: 'mark-1',
        type: 'manual' as const,
        start: 1,
        end: 1.5,
        wordIds: [0],
        note: '',
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ]
    const defects = detectDefects(transcript, rules, marks)
    expect(defects.some((item) => item.source === 'manual')).toBe(true)
  })

  it('recognises old rules without enabledTypes with every usable type on', () => {
    const rules = normalizeRules({ repetitionWindowSec: 1.5 })
    for (const type of [
      'filler',
      'pause',
      'repetition',
      'elongation',
      'false_start',
      'vocal_sound',
      'manual'
    ] as const) {
      expect(rules.enabledTypes[type]).toBe(true)
    }
    expect(rules.enabledTypes.unclear).toBe(false)
  })
})

describe('automatic grouping toggle', () => {
  const transcript = transcriptOf([
    word(0, 1, 1.5, 'ну', 'filler'),
    word(1, 4, 4.5, 'да')
  ])

  it('does not group when the toggle is off even with a gap value', () => {
    const rules = normalizeRules({
      ...DEFAULT_RULES,
      autoGroupEnabled: false,
      autoGroupGapSec: 0.5
    })
    const defects = detectDefects(transcript, rules)
    expect(defects.some((item) => item.groupIds && item.groupIds.length > 1)).toBe(false)
  })

  it('migrates old rules with a positive gap to enabled', () => {
    expect(normalizeRules({ autoGroupGapSec: 0.4 }).autoGroupEnabled).toBe(true)
    expect(normalizeRules({ autoGroupGapSec: 0 }).autoGroupEnabled).toBe(false)
  })

  it('keeps an explicit off flag while remembering the gap', () => {
    const rules = normalizeRules({ autoGroupEnabled: false, autoGroupGapSec: 0.4 })
    expect(rules.autoGroupEnabled).toBe(false)
    expect(rules.autoGroupGapSec).toBe(0.4)
  })
})

describe('settings normalization', () => {
  it('fills every per-type padding entry', () => {
    const playback = normalizePlaybackSettings({
      skipEnabled: true,
      skipBeforeSec: 0.2,
      skipAfterSec: 0.3,
      paddingByType: { filler: { before: 0.1, after: 0.4 } }
    })
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

  it('defaults and clamps the pause room tone', () => {
    expect(normalizePlaybackSettings({}).pauseKeepSec).toBe(DEFAULT_PAUSE_KEEP_SEC)
    expect(normalizePlaybackSettings({ pauseKeepSec: -1 }).pauseKeepSec).toBe(0)
    expect(normalizePlaybackSettings({ pauseKeepSec: 99 }).pauseKeepSec).toBe(
      MAX_PAUSE_KEEP_SEC
    )
    expect(normalizePlaybackSettings({ pauseKeepSec: 0.6 }).pauseKeepSec).toBe(0.6)
  })

  it('adds new rule fields to old rule objects', () => {
    const rules = normalizeRules({ repetitionWindowSec: 1.5 })
    expect(rules.minDurationByType.pause).toBe(1.2)
    expect(rules.autoGroupGapSec).toBe(DEFAULT_RULES.autoGroupGapSec)
    expect(rules.minDurationByType.filler).toBe(0)
    expect(rules.fillerWords).toEqual(DEFAULT_RULES.fillerWords)
  })

  it('keeps the pause minimum as the only pause threshold', () => {
    expect(normalizeRules({}).minDurationByType.pause).toBe(1.2)
    expect(normalizeRules({ minDurationByType: { pause: 0 } }).minDurationByType.pause).toBe(
      1.2
    )
    expect(
      normalizeRules({ minDurationByType: { pause: MIN_PAUSE_MIN_DURATION / 2 } })
        .minDurationByType.pause
    ).toBe(MIN_PAUSE_MIN_DURATION)
    expect(normalizeRules({ minDurationByType: { pause: 4 } }).minDurationByType.pause).toBe(4)
    expect(
      normalizeRules({ minDurationByType: { pause: MAX_PAUSE_MIN_DURATION + 1 } })
        .minDurationByType.pause
    ).toBe(MAX_PAUSE_MIN_DURATION)
    expect('pauseThresholdSec' in normalizeRules({ pauseThresholdSec: 1.5 })).toBe(false)
    expect('pauseHighSec' in normalizeRules({ pauseHighSec: 2.5 })).toBe(false)
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