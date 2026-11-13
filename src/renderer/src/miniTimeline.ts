import { clamp } from '@shared/format'

export interface MiniWindow {
  start: number
  end: number
}

/** Minimum context shown around the selected defect. */
export const MINI_WINDOW_MIN_SPAN_SEC = 1
/** Default context on each side of the defect; configurable in settings. */
export const DEFAULT_MINI_TIMELINE_PAD_SEC = 3
/** The default snippet is fully zoomed out; 4× is the closest view. */
export const MINI_ZOOM_MIN = 1
export const MINI_ZOOM_MAX = 4

/**
 * Window of the recording shown under a selected defect in the right panel.
 * It always contains the defect and expands to a comfortable minimum span so
 * both boundary handles can be dragged without hitting the canvas edge.
 */
export function miniWindowForDefect(
  defectStart: number,
  defectEnd: number,
  duration: number,
  padSec = DEFAULT_MINI_TIMELINE_PAD_SEC
): MiniWindow {
  const total = Math.max(0, duration)
  const start = Math.max(0, Math.min(defectStart, defectEnd))
  const end = Math.min(total, Math.max(defectStart, defectEnd))
  const pad = Math.max(0, Number.isFinite(padSec) ? padSec : DEFAULT_MINI_TIMELINE_PAD_SEC)

  let left = Math.max(0, start - pad)
  let right = Math.min(total, end + pad)

  const minSpan = Math.min(total, MINI_WINDOW_MIN_SPAN_SEC)
  if (right - left < minSpan) {
    const center = (start + end) / 2
    left = center - minSpan / 2
    right = center + minSpan / 2
    if (left < 0) {
      right -= left
      left = 0
    }
    if (right > total) {
      left -= right - total
      right = total
      left = Math.max(0, left)
    }
  }

  if (right <= left) return { start: 0, end: Math.max(0.1, total) }
  return { start: left, end: right }
}

export function miniXForTime(time: number, view: MiniWindow, width: number): number {
  const span = Math.max(1e-6, view.end - view.start)
  return ((time - view.start) / span) * width
}

export function miniTimeForX(x: number, view: MiniWindow, width: number): number {
  const span = Math.max(1e-6, view.end - view.start)
  return view.start + clamp(x / Math.max(1, width), 0, 1) * span
}

export function clampMiniZoom(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(MINI_ZOOM_MAX, Math.max(MINI_ZOOM_MIN, value))
}

/**
 * Scale the visible window by `factor` around `anchorTime`, staying inside
 * `bounds` (the default snippet window). `factor > 1` zooms in; at 1× the whole
 * bounds window is visible and panning is impossible.
 */
export function zoomMiniWindow(
  view: MiniWindow,
  factor: number,
  anchorTime: number,
  bounds: MiniWindow
): MiniWindow {
  const boundsSpan = Math.max(0.02, bounds.end - bounds.start)
  if (boundsSpan <= 0.02) return { ...bounds }
  const sourceSpan = Math.max(0.02, view.end - view.start)
  const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1
  const span = Math.min(boundsSpan, Math.max(0.02, sourceSpan / safeFactor))
  const ratio = clamp((anchorTime - view.start) / sourceSpan, 0, 1)

  const start = clamp(anchorTime - ratio * span, bounds.start, bounds.end - span)
  return { start, end: start + span }
}

/** Move the zoomed window inside its bounds; no-op when it already fills them. */
export function panMiniWindow(
  view: MiniWindow,
  deltaSec: number,
  bounds: MiniWindow
): MiniWindow {
  const boundsSpan = Math.max(0.02, bounds.end - bounds.start)
  const span = Math.min(boundsSpan, Math.max(0.02, view.end - view.start))
  if (span >= boundsSpan - 1e-9) return { start: bounds.start, end: bounds.end }
  const start = clamp(view.start + deltaSec, bounds.start, bounds.end - span)
  return { start, end: start + span }
}

/** Fraction of the default window currently visible; 1 means fully zoomed out. */
export function miniVisibleFraction(view: MiniWindow, bounds: MiniWindow): number {
  const boundsSpan = Math.max(1e-6, bounds.end - bounds.start)
  return clamp((view.end - view.start) / boundsSpan, 0, 1)
}

/**
 * Which boundary handle is under the pointer, if any. Used by the mini
 * timeline so a click near an edge grabs it instead of seeking.
 */
export function miniEdgeAt(
  x: number,
  defectStart: number,
  defectEnd: number,
  view: MiniWindow,
  width: number,
  tolerancePx = 8
): 'start' | 'end' | null {
  const startX = miniXForTime(defectStart, view, width)
  const endX = miniXForTime(defectEnd, view, width)
  const startDistance = Math.abs(x - startX)
  const endDistance = Math.abs(x - endX)
  const best = Math.min(startDistance, endDistance)
  if (best > tolerancePx) return null
  return startDistance <= endDistance ? 'start' : 'end'
}