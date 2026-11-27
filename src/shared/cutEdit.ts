import { cutRangeFor } from './cuts'
import type { Defect, DefectBoundsOverride, PlaybackSettings } from './types'

/** Which edge of a cut a table cell edits. `duration` keeps the start. */
export type CutEdge = 'start' | 'end' | 'duration'

export interface CutEditRange {
  start: number
  end: number
}

/** Matches the minimum a cut can be shortened to by the timeline handles. */
export const MIN_CUT_EDIT_SEC = 0.05

/**
 * Resolves the cut bounds after a time cell edit.
 *
 * `bounds` is the row's current cut, or `null` when the row is not cut (for
 * example a pause shorter than the kept room tone). Without a cut, the other
 * edge comes from the defect's own bounds, so typing a start creates a cut
 * from that start to the end of the defect.
 *
 * Returns `null` for input that cannot become a valid cut: a non-finite or
 * negative value, a value outside the recording, an inverted range or a range
 * shorter than `MIN_CUT_EDIT_SEC`. Callers show an error instead of silently
 * clamping, because a clamped value is not what the user typed.
 */
export function cutEditForBounds(
  bounds: CutEditRange | null,
  defectBounds: CutEditRange,
  edge: CutEdge,
  value: number,
  duration: number
): CutEditRange | null {
  const max = Math.max(0, Number.isFinite(duration) ? duration : 0)
  if (max <= 0) return null
  if (!Number.isFinite(value) || value < 0 || value > max) return null

  let start = bounds ? bounds.start : defectBounds.start
  let end = bounds ? bounds.end : defectBounds.end

  if (!bounds) {
    if (edge === 'start') {
      start = value
      end = Math.max(value, Math.min(defectBounds.end, max))
    } else if (edge === 'end') {
      end = value
      start = Math.min(defectBounds.start, value)
    } else {
      start = Math.min(defectBounds.start, max)
      end = start + value
    }
  } else if (edge === 'start') {
    start = value
  } else if (edge === 'end') {
    end = value
  } else {
    end = start + value
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start < 0 || end > max + 1e-9) return null
  if (end - start < MIN_CUT_EDIT_SEC) return null
  return { start, end }
}

/**
 * The cut edge a table edit actually moves. `duration` keeps the start fixed,
 * so only the end may capture a neighbouring mark while grouping.
 */
export function movedCutEdge(edge: CutEdge): 'start' | 'end' {
  return edge === 'start' ? 'start' : 'end'
}

/** Same edit resolved from the defect's actual final cut. */
export function cutEditFor(
  defect: Defect,
  settings: PlaybackSettings,
  duration: number,
  override: DefectBoundsOverride | null | undefined,
  edge: CutEdge,
  value: number
): CutEditRange | null {
  const cut = cutRangeFor(defect, settings, duration, override)
  return cutEditForBounds(
    cut,
    { start: defect.start, end: defect.end },
    edge,
    value,
    duration
  )
}
