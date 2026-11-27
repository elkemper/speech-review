import {
  manualDefectIdForMark,
  markIdsForDefectId,
  mergeMarkNeighbours,
  reconcileConfirmedIds
} from './marks'
import { reconcileManualPins } from './pinnedCuts'
import type { CutRange } from './cuts'
import type { ManualMark, PlaybackSettings, Project } from './types'

export interface ManualMarkInput {
  id: string
  start: number
  end: number
  wordIds: number[]
  note: string
  createdAt: string
}

export interface ManualMarkAddResult {
  project: Project
  activeDefectId: string
}

/**
 * Shared core for adding a manual mark. It reproduces the store's `addMark`
 * state transitions — merge with neighbours, drop the cut overrides of the
 * affected marks, reconcile confirmation and re-pin confirmed neighbours — and
 * additionally writes an optional note.
 *
 * `options.cut` stores an explicit cut override for the new mark. It is only
 * honoured when the mark stays on its own: a logical group's cut is the
 * group's boundary, so pinning the new range there would cut part of a group
 * and leave its other members marked but not cut.
 *
 * A non-empty note is stored on the logical defect and on every underlying
 * mark, exactly like `setNote`, so exports and reloads stay consistent.
 */
export function addManualMark(
  project: Project,
  input: ManualMarkInput,
  playback: PlaybackSettings,
  options: { cut?: CutRange } = {}
): ManualMarkAddResult {
  const mark: ManualMark = {
    id: input.id,
    type: 'manual',
    start: input.start,
    end: input.end,
    wordIds: [...input.wordIds],
    note: input.note,
    createdAt: input.createdAt
  }

  let marks = mergeMarkNeighbours([...project.marks, mark], [mark.id])
  const activeDefectId = manualDefectIdForMark(marks, mark.id) ?? `manual-${mark.id}`

  // Adding a mark can rebuild a logical group. The group's fill changed, so
  // every nested cut override is dropped and the cut is derived again. A
  // frozen (confirmed) cut is re-pinned by `reconcileManualPins` below.
  const cutOverrides = { ...(project.cutOverrides ?? {}) }
  const affectedMarkIds = markIdsForDefectId(activeDefectId, marks)
  for (const markId of affectedMarkIds) delete cutOverrides[`manual-${markId}`]
  for (const item of marks) {
    if (!affectedMarkIds.includes(item.id)) continue
    const previous = project.marks.find((candidate) => candidate.id === item.id)
    if (previous?.groupId) delete cutOverrides[`manual-group-${previous.groupId}`]
  }

  const confirmed = reconcileConfirmedIds(
    project.marks,
    marks,
    project.confirmedDefectIds
  )
  let overrides = reconcileManualPins(
    marks,
    confirmed,
    cutOverrides,
    playback,
    project.duration,
    affectedMarkIds.map((markId) => `manual-${markId}`).concat(activeDefectId)
  )

  const grouped = markIdsForDefectId(activeDefectId, marks).length > 1
  if (options.cut && !grouped) {
    overrides[activeDefectId] = { start: options.cut.start, end: options.cut.end }
  }

  let defectNotes = project.defectNotes
  if (input.note.trim()) {
    const noteMarkIds = new Set(markIdsForDefectId(activeDefectId, marks))
    defectNotes = { ...project.defectNotes, [activeDefectId]: input.note }
    marks = marks.map((item) =>
      noteMarkIds.has(item.id) ? { ...item, note: input.note } : item
    )
  }

  return {
    project: {
      ...project,
      marks,
      confirmedDefectIds: confirmed,
      cutOverrides: overrides,
      defectNotes
    },
    activeDefectId
  }
}
