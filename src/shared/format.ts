import { localeTag, translate, type UiLanguage } from './i18n'

export function formatTimecode(seconds: number, withMillis = false): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  const totalMs = Math.round(safe * 1000)
  const ms = totalMs % 1000
  const totalSec = Math.floor(totalMs / 1000)
  const s = totalSec % 60
  const m = Math.floor(totalSec / 60) % 60
  const h = Math.floor(totalSec / 3600)
  const base = `${h > 0 ? `${h}:` : ''}${h > 0 ? String(m).padStart(2, '0') : m}:${String(s).padStart(2, '0')}`
  return withMillis ? `${base}.${String(ms).padStart(3, '0')}` : base
}

export function formatDuration(seconds: number): string {
  return formatTimecode(seconds)
}

/** Compact duration for defect cards: up to 2 decimals with the locale separator. */
export function formatShortSeconds(seconds: number, lang: UiLanguage = 'ru'): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  const rounded = Math.round(safe * 100) / 100
  const value = lang === 'ru' ? String(rounded).replace('.', ',') : String(rounded)
  return translate(lang, 'unit.shortSeconds', { value })
}

export function formatBytes(bytes: number, lang: UiLanguage = 'ru'): string {
  const units = [
    translate(lang, 'unit.bytes.0'),
    translate(lang, 'unit.bytes.kb'),
    translate(lang, 'unit.bytes.mb'),
    translate(lang, 'unit.bytes.gb')
  ]
  if (!Number.isFinite(bytes) || bytes <= 0) return `0 ${units[0]}`
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** Human-readable remaining time, e.g. `~2 min 10 s`. */
export function formatEta(seconds: number | undefined, lang: UiLanguage = 'ru'): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return ''
  if (seconds < 60) {
    return translate(lang, 'unit.etaSeconds', { seconds: Math.max(1, Math.round(seconds)) })
  }
  // Round once, then split, so 119.7 never renders as `1 min 60 s`.
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return rest > 0
    ? translate(lang, 'unit.etaMinutesSeconds', { minutes, seconds: rest })
    : translate(lang, 'unit.etaMinutes', { minutes })
}

/** Clock time for dialogs, in the active locale. */
export function formatClock(value: string, lang: UiLanguage = 'ru'): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(localeTag(lang), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

/** Short project date for the welcome screen, in the active locale. */
export function formatProjectDate(value: string, lang: UiLanguage = 'ru'): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(localeTag(lang), {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Parses the text of a numeric settings field. Returns null for empty or
 * incomplete input so the caller never turns an in-progress edit into 0.
 * Both a comma (Russian keyboard) and a dot are accepted.
 */
export function parseNumberInput(text: string): number | null {
  const normalized = text.trim().replace(',', '.')
  if (normalized === '' || normalized === '-' || normalized === '.' || normalized === '-.') {
    return null
  }
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

/** Snaps a value to the slider grid and clamps it to [min, max]. */
export function clampToStep(value: number, min: number, max: number, step: number): number {
  const safe = clamp(Number.isFinite(value) ? value : min, min, max)
  if (!Number.isFinite(step) || step <= 0) return safe
  const steps = Math.round((safe - min) / step)
  const snapped = min + steps * step
  return clamp(Number(snapped.toFixed(6)), min, max)
}

/** Number of decimals worth showing for a step (0.05 → 2, 1 → 0). */
export function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0
  if (step >= 1) return 0
  return Math.min(4, Math.max(1, Math.ceil(-Math.log10(step))))
}

/** Formats a value for a text field without float noise. */
export function formatStepValue(value: number, step: number): string {
  if (!Number.isFinite(value)) return '0'
  return String(Number(value.toFixed(stepDecimals(step))))
}

/** Progress of a value inside [min, max], in percent, for the slider fill. */
export function rangeProgress(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || max <= min) return 0
  return clamp(((value - min) / (max - min)) * 100, 0, 100)
}
