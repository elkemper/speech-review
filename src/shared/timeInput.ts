import { exportTimecode } from './exportCsv'

/** One numeric part of a typed time: digits with an optional decimal tail. */
const TIME_PART = /^\d+(?:\.\d+)?$/

/**
 * Parses a time typed into the table's add dialog or a time cell.
 *
 * Accepted forms: `HH:MM:SS.mmm`, `MM:SS.mmm`, `SS.mmm`, `HH:MM:SS` and a
 * comma as the decimal separator. A single number is seconds. Parts may
 * overflow their usual range (`1:75` is 135 seconds), matching a spreadsheet
 * rather than a strict clock. Returns `null` for empty, negative or malformed
 * input so an in-progress edit never becomes 0.
 */
export function parseTimeInput(text: string): number | null {
  const normalized = text.trim().replace(',', '.')
  if (normalized === '' || normalized.startsWith('-')) return null
  const parts = normalized.split(':')
  if (parts.length > 3) return null

  let seconds = 0
  for (const part of parts) {
    if (!TIME_PART.test(part)) return null
    const value = Number(part)
    if (!Number.isFinite(value)) return null
    seconds = seconds * 60 + value
  }
  return Number.isFinite(seconds) ? seconds : null
}

/** Two timecodes are within the exported display precision (milliseconds). */
const SAME_TIME_EPSILON_SEC = 5e-4

/**
 * True when two accepted time texts mean the same moment. Typing `10` over a
 * prefilled `00:00:10.000` is not an edit, even though the text differs.
 */
export function isSameTimeInput(left: string, right: string): boolean {
  const a = parseTimeInput(left)
  const b = parseTimeInput(right)
  return a !== null && b !== null && Math.abs(a - b) < SAME_TIME_EPSILON_SEC
}

/** Fixed-width timecode used to prefill an editable time input. */
export function formatTimeInput(seconds: number): string {
  return exportTimecode(seconds)
}
