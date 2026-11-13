import type { Defect, PlaybackSettings, SkipPadding } from '@shared/types'
import { DEFAULT_PAUSE_KEEP_SEC } from '@shared/settings'

export interface SkipInterval {
  start: number
  end: number
}

export function isGroupedDefect(defect: Defect): boolean {
  return (defect.groupIds?.length ?? 0) > 1 || (defect.markIds?.length ?? 0) > 1
}

/** A jump shorter than this is more noticeable than the pause it removes. */
export const MIN_PAUSE_CUT_SEC = 0.2

function isStandalonePause(defect: Defect): boolean {
  return defect.type === 'pause' && !isGroupedDefect(defect)
}

/**
 * Padding depends on the defect type: a pause keeps a fixed amount of room
 * tone, while a filler benefits from a short pre-roll. The pause keep is
 * expressed as negative padding because it shrinks the cut, and the type
 * padding still applies on top: a positive padding widens the cut into the
 * kept silence. A logical group gets its own padding so the outer edges of the
 * group are padded once, not per member.
 */
export function paddingFor(defect: Defect, settings: PlaybackSettings): SkipPadding {
  if (isGroupedDefect(defect) && settings.groupPadding) return settings.groupPadding
  const typed = settings.paddingByType?.[defect.type]
  const base = typed ?? { before: settings.skipBeforeSec, after: settings.skipAfterSec }
  if (!isStandalonePause(defect)) return base
  // Legacy settings can reach the renderer without the new field (for example
  // while the main process is still running an older build). Fall back to the
  // default instead of producing NaN intervals, which would silently stop
  // skipping pauses.
  const keepSec = Number.isFinite(settings.pauseKeepSec)
    ? settings.pauseKeepSec
    : DEFAULT_PAUSE_KEEP_SEC
  const half = Math.max(0, keepSec) / 2
  return { before: base.before - half, after: base.after - half }
}

function intervalFor(
  defect: Defect,
  settings: PlaybackSettings,
  duration: number
): SkipInterval | null {
  const padding = paddingFor(defect, settings)
  const start = Math.max(0, defect.start - padding.before)
  const end = Math.min(duration, defect.end + padding.after)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (end <= start) return null
  // Keep a very short pause untouched instead of making a stuttering jump.
  if (isStandalonePause(defect) && end - start < MIN_PAUSE_CUT_SEC) return null
  return { start, end }
}

/**
 * Build playback-skip ranges. Padding keeps a little of the original pause on
 * both sides so cuts do not glue words together; overlapping ranges are merged
 * so a single jump never lands inside the next cut.
 *
 * Skip mode cuts every defect and manual mark except items the user deleted.
 * Confirmation is a review marker and does not affect playback.
 */
export function buildSkipIntervals(
  defects: Defect[],
  settings: PlaybackSettings,
  duration: number
): SkipInterval[] {
  if (!settings.skipEnabled || duration <= 0) return []

  const padded = defects
    .filter((defect) => !defect.dismissed)
    .map((defect) => intervalFor(defect, settings, duration))
    .filter((item): item is SkipInterval => item !== null)
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
