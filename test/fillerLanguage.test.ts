import { describe, expect, it } from 'vitest'
import {
  adoptFillerLanguage,
  DEFAULT_RULES,
  defaultFillerWords,
  defaultMultiWordFillers,
  defaultRulesForLanguage,
  detectDefects,
  FILLER_LEXICONS,
  fillerLanguage,
  normalizeRules,
  usesAnyDefaultFillers,
  usesDefaultFillers
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

function transcriptOf(words: Word[], language = 'ru'): Transcript {
  return {
    version: 1,
    language,
    sampleRate: 16000,
    duration: 60,
    words,
    segments: [],
    text: words.map((item) => item.text).join(' ')
  }
}

describe('filler language resolution', () => {
  it('maps a recognition language to a lexicon', () => {
    expect(fillerLanguage('ru')).toBe('ru')
    expect(fillerLanguage('en')).toBe('en')
    expect(fillerLanguage('en-US')).toBe('en')
    expect(fillerLanguage('EN')).toBe('en')
    expect(fillerLanguage('de')).toBe('ru')
    expect(fillerLanguage(undefined)).toBe('ru')
  })

  it('keeps separate Russian and English lexicons', () => {
    expect(FILLER_LEXICONS.ru.fillerWords).toContain('ну')
    expect(FILLER_LEXICONS.en.fillerWords).toContain('um')
    expect(FILLER_LEXICONS.en.fillerWords).not.toContain('ну')
    expect(FILLER_LEXICONS.ru.multiWordFillers).toContainEqual(['как', 'бы'])
    expect(FILLER_LEXICONS.en.multiWordFillers).toContainEqual(['you', 'know'])
  })

  it('returns a fresh copy so callers cannot mutate the lexicon', () => {
    const words = defaultFillerWords('en')
    words.push('mutated')
    expect(defaultFillerWords('en')).not.toContain('mutated')
    const phrases = defaultMultiWordFillers('ru')
    phrases[0].push('mutated')
    expect(defaultMultiWordFillers('ru')[0]).not.toContain('mutated')
  })

  it('builds default rules per language and keeps the Russian default intact', () => {
    const en = defaultRulesForLanguage('en')
    expect(en.fillerWords).toEqual(FILLER_LEXICONS.en.fillerWords)
    expect(en.multiWordFillers).toEqual(FILLER_LEXICONS.en.multiWordFillers)
    expect(DEFAULT_RULES.fillerWords).toEqual(FILLER_LEXICONS.ru.fillerWords)
    // Non-filler rules stay the same.
    expect(en.excludePauseAfterSentenceEnd).toBe(DEFAULT_RULES.excludePauseAfterSentenceEnd)
    expect(en.minDurationByType).toEqual(DEFAULT_RULES.minDurationByType)
  })
})

describe('normalizeRules with a language', () => {
  it('fills missing filler lists from the requested language', () => {
    expect(normalizeRules({}, 'en').fillerWords).toEqual(FILLER_LEXICONS.en.fillerWords)
    expect(normalizeRules({}, 'ru').fillerWords).toEqual(FILLER_LEXICONS.ru.fillerWords)
    // Default stays Russian for callers that do not pass a language.
    expect(normalizeRules({}).fillerWords).toEqual(FILLER_LEXICONS.ru.fillerWords)
  })

  it('keeps stored filler lists regardless of the language', () => {
    const rules = normalizeRules({ fillerWords: ['своё'], multiWordFillers: [] }, 'en')
    expect(rules.fillerWords).toEqual(['своё'])
    expect(rules.multiWordFillers).toEqual([])
  })
})

describe('adopting the filler lexicon of a language', () => {
  it('detects whether the stored lists are defaults', () => {
    expect(usesDefaultFillers(DEFAULT_RULES, 'ru')).toBe(true)
    expect(usesDefaultFillers(DEFAULT_RULES, 'en')).toBe(false)
    expect(usesAnyDefaultFillers(DEFAULT_RULES)).toBe(true)
    expect(usesAnyDefaultFillers(defaultRulesForLanguage('en'))).toBe(true)
    expect(usesAnyDefaultFillers({ ...DEFAULT_RULES, fillerWords: ['своё'] })).toBe(false)
  })

  it('swaps a default list when the language changes', () => {
    const en = adoptFillerLanguage(DEFAULT_RULES, 'en')
    expect(en.fillerWords).toEqual(FILLER_LEXICONS.en.fillerWords)
    expect(en.multiWordFillers).toEqual(FILLER_LEXICONS.en.multiWordFillers)
    const back = adoptFillerLanguage(en, 'ru')
    expect(back.fillerWords).toEqual(FILLER_LEXICONS.ru.fillerWords)
  })

  it('leaves a customized list untouched', () => {
    const custom: DefectRules = { ...DEFAULT_RULES, fillerWords: ['своё', 'слово'] }
    const en = adoptFillerLanguage(custom, 'en')
    expect(en.fillerWords).toEqual(['своё', 'слово'])
    expect(en).toBe(custom)
  })

  it('is a no-op when the list already matches the language', () => {
    const en = defaultRulesForLanguage('en')
    expect(adoptFillerLanguage(en, 'en')).toBe(en)
  })
})

describe('detection with the English lexicon', () => {
  it('finds English fillers and multi-word fillers', () => {
    const words = [
      word(0, 0, 0.3, 'Um'),
      word(1, 0.4, 0.8, 'you'),
      word(2, 0.9, 1.2, 'know'),
      word(3, 1.3, 1.6, 'like'),
      word(4, 1.7, 2.0, 'really')
    ]
    const rules = defaultRulesForLanguage('en')
    const defects = detectDefects(transcriptOf(words, 'en'), rules, [])
    const fillers = defects.filter((defect) => defect.type === 'filler')
    expect(fillers.map((defect) => defect.text)).toEqual(['Um', 'you know', 'like'])
  })

  it('does not treat Russian fillers as fillers in English', () => {
    const words = [word(0, 0, 0.3, 'ну'), word(1, 0.4, 0.8, 'вот')]
    const defects = detectDefects(transcriptOf(words, 'en'), defaultRulesForLanguage('en'), [])
    expect(defects.filter((defect) => defect.type === 'filler')).toHaveLength(0)
  })
})
