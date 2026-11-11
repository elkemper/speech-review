export interface TimeView {
  start: number
  end: number
}

export const MIN_VIEW_SPAN_SEC = 1.5

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function fitView(duration: number): TimeView {
  return { start: 0, end: Math.max(0.1, duration) }
}

export function clampView(
  view: TimeView,
  duration: number,
  minSpan = MIN_VIEW_SPAN_SEC
): TimeView {
  const total = Math.max(0.1, duration)
  const span = clamp(view.end - view.start, Math.min(minSpan, total), total)
  const start = clamp(view.start, 0, Math.max(0, total - span))
  return { start, end: start + span }
}

export function zoomView(
  view: TimeView,
  anchorSec: number,
  factor: number,
  duration: number,
  minSpan = MIN_VIEW_SPAN_SEC
): TimeView {
  const current = clampView(view, duration, minSpan)
  const span = current.end - current.start
  const total = Math.max(0.1, duration)
  const nextSpan = clamp(span / factor, Math.min(minSpan, total), total)
  const ratio = clamp((anchorSec - current.start) / span, 0, 1)
  const start = anchorSec - ratio * nextSpan
  return clampView({ start, end: start + nextSpan }, duration, minSpan)
}

export function panView(view: TimeView, deltaSec: number, duration: number): TimeView {
  return clampView(
    { start: view.start + deltaSec, end: view.end + deltaSec },
    duration,
    MIN_VIEW_SPAN_SEC
  )
}

export function pixelsPerSecond(view: TimeView, width: number): number {
  const span = Math.max(0.001, view.end - view.start)
  return Math.max(0.001, width) / span
}

const TICK_STEPS = [
  0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200
]

/** Aim for a time label roughly every 80 px. */
export function chooseTickStep(pps: number): number {
  const desired = 80 / Math.max(0.001, pps)
  for (const step of TICK_STEPS) {
    if (step >= desired) return step
  }
  return TICK_STEPS[TICK_STEPS.length - 1]
}

export type TimelineLod = 0 | 1 | 2 | 3

/**
 * 0 — only the waveform and defect markers, 1 — word marks, 2 — word
 * boundaries, 3 — word labels. Word marks and labels are additionally gated
 * per word by their pixel width, so detail appears gradually instead of all
 * at once.
 */
export function lodFor(pps: number): TimelineLod {
  if (pps < 1.5) return 0
  if (pps < 18) return 1
  if (pps < 70) return 2
  return 3
}

/** Word marks are only useful once there is at least a little horizontal room. */
export const MIN_WORD_MARK_WIDTH = 1.5

export function wordMarksVisible(pps: number): boolean {
  return pps >= 0.8
}

export function canDrawWordMark(wordWidth: number): boolean {
  return wordWidth >= MIN_WORD_MARK_WIDTH
}

/**
 * Readable word labels need a minimum width that shrinks as the user zooms
 * in. Because the check is per word, longer words get labels first and short
 * words join later — the strip never flips from "nothing" to "everything".
 */
export function minWordLabelWidth(pps: number): number {
  if (pps < 10) return Number.POSITIVE_INFINITY
  if (pps < 20) return 72
  if (pps < 40) return 48
  if (pps < 80) return 32
  return 24
}

export function canDrawWordLabel(pps: number, wordWidth: number): boolean {
  return wordWidth >= minWordLabelWidth(pps)
}

export type WordDetail = 'none' | 'mark' | 'label'

/**
 * Single source of truth for the word strip. A label can only be reached
 * through the mark stage, so the timeline can never show full words before
 * the small marks that represent them.
 */
export function wordDetail(pps: number, wordWidth: number): WordDetail {
  if (!wordMarksVisible(pps) || !canDrawWordMark(wordWidth)) return 'none'
  return canDrawWordLabel(pps, wordWidth) ? 'label' : 'mark'
}

/** Words are sorted by start; find the first visible index with binary search. */
export function firstVisibleWord(
  words: Array<{ start: number }>,
  startSec: number
): number {
  let low = 0
  let high = words.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (words[mid].start < startSec) low = mid + 1
    else high = mid
  }
  return low
}
