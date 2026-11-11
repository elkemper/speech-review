import type { Defect, ManualMark, PlaybackSettings } from '@shared/types'

export interface SkipInterval {
  start: number
  end: number
}

/**
 * Build playback-skip ranges. Padding keeps a little of the original pause on
 * both sides so cuts do not glue words together; overlapping ranges are merged
 * so a single jump never lands inside the next cut.
 */
export function buildSkipIntervals(
  defects: Defect[],
  marks: ManualMark[],
  settings: PlaybackSettings,
  duration: number
): SkipInterval[] {
  if (!settings.skipEnabled || duration <= 0) return []
  const source =
    settings.skipScope === 'marks'
      ? marks.map((mark) => ({ start: mark.start, end: mark.end }))
      : defects.map((defect) => ({ start: defect.start, end: defect.end }))

  const padded = source
    .map((item) => ({
      start: Math.max(0, item.start - settings.skipBeforeSec),
      end: Math.min(duration, item.end + settings.skipAfterSec)
    }))
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start)

  const merged: SkipInterval[] = []
  for (const item of padded) {
    const last = merged[merged.length - 1]
    if (last && item.start <= last.end + 0.001) {
      last.end = Math.max(last.end, item.end)
    } else {
      merged.push({ ...item })
    }
  }
  return merged
}

export function intervalAt(intervals: SkipInterval[], time: number): SkipInterval | null {
  for (const interval of intervals) {
    if (time >= interval.start && time < interval.end) return interval
  }
  return null
}
