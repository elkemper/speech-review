import { cutRangeFor } from './cuts'
import type {
  Defect,
  DefectBoundsOverride,
  ExportDefect,
  PlaybackSettings
} from './types'

/** Rows that can reach the CSV/JSON/video export and the defect table. */
export function isExportableDefect(defect: Defect): boolean {
  return !defect.dismissed && !defect.candidate
}

/** Attach the final cut bounds to a defect, exactly as the CSV export sees it. */
export function toExportDefect(
  defect: Defect,
  settings: PlaybackSettings,
  duration: number,
  overrides?: Record<string, DefectBoundsOverride>
): ExportDefect {
  const cut = cutRangeFor(defect, settings, duration, overrides?.[defect.id])
  return {
    ...defect,
    cutStart: cut ? cut.start : null,
    cutEnd: cut ? cut.end : null
  }
}

/**
 * The exported view of the defect list: dismissed items and transient
 * candidates are excluded, and every row carries its final cut.
 */
export function toExportDefects(
  defects: Defect[],
  settings: PlaybackSettings,
  duration: number,
  overrides?: Record<string, DefectBoundsOverride>
): ExportDefect[] {
  return defects
    .filter(isExportableDefect)
    .map((defect) => toExportDefect(defect, settings, duration, overrides))
}
