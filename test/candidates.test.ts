import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RULES,
  detectDefects,
  detectDefectsWithCandidates,
  normalizeRules
} from '../src/shared/defects'
import { candidateHint } from '../src/renderer/src/defectsUi'
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

function transcriptOf(words: Word[], duration = 30): Transcript {
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

function rulesWithFillerMin(min: number): DefectRules {
  return normalizeRules({
    ...DEFAULT_RULES,
    minDurationByType: { ...DEFAULT_RULES.minDurationByType, filler: min }
  })
}

describe('automatic defect candidates', () => {
  const words = [
    word(0, 1, 1.3, 'ну', 'filler'),
    word(1, 2, 2.6, 'ээ', 'filler'),
    word(2, 4, 4.5, 'да')
  ]
  const transcript = transcriptOf(words)

  it('keeps a below-threshold filler as a candidate with the same id', () => {
    const strict = detectDefectsWithCandidates(transcript, rulesWithFillerMin(0.5))
    const candidate = strict.candidates.find((item) => item.type === 'filler')

    expect(strict.defects.map((item) => item.id)).not.toContain(candidate?.id)
    expect(candidate).toMatchObject({
      reason: 'min-duration',
      start: 1,
      end: 1.3,
      wordIds: [0]
    })
    expect(candidate?.measuredSec).toBeCloseTo(0.3, 6)

    const loose = detectDefects(transcript, rulesWithFillerMin(0))
    expect(loose.map((item) => item.id)).toContain(candidate?.id)
  })

  it('does not renumber the remaining defects around a candidate', () => {
    const strict = detectDefectsWithCandidates(transcript, rulesWithFillerMin(0.5))
    const loose = detectDefectsWithCandidates(transcript, rulesWithFillerMin(0))

    const strictFiller = strict.defects.find((item) => item.type === 'filler')
    const looseFillers = loose.defects.filter((item) => item.type === 'filler')
    expect(strictFiller?.id).toBe(looseFillers[1]?.id)
    expect(looseFillers[0]?.id).toBe(strict.candidates[0]?.id)
  })

  it('promotes a candidate when its id is explicitly kept', () => {
    const strict = detectDefectsWithCandidates(transcript, rulesWithFillerMin(0.5))
    const candidate = strict.candidates.find((item) => item.type === 'filler')
    expect(candidate).toBeDefined()

    const promoted = detectDefectsWithCandidates(transcript, rulesWithFillerMin(0.5), [], {
      promotedIds: [candidate!.id]
    })
    expect(promoted.defects.map((item) => item.id)).toContain(candidate!.id)
    expect(promoted.candidates.some((item) => item.id === candidate!.id)).toBe(false)
  })

  it('does not revive a disabled type even when its id is promoted', () => {
    const rules = normalizeRules({
      ...rulesWithFillerMin(0.5),
      enabledTypes: { ...DEFAULT_RULES.enabledTypes, filler: false }
    })
    const result = detectDefectsWithCandidates(transcript, rules, [], {
      promotedIds: ['auto-filler-w0']
    })

    expect(result.defects.some((item) => item.type === 'filler')).toBe(false)
    expect(result.candidates.find((item) => item.id === 'auto-filler-w0')).toMatchObject({
      reason: 'type-disabled'
    })
  })

  it('keeps a promoted candidate dismissed when it was deleted', () => {
    const strict = detectDefectsWithCandidates(transcript, rulesWithFillerMin(0.5))
    const candidate = strict.candidates.find((item) => item.type === 'filler')
    expect(candidate).toBeDefined()

    const dismissed = detectDefectsWithCandidates(transcript, rulesWithFillerMin(0.5), [], {
      promotedIds: [candidate!.id],
      dismissedIds: [candidate!.id]
    })
    expect(dismissed.defects.find((item) => item.id === candidate!.id)?.dismissed).toBe(true)
  })

  it('keeps promoted candidates standalone instead of changing their id into a group', () => {
    const close = transcriptOf([
      word(0, 1, 1.2, 'ну', 'filler'),
      word(1, 1.25, 1.45, 'ээ', 'filler')
    ])
    const rules = normalizeRules({
      ...rulesWithFillerMin(0.5),
      autoGroupEnabled: true,
      autoGroupGapSec: 0.3
    })
    const strict = detectDefectsWithCandidates(close, rules)
    const promotedIds = strict.candidates.map((item) => item.id)
    expect(promotedIds).toHaveLength(2)

    const promoted = detectDefectsWithCandidates(close, rules, [], { promotedIds })
    expect(promoted.defects.map((item) => item.id).sort()).toEqual([...promotedIds].sort())
    expect(promoted.defects.every((item) => !item.groupIds)).toBe(true)
  })
})

describe('below-threshold candidate hint', () => {
  const words = [
    word(0, 1, 1.3, 'ну', 'filler'),
    word(1, 4, 4.5, 'да')
  ]
  const transcript = transcriptOf(words)

  it('explains that a below-threshold filler is not skipped', () => {
    const result = detectDefectsWithCandidates(transcript, rulesWithFillerMin(0.5))
    const candidate = result.candidates.find((item) => item.id === 'auto-filler-w0')
    expect(candidate).toBeDefined()

    expect(candidateHint(candidate!, 0.5, 'ru')).toBe(
      'филлер · ниже порога 0.30 c < 0.50 c · не пропускается'
    )
  })

  it('does not claim a threshold for a disabled type', () => {
    const rules = normalizeRules({
      ...rulesWithFillerMin(0.5),
      enabledTypes: { ...DEFAULT_RULES.enabledTypes, filler: false }
    })
    const result = detectDefectsWithCandidates(transcript, rules)
    const candidate = result.candidates.find((item) => item.id === 'auto-filler-w0')
    expect(candidate).toBeDefined()

    expect(candidateHint(candidate!, 0.5, 'ru')).toBe('филлер · тип выключен · не пропускается')
  })
})
