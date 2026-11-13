import type { Defect, Word } from '@shared/types'
import { clamp } from '@shared/format'

export interface WordSelection {
  anchorId: number
  focusId: number
}

export interface SelectionRange {
  start: number
  end: number
  wordIds: number[]
  text: string
}

/** Index-based lookup keeps ranges correct even if word ids ever stop being dense. */
function indexById(words: Word[]): Map<number, number> {
  const map = new Map<number, number>()
  for (let i = 0; i < words.length; i++) map.set(words[i].id, i)
  return map
}

export function rangeForSelection(
  words: Word[],
  selection: WordSelection | null
): SelectionRange | null {
  if (!selection || words.length === 0) return null
  const index = indexById(words)
  const anchor = index.get(selection.anchorId)
  const focus = index.get(selection.focusId)
  if (anchor === undefined || focus === undefined) return null

  const from = Math.min(anchor, focus)
  const to = Math.max(anchor, focus)
  const slice = words.slice(from, to + 1)
  if (slice.length === 0) return null

  let end = slice[0].end
  for (const word of slice) end = Math.max(end, word.end)

  return {
    start: slice[0].start,
    end,
    wordIds: slice.map((word) => word.id),
    text: slice.map((word) => word.text).join(' ')
  }
}

export interface MarkRange {
  start: number
  end: number
  wordIds: number[]
}

export function wordsInRange(words: Word[], start: number, end: number): number[] {
  // Touching boundaries are not an overlap: the previous word ends exactly
  // where the next begins, so inclusive checks would select both.
  const epsilon = 1e-6
  return words
    .filter((word) => word.end > start + epsilon && word.start < end - epsilon)
    .map((word) => word.id)
}

/**
 * A manual mark must use the selected words' exact boundaries. The old
 * implementation used the playhead position, which lags behind the click that
 * seeks the video and produced marks slightly beside the selected word.
 */
export function markRangeForSelection(
  words: Word[],
  selection: WordSelection | null,
  fallbackStart: number,
  duration: number
): MarkRange {
  const selected = rangeForSelection(words, selection)
  if (selected) {
    return {
      start: selected.start,
      end: Math.max(selected.start + 0.05, selected.end),
      wordIds: selected.wordIds
    }
  }

  const maxStart = Math.max(0, duration - 0.2)
  const start = clamp(fallbackStart, 0, maxStart)
  const end = Math.min(duration, start + 1.5)
  return { start, end, wordIds: wordsInRange(words, start, end) }
}

/** Nearest word by distance to its [start, end] interval, used for snapping. */
export function nearestWord(words: Word[], time: number): Word | null {
  let best: Word | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const word of words) {
    const distance =
      time < word.start ? word.start - time : time > word.end ? time - word.end : 0
    if (distance < bestDistance) {
      bestDistance = distance
      best = word
    }
  }
  return best
}

/**
 * Defects touched by the current word selection. Used to review several words
 * (and therefore several defects) in one action, both in the transcript and on
 * the timeline.
 */
export function defectIdsForSelection(
  defects: Defect[],
  words: Word[],
  selection: WordSelection | null
): string[] {
  const range = rangeForSelection(words, selection)
  if (!range) return []
  const selected = new Set(range.wordIds)
  return defects
    .filter(
      (defect) =>
        !defect.dismissed && defect.wordIds.some((wordId) => selected.has(wordId))
    )
    .map((defect) => defect.id)
}
