import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RULES,
  detectDefects,
  detectDefectsWithCandidates,
  normalizeRules
} from '../src/shared/defects'
import type { DefectRules, Transcript, Word } from '../src/shared/types'

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

function rules(patch: Partial<DefectRules> = {}): DefectRules {
  return normalizeRules({ ...DEFAULT_RULES, ...patch })
}

function ids(defects: ReturnType<typeof detectDefects>): string[] {
  return defects.map((item) => item.id)
}

describe('stable automatic defect ids', () => {
  it('derives the id from the type and the covered word ids', () => {
    const transcript = transcriptOf([
      word(0, 1, 1.5, 'ну', 'filler'),
      word(1, 4, 4.4, 'да'),
      word(2, 4.6, 4.9, 'как'),
      word(3, 4.95, 5.1, 'бы')
    ])
    const result = ids(detectDefects(transcript, rules()))

    expect(result).toContain('auto-filler-w0')
    expect(result).toContain('auto-pause-w0_1')
    expect(result).toContain('auto-filler-w2_3')
  })

  it('keeps ids unique within one detection pass', () => {
    const transcript = transcriptOf([
      word(0, 1, 1.2, 'ну', 'filler'),
      word(1, 1.25, 1.45, 'ну', 'filler'),
      word(2, 4, 4.4, 'да'),
      word(3, 4.45, 4.6, 'да'),
      word(4, 6, 6.3, 'нееет')
    ])
    const result = ids(detectDefects(transcript, rules()))

    expect(new Set(result).size).toBe(result.length)
  })

  it('keeps the id of a filler when the filler word list changes', () => {
    const transcript = transcriptOf([
      word(0, 1, 1.5, 'ну'),
      word(1, 4, 4.4, 'да')
    ])
    const withWord = detectDefects(transcript, rules())
    const withoutWord = detectDefects(
      transcript,
      rules({ fillerWords: DEFAULT_RULES.fillerWords.filter((item) => item !== 'ну') })
    )
    const restored = detectDefects(transcript, rules())

    expect(ids(withWord)).toContain('auto-filler-w0')
    expect(ids(withoutWord)).not.toContain('auto-filler-w0')
    expect(ids(withoutWord)).toContain('auto-pause-w0_1')
    expect(ids(restored)).toEqual(ids(withWord))
  })

  it('gives a below-threshold candidate the same id as the promoted defect', () => {
    const transcript = transcriptOf([
      word(0, 1, 1.3, 'ну', 'filler'),
      word(1, 4, 4.4, 'да')
    ])
    const strict = detectDefectsWithCandidates(
      transcript,
      rules({ minDurationByType: { ...DEFAULT_RULES.minDurationByType, filler: 0.5 } })
    )
    const loose = detectDefectsWithCandidates(
      transcript,
      rules({ minDurationByType: { ...DEFAULT_RULES.minDurationByType, filler: 0 } })
    )

    expect(strict.candidates.map((item) => item.id)).toContain('auto-filler-w0')
    expect(ids(loose.defects)).toContain('auto-filler-w0')
  })

  it('keeps other ids when a type is disabled', () => {
    const transcript = transcriptOf([
      word(0, 1, 1.5, 'ну', 'filler'),
      word(1, 4, 4.4, 'да')
    ])
    const all = ids(detectDefects(transcript, rules()))
    const withoutFillers = ids(
      detectDefects(transcript, rules({ enabledTypes: { ...DEFAULT_RULES.enabledTypes, filler: false } }))
    )

    expect(all).toContain('auto-filler-w0')
    expect(withoutFillers).not.toContain('auto-filler-w0')
    expect(withoutFillers).toContain('auto-pause-w0_1')
  })

  it('derives a group id from the first stable member id', () => {
    const transcript = transcriptOf([
      word(0, 1, 1.2, 'ну', 'filler'),
      word(1, 1.25, 1.45, 'ээ', 'filler')
    ])
    const defects = detectDefects(
      transcript,
      rules({ autoGroupEnabled: true, autoGroupGapSec: 0.3 })
    )
    const group = defects.find((item) => item.groupIds && item.groupIds.length > 1)

    expect(group?.id).toBe('auto-group-auto-filler-w0')
    expect(group?.groupIds).toEqual(['auto-filler-w0', 'auto-filler-w1'])
  })
})
