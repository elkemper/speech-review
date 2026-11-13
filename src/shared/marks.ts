import type { ManualMark } from './types'

/** Adjacent marks with a gap up to this value form one logical mark. */
export const MARK_MERGE_GAP_SEC = 0.2

export interface ManualMarkGroup {
  key: string
  groupId: string | null
  marks: ManualMark[]
  start: number
  end: number
  wordIds: number[]
  note: string
}

function overlaps(a: ManualMark, b: ManualMark, gapSec: number): boolean {
  return a.start <= b.end + gapSec && b.start <= a.end + gapSec
}

/**
 * Groups marks by their persisted `groupId`. Grouping is explicit: it happens
 * when a mark is added or its boundary is moved, not on every render, so the
 * user can split a logical mark and keep it split.
 */
export function groupManualMarks(marks: ManualMark[]): ManualMarkGroup[] {
  const buckets = new Map<string, ManualMark[]>()
  for (const mark of marks) {
    const key = mark.groupId ? `group:${mark.groupId}` : `mark:${mark.id}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(mark)
    else buckets.set(key, [mark])
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => {
      const sorted = [...bucket].sort((a, b) => a.start - b.start)
      return {
        key,
        groupId: sorted.find((mark) => mark.groupId)?.groupId ?? null,
        marks: sorted,
        start: Math.min(...sorted.map((mark) => mark.start)),
        end: Math.max(...sorted.map((mark) => mark.end)),
        wordIds: [...new Set(sorted.flatMap((mark) => mark.wordIds ?? []))],
        note: sorted
          .map((mark) => mark.note.trim())
          .filter(Boolean)
          .join(' · ')
      }
    })
    .sort((a, b) => a.start - b.start)
}

export function manualDefectIdForMark(marks: ManualMark[], markId: string): string | null {
  const mark = marks.find((item) => item.id === markId)
  if (!mark) return null
  return mark.groupId ? `manual-group-${mark.groupId}` : `manual-${mark.id}`
}

/** Defect id used to store the confirmed flag for a single mark. */
export function confirmIdForMark(mark: ManualMark): string {
  return mark.groupId ? `manual-group-${mark.groupId}` : `manual-${mark.id}`
}

/**
 * Rebuild the confirmed ids for manual marks after they were added, merged,
 * split or moved.
 *
 * A logical mark counts as confirmed only when every mark inside it was
 * confirmed before the change. New marks are never confirmed. Confirmed ids of
 * automatic defects are left untouched. This also drops stale ids of marks
 * that were merged into a new group.
 */
export function reconcileConfirmedIds(
  before: ManualMark[],
  after: ManualMark[],
  confirmedIds: string[]
): string[] {
  const beforeById = new Map(before.map((mark) => [mark.id, mark]))
  const wasConfirmed = (mark: ManualMark): boolean => {
    const previous = beforeById.get(mark.id)
    if (!previous) return false
    return confirmedIds.includes(confirmIdForMark(previous))
  }

  const next = new Set(confirmedIds.filter((id) => !id.startsWith('manual-')))
  for (const group of groupManualMarks(after)) {
    if (group.marks.every(wasConfirmed)) next.add(confirmIdForMark(group.marks[0]))
  }
  return [...next]
}

export function markIdsForDefectId(defectId: string, marks: ManualMark[]): string[] {
  if (defectId.startsWith('manual-group-')) {
    const groupId = defectId.slice('manual-group-'.length)
    return marks.filter((mark) => mark.groupId === groupId).map((mark) => mark.id)
  }
  if (defectId.startsWith('manual-')) return [defectId.slice('manual-'.length)]
  return []
}

function createGroupId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  return `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Merges the changed marks with every mark they touch or overlap. If a changed
 * mark no longer touches its former group, it is split out of that group.
 *
 * This is intentionally limited to changed marks: two old adjacent marks that
 * the user explicitly split must not merge again until one of them is moved.
 */
export function mergeMarkNeighbours(
  marks: ManualMark[],
  changedIds: Iterable<string>,
  options: { gapSec?: number; createGroupId?: () => string } = {}
): ManualMark[] {
  const list = marks.map((mark) => ({
    ...mark,
    wordIds: mark.wordIds ? [...mark.wordIds] : undefined
  }))
  if (list.length === 0) return list

  const changed = new Set(changedIds)
  const gap = options.gapSec ?? MARK_MERGE_GAP_SEC
  const parent = list.map((_, index) => index)

  const find = (index: number): number => {
    let current = index
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]]
      current = parent[current]
    }
    return current
  }
  const union = (a: number, b: number): void => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent[rootB] = rootA
  }

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (overlaps(list[i], list[j], gap)) union(i, j)
    }
  }

  const components = new Map<number, number[]>()
  for (let i = 0; i < list.length; i++) {
    const root = find(i)
    const component = components.get(root)
    if (component) component.push(i)
    else components.set(root, [i])
  }

  const nextGroupId = options.createGroupId ?? createGroupId
  for (const indices of components.values()) {
    const component = indices.map((index) => list[index])
    const touched = component.some((mark) => changed.has(mark.id))

    if (component.length >= 2 && touched) {
      const groupId = component.find((mark) => mark.groupId)?.groupId ?? nextGroupId()
      for (const mark of component) mark.groupId = groupId
    } else if (component.length === 1 && touched) {
      // The changed mark moved away from the rest of its former group.
      component[0].groupId = undefined
    }
  }

  return list
}
