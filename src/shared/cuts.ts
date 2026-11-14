import type {
  CutRange,
  Defect,
  DefectBoundsOverride,
  PlaybackSettings,
  SkipPadding
} from './types'
import { DEFAULT_PAUSE_KEEP_SEC } from './settings'

export type { CutRange }

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

function normalizeRange(start: number, end: number, duration: number): CutRange | null {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  const max = Math.max(0, Number.isFinite(duration) ? duration : 0)
  const from = Math.max(0, Math.min(start, end))
  const to = Math.min(max, Math.max(start, end))
  if (to <= from) return null
  return { start: from, end: to }
}

/**
 * Final cut range for one defect.
 *
 * An explicit `cutOverrides[id]` wins over every padding setting: the user
 * dragged the cut handle and expects that exact range. A derived cut applies
 * type padding and the pause keep; a derived pause cut shorter than
 * `MIN_PAUSE_CUT_SEC` is not performed at all.
 */
export function cutRangeFor(
  defect: Defect,
  settings: PlaybackSettings,
  duration: number,
  override?: DefectBoundsOverride | null
): CutRange | null {
  if (override) return normalizeRange(override.start, override.end, duration)

  const padding = paddingFor(defect, settings)
  const range = normalizeRange(
    defect.start - padding.before,
    defect.end + padding.after,
    duration
  )
  if (!range) return null
  if (isStandalonePause(defect) && range.end - range.start < MIN_PAUSE_CUT_SEC) {
    return null
  }
  return range
}

export function mergeRanges(ranges: CutRange[]): CutRange[] {
  const sorted = [...ranges]
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end))
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start)
  const merged: CutRange[] = []
  for (const item of sorted) {
    const last = merged[merged.length - 1]
    if (last && item.start <= last.end + 0.001) {
      last.end = Math.max(last.end, item.end)
    } else {
      merged.push({ ...item })
    }
  }
  return merged
}

/**
 * Every performed cut, independent of whether skip mode is on. This is the
 * single source for the timeline hatching, the mini timeline and video export.
 */
export function buildCutList(
  defects: Defect[],
  settings: PlaybackSettings,
  duration: number,
  overrides?: Record<string, DefectBoundsOverride>
): CutRange[] {
  if (duration <= 0) return []
  const ranges = defects
    .filter((defect) => !defect.dismissed)
    .map((defect) => cutRangeFor(defect, settings, duration, overrides?.[defect.id]))
    .filter((item): item is CutRange => item !== null)
  return mergeRanges(ranges)
}

/** Per-defect cut lookup for drawing. A missing or `null` value means no cut. */
export function buildCutMap(
  defects: Defect[],
  settings: PlaybackSettings,
  duration: number,
  overrides?: Record<string, DefectBoundsOverride>
): Map<string, CutRange | null> {
  const map = new Map<string, CutRange | null>()
  for (const defect of defects) {
    if (defect.dismissed) continue
    map.set(defect.id, cutRangeFor(defect, settings, duration, overrides?.[defect.id]))
  }
  return map
}

/**
 * Build playback-skip ranges. Skip mode is the only switch here; the cut list
 * itself is always computed so the UI can show what would be removed.
 */
export function buildSkipIntervals(
  defects: Defect[],
  settings: PlaybackSettings,
  duration: number,
  overrides?: Record<string, DefectBoundsOverride>
): CutRange[] {
  if (!settings.skipEnabled || duration <= 0) return []
  return buildCutList(defects, settings, duration, overrides)
}

export function intervalAt(intervals: CutRange[], time: number): CutRange | null {
  for (const interval of intervals) {
    if (time >= interval.start && time < interval.end) return interval
  }
  return null
}

/** Ranges that stay after removing every cut. Used by video export. */
export function complementRanges(cuts: CutRange[], duration: number): CutRange[] {
  if (!(duration > 0)) return []
  const merged = mergeRanges(cuts)
  const keep: CutRange[] = []
  let cursor = 0
  for (const cut of merged) {
    const start = Math.max(0, Math.min(duration, cut.start))
    const end = Math.max(0, Math.min(duration, cut.end))
    if (start > cursor + 0.001) keep.push({ start: cursor, end: start })
    cursor = Math.max(cursor, end)
  }
  if (cursor < duration - 0.001) keep.push({ start: cursor, end: duration })
  return keep
}

/**
 * Split a range around holes. Used to keep the waveform visible inside the
 * kept room tone: the defect fill is drawn only outside `holes`, so the track
 * background and the waveform show through the neutral hatch.
 */
export function subtractRanges(range: CutRange, holes: CutRange[]): CutRange[] {
  const start = Math.min(range.start, range.end)
  const end = Math.max(range.start, range.end)
  const parts: CutRange[] = []
  let cursor = start
  for (const hole of mergeRanges(holes)) {
    if (hole.end <= start || hole.start >= end) continue
    const holeStart = Math.max(start, hole.start)
    const holeEnd = Math.min(end, hole.end)
    if (holeStart > cursor + 1e-6) parts.push({ start: cursor, end: holeStart })
    cursor = Math.max(cursor, holeEnd)
  }
  if (cursor < end - 1e-6) parts.push({ start: cursor, end })
  return parts
}

export interface CutView {
  /** Original defect span: the fill. */
  defect: CutRange
  /** Final cut span: the handles. `null` when the defect is not cut. */
  cut: CutRange | null
  /** Parts of the cut outside the defect: padding. */
  outer: CutRange[]
  /** Parts of the defect outside the cut: kept room tone. */
  inner: CutRange[]
}

/**
 * Split a defect into the original fill, the final cut and the two hatching
 * zones. `outer` is cut padding, `inner` is the part of the defect that is
 * deliberately kept (dimmed in the UI).
 */
export function cutView(
  defect: { start: number; end: number },
  cut: CutRange | null
): CutView {
  const fill: CutRange = {
    start: Math.min(defect.start, defect.end),
    end: Math.max(defect.start, defect.end)
  }
  if (!cut) return { defect: fill, cut: null, outer: [], inner: [] }

  const cutStart = Math.min(cut.start, cut.end)
  const cutEnd = Math.max(cut.start, cut.end)
  const outer: CutRange[] = []
  const inner: CutRange[] = []

  if (cutStart < fill.start) {
    outer.push({ start: cutStart, end: Math.min(cutEnd, fill.start) })
  }
  if (cutEnd > fill.end) {
    outer.push({ start: Math.max(cutStart, fill.end), end: cutEnd })
  }
  if (cutStart > fill.start) {
    inner.push({ start: fill.start, end: Math.min(cutStart, fill.end) })
  }
  if (cutEnd < fill.end) {
    inner.push({ start: Math.max(cutEnd, fill.start), end: fill.end })
  }

  return {
    defect: fill,
    cut: { start: cutStart, end: cutEnd },
    outer: outer.filter((item) => item.end > item.start),
    inner: inner.filter((item) => item.end > item.start)
  }
}
