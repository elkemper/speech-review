import type { Defect, PlaybackSettings, SkipPadding } from '@shared/types'

export interface SkipInterval {
  start: number
  end: number
}

export function isGroupedDefect(defect: Defect): boolean {
  return (defect.groupIds?.length ?? 0) > 1 || (defect.markIds?.length ?? 0) > 1
}

/**
 * Padding depends on the defect type: a pause usually needs none, while a
 * filler benefits from a short pre-roll. A logical group gets its own padding
 * so the outer edges of the group are padded once, not per member.
 */
export function paddingFor(defect: Defect, settings: PlaybackSettings): SkipPadding {
  if (isGroupedDefect(defect) && settings.groupPadding) return settings.groupPadding
  const typed = settings.paddingByType?.[defect.type]
  if (typed) return typed
  return { before: settings.skipBeforeSec, after: settings.skipAfterSec }
}

/**
 * Build playback-skip ranges. Padding keeps a little of the original pause on
 * both sides so cuts do not glue words together; overlapping ranges are merged
 * so a single jump never lands inside the next cut.
 *
 * Reviewed items are never skipped: once the user has approved a defect or a
 * manual mark, fast-forward should play through it normally.
 */
export function buildSkipIntervals(
  defects: Defect[],
  settings: PlaybackSettings,
  duration: number
): SkipInterval[] {
  if (!settings.skipEnabled || duration <= 0) return []
  const source =
    settings.skipScope === 'marks'
      ? defects.filter((defect) => defect.source === 'manual')
      : defects

  const padded = source
    .filter((defect) => !defect.reviewed)
    .map((defect) => {
      const padding = paddingFor(defect, settings)
      return {
        start: Math.max(0, defect.start - padding.before),
        end: Math.min(duration, defect.end + padding.after)
      }
    })
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
