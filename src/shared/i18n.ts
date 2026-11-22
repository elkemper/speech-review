import { en } from './locales/en'
import { ru, type MessageKey, type RuMessages } from './locales/ru'

export type { MessageKey }
export type UiLanguage = 'ru' | 'en'

export const UI_LANGUAGES: UiLanguage[] = ['ru', 'en']
export const DEFAULT_UI_LANGUAGE: UiLanguage = 'ru'

export type TParams = Readonly<Record<string, string | number>>

export type Dictionaries = Record<UiLanguage, Record<MessageKey, string>>

export const DICTIONARIES: Dictionaries = { ru, en }

/** True for a value that can be used as a UI language. */
export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === 'ru' || value === 'en'
}

/**
 * Normalizes a persisted or external UI language. Anything unknown falls back
 * to the provided default (Russian by default).
 */
export function normalizeUiLanguage(
  value: unknown,
  fallback: UiLanguage = DEFAULT_UI_LANGUAGE
): UiLanguage {
  return isUiLanguage(value) ? value : fallback
}

/** BCP 47 tag used for `Intl` and `toLocale*` formatting. */
export function localeTag(lang: UiLanguage): string {
  return lang === 'en' ? 'en-US' : 'ru-RU'
}

/** Maps a system locale such as `en-GB` or `ru_RU` to a supported UI language. */
export function uiLanguageFromLocale(locale: string | undefined | null): UiLanguage {
  if (!locale) return DEFAULT_UI_LANGUAGE
  const lower = locale.toLowerCase()
  if (lower.startsWith('ru')) return 'ru'
  if (lower.startsWith('en')) return 'en'
  return DEFAULT_UI_LANGUAGE
}

const PLACEHOLDER = /\{(\w+)\}/g

function interpolate(template: string, params: TParams | undefined): string {
  if (!params) return template
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name]
    return value === undefined ? match : String(value)
  })
}

/**
 * Looks a message up in the requested language. Missing or empty entries fall
 * back to Russian, then to the key itself, so a partial catalogue never shows
 * a blank string.
 */
export function translate(lang: UiLanguage, key: MessageKey, params?: TParams): string {
  const dictionary = DICTIONARIES[lang]
  const fallback = DICTIONARIES[DEFAULT_UI_LANGUAGE]
  const template = dictionary[key] || fallback[key] || key
  return interpolate(template, params)
}

export type PluralCategory = 'one' | 'few' | 'many'

export interface PluralForms {
  /** Used for 1 in both languages. */
  one: string
  /** Russian 2–4; ignored in English. */
  few?: string
  /** Everything else. */
  many: string
}

/** Plural category for a count in the given language. */
export function pluralCategory(lang: UiLanguage, count: number): PluralCategory {
  const n = Math.abs(Math.trunc(count))
  if (lang === 'en') return n === 1 ? 'one' : 'many'
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'one'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few'
  return 'many'
}

/**
 * Selects a plural form and interpolates it. `count` is always available as
 * `{count}`; extra parameters are merged on top.
 */
export function translatePlural(
  lang: UiLanguage,
  forms: PluralForms,
  count: number,
  params?: TParams
): string {
  const category = pluralCategory(lang, count)
  const template =
    category === 'few' ? (forms.few ?? forms.many) : category === 'one' ? forms.one : forms.many
  return interpolate(template, { count, ...params })
}

/** Compile-time guarantee that every Russian key has an English entry. */
export type EnglishCatalogue = Record<keyof RuMessages, string>
