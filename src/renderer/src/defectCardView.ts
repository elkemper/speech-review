import type { Defect } from '@shared/types'

export type DefectCardMode = 'pending' | 'confirmed' | 'dismissed'

export interface DefectCardView {
  mode: DefectCardMode
  /** One-line row without the body. */
  compact: boolean
  /** Text, note, mini-timeline and card actions are visible. */
  fullBody: boolean
  /** Left delete/confirm rail on a pending card. */
  showRail: boolean
  /** Right-side undo button on a confirmed or deleted card. */
  showUndo: boolean
  /** Automatic group marker, kept in skip mode too. */
  showGroupBadge: boolean
  /** Manual-source marker; hidden in skip mode to reduce noise. */
  showManualBadge: boolean
  /** Logical manual-mark marker; hidden in skip mode. */
  showLogicalBadge: boolean
  /** Split action for a logical manual mark; hidden in skip mode. */
  showSplit: boolean
}

/**
 * Derived presentation state for one defect card.
 *
 * Confirmation and deletion collapse the card in every playback mode. Skip
 * mode only hides the extra manual badges; it never expands a compact card.
 * The automatic group marker is independent of skip mode.
 */
export function defectCardView(defect: Defect, skipEnabled: boolean): DefectCardView {
  const mode: DefectCardMode = defect.dismissed
    ? 'dismissed'
    : defect.confirmed
      ? 'confirmed'
      : 'pending'
  const pending = mode === 'pending'
  const manualMark = defect.source === 'manual'
  const logicalMark = (defect.markIds?.length ?? 0) > 1

  return {
    mode,
    compact: !pending,
    fullBody: pending,
    showRail: pending,
    showUndo: !pending,
    showGroupBadge: pending && (defect.groupIds?.length ?? 0) > 1,
    showManualBadge: pending && !skipEnabled && manualMark,
    showLogicalBadge: pending && !skipEnabled && logicalMark,
    showSplit: pending && !skipEnabled && manualMark && logicalMark
  }
}
