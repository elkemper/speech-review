import type {
  Defect,
  DefectBoundsOverride,
  ManualMark,
  PlaybackSettings
} from './types'
import { buildManualDefects } from './defects'
import { pinCutFor } from './cuts'

/**
 * Keep the frozen cuts of confirmed manual marks across a regrouping.
 *
 * A mark or a logical group can be merged or split at any time, and both
 * operations drop the affected cut overrides because the fill changed. A
 * confirmed mark must not lose its frozen range just because the group around
 * it changed: this re-pins every confirmed manual defect among `affectedIds`
 * that has no override left, using the padding in effect right now.
 *
 * Only the affected ids are touched. Pinning is a decision made at confirmation
 * time, so a mark that was confirmed before this feature existed stays
 * unpinned and keeps following the padding.
 *
 * A hand-dragged range is never overwritten. Marks that were not confirmed are
 * left alone.
 */
export function reconcileManualPins(
  marks: ManualMark[],
  confirmedDefectIds: string[],
  overrides: Record<string, DefectBoundsOverride>,
  playback: PlaybackSettings,
  duration: number,
  affectedIds: Iterable<string>
): Record<string, DefectBoundsOverride> {
  const confirmed = new Set(confirmedDefectIds)
  const affected = new Set(affectedIds)
  const next = { ...overrides }
  // Manual defects need words only for their text; the cut uses start/end.
  for (const defect of buildManualDefects([], marks)) {
    if (!affected.has(defect.id)) continue
    if (!confirmed.has(defect.id) || next[defect.id]) continue
    const pinned = pinCutFor({ ...defect, confirmed: true } as Defect, playback, duration)
    if (pinned) next[defect.id] = pinned
  }
  return next
}
