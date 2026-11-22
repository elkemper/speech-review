import { describe, expect, it } from 'vitest'
import {
  DICTIONARIES,
  UI_LANGUAGES,
  isUiLanguage,
  localeTag,
  normalizeUiLanguage,
  pluralCategory,
  translate,
  translatePlural,
  uiLanguageFromLocale
} from '@shared/i18n'
import {
  defectTypeLabel,
  exportFieldLabel,
  modelNote,
  severityLabel,
  transcribePhaseLabel,
  videoEncoderLabel,
  videoQualityNameLabel,
  videoResolutionLabel,
  yesNo
} from '@shared/labels'
import { formatBytes, formatEta, formatShortSeconds } from '@shared/format'
import { normalizeUiLanguageSetting } from '@shared/settings'
import { buildManualDefects } from '@shared/defects'
import { settingsHistoryMetaForPatch } from '../src/renderer/src/settingsHistory'

const CYRILLIC = /[Ѐ-ӿ]/

describe('i18n catalogue', () => {
  it('has the same keys in both languages', () => {
    const ruKeys = Object.keys(DICTIONARIES.ru).sort()
    const enKeys = Object.keys(DICTIONARIES.en).sort()
    expect(enKeys).toEqual(ruKeys)
  })

  it('keeps the English catalogue free of Cyrillic copy', () => {
    const offenders = Object.entries(DICTIONARIES.en)
      .filter(([, value]) => CYRILLIC.test(value))
      .map(([key]) => key)
    expect(offenders).toEqual([])
  })

  it('has no empty messages', () => {
    for (const lang of UI_LANGUAGES) {
      for (const [key, value] of Object.entries(DICTIONARIES[lang])) {
        expect(value.trim(), `${lang}:${key}`).not.toBe('')
      }
    }
  })

  it('uses the same placeholders in both languages', () => {
    const placeholders = (value: string): string[] =>
      [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
    for (const [key, ruValue] of Object.entries(DICTIONARIES.ru)) {
      const enValue = DICTIONARIES.en[key as keyof typeof DICTIONARIES.en]
      expect(placeholders(enValue), key).toEqual(placeholders(ruValue))
    }
  })
})

describe('translate', () => {
  it('returns the message in the requested language', () => {
    expect(translate('ru', 'settings.title')).toBe('Настройки')
    expect(translate('en', 'settings.title')).toBe('Settings')
  })

  it('interpolates placeholders and leaves unknown ones intact', () => {
    expect(translate('en', 'toast.deleted', { count: 3 })).toBe('Deleted: 3')
    expect(translate('ru', 'toast.deleted', { count: 3, extra: 'x' })).toBe('Удалено: 3')
    expect(translate('en', 'toast.undo', {})).toBe('Undone: {label}')
  })

  it('falls back to Russian, then to the key', () => {
    const key = 'settings.title'
    expect(translate('en', key)).toBe('Settings')
    // Simulate a partial dictionary without touching the real one.
    const saved = DICTIONARIES.en[key]
    delete (DICTIONARIES.en as Record<string, string>)[key]
    try {
      expect(translate('en', key)).toBe('Настройки')
    } finally {
      DICTIONARIES.en[key] = saved
    }
    expect(translate('en', 'missing.key' as typeof key)).toBe('missing.key')
  })
})

describe('language helpers', () => {
  it('validates and normalizes languages', () => {
    expect(isUiLanguage('ru')).toBe(true)
    expect(isUiLanguage('de')).toBe(false)
    expect(normalizeUiLanguage('en')).toBe('en')
    expect(normalizeUiLanguage('de')).toBe('ru')
    expect(normalizeUiLanguage(undefined, 'en')).toBe('en')
    expect(normalizeUiLanguageSetting('en')).toBe('en')
    expect(normalizeUiLanguageSetting(42)).toBe('ru')
  })

  it('maps system locales to a supported language', () => {
    expect(uiLanguageFromLocale('ru-RU')).toBe('ru')
    expect(uiLanguageFromLocale('en-GB')).toBe('en')
    expect(uiLanguageFromLocale('de-DE')).toBe('ru')
    expect(uiLanguageFromLocale(null)).toBe('ru')
  })

  it('returns Intl locale tags', () => {
    expect(localeTag('ru')).toBe('ru-RU')
    expect(localeTag('en')).toBe('en-US')
  })
})

describe('plurals', () => {
  it('splits Russian categories', () => {
    expect(pluralCategory('ru', 1)).toBe('one')
    expect(pluralCategory('ru', 21)).toBe('one')
    expect(pluralCategory('ru', 3)).toBe('few')
    expect(pluralCategory('ru', 24)).toBe('few')
    expect(pluralCategory('ru', 5)).toBe('many')
    expect(pluralCategory('ru', 11)).toBe('many')
    expect(pluralCategory('ru', 0)).toBe('many')
  })

  it('uses one/many in English', () => {
    expect(pluralCategory('en', 1)).toBe('one')
    expect(pluralCategory('en', 2)).toBe('many')
  })

  it('selects and interpolates the form', () => {
    const forms = { one: '{count} слово', few: '{count} слова', many: '{count} слов' }
    expect(translatePlural('ru', forms, 1)).toBe('1 слово')
    expect(translatePlural('ru', forms, 2)).toBe('2 слова')
    expect(translatePlural('ru', forms, 5)).toBe('5 слов')
    expect(translatePlural('en', { one: '{count} word', many: '{count} words' }, 2)).toBe(
      '2 words'
    )
  })
})

describe('label helpers', () => {
  it('localizes enum labels', () => {
    expect(defectTypeLabel('ru', 'filler')).toBe('филлер')
    expect(defectTypeLabel('en', 'false_start')).toBe('false start')
    expect(severityLabel('en', 'high')).toBe('high')
    expect(exportFieldLabel('en', 'start_tc')).toBe('Cut start (timecode)')
    expect(transcribePhaseLabel('en', 'transcribe')).toBe('Transcribing')
    expect(videoEncoderLabel('en', 'h264_videotoolbox')).toBe('H.264 · hardware')
    expect(videoQualityNameLabel('ru', 'balanced')).toBe('Сбалансированное')
    expect(videoResolutionLabel('en', 'source')).toBe('Same as source')
    expect(videoResolutionLabel('ru', '720')).toBe('720p')
    expect(yesNo('en', true)).toBe('yes')
    expect(yesNo('ru', false)).toBe('нет')
    expect(modelNote('en', 'q4_k')).toMatch(/Lightest/)
  })
})

describe('language-aware formatting', () => {
  it('formats compact seconds per locale', () => {
    expect(formatShortSeconds(0.83, 'ru')).toBe('0,83 с.')
    expect(formatShortSeconds(0.83, 'en')).toBe('0.83 s')
  })

  it('formats bytes per locale', () => {
    expect(formatBytes(0, 'ru')).toBe('0 Б')
    expect(formatBytes(0, 'en')).toBe('0 B')
    expect(formatBytes(1536, 'ru')).toBe('1.5 КБ')
    expect(formatBytes(1536, 'en')).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 * 1024, 'en')).toBe('5.0 MB')
    expect(formatBytes(20 * 1024 * 1024, 'en')).toBe('20 MB')
  })

  it('formats a remaining time per locale', () => {
    expect(formatEta(30, 'ru')).toBe('~30 с')
    expect(formatEta(30, 'en')).toBe('~30 s')
    expect(formatEta(125, 'ru')).toBe('~2 мин 5 с')
    expect(formatEta(125, 'en')).toBe('~2 min 5 s')
    expect(formatEta(120, 'en')).toBe('~2 min')
    // Round the total once, so the remainder never becomes 60.
    expect(formatEta(119.7, 'en')).toBe('~2 min')
    expect(formatEta(119.7, 'ru')).toBe('~2 мин')
    expect(formatEta(179.8, 'en')).toBe('~3 min')
    expect(formatEta(undefined, 'en')).toBe('')
  })
})

describe('settings history language', () => {
  it('does not create an entry for a UI-only language change', () => {
    expect(settingsHistoryMetaForPatch({})).toBeNull()
  })

  it('labels fallback entries in the given language', () => {
    expect(settingsHistoryMetaForPatch({ rules: {} }, 'en')?.label).toBe('Defect rules')
    expect(settingsHistoryMetaForPatch({ playback: { skipBeforeSec: 0.2 } }, 'en')?.label).toBe(
      'Skip padding'
    )
    expect(settingsHistoryMetaForPatch({ rules: {} })?.label).toBe('Правила дефектов')
  })
})

describe('manual mark fallback text', () => {
  it('follows the interface language when a mark has no words', () => {
    const mark = {
      id: 'm1',
      type: 'manual' as const,
      start: 100,
      end: 101,
      note: '',
      createdAt: '2024-01-01T00:00:00.000Z'
    }
    const ruDefects = buildManualDefects([], [mark], 'ru')
    const enDefects = buildManualDefects([], [mark], 'en')
    expect(ruDefects[0].text).toBe('ручная метка')
    expect(enDefects[0].text).toBe('manual mark')
    // The default stays Russian so existing callers and tests are unaffected.
    expect(buildManualDefects([], [mark])[0].text).toBe('ручная метка')
  })
})
