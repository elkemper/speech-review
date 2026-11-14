import { describe, expect, it } from 'vitest'
import {
  groupManualMarks,
  manualDefectIdForMark,
  markIdsForDefectId,
  mergeMarkNeighbours,
  mergeMarksAtSpan,
  reconcileConfirmedIds,
  confirmIdForMark
} from '../src/shared/marks'
import type { ManualMark } from '../src/shared/types'

function mark(
  id: string,
  start: number,
  end: number,
  options: Partial<ManualMark> = {}
): ManualMark {
  return {
    id,
    type: 'manual',
    start,
    end,
    wordIds: [Number(id.replace(/\D/g, '')) || 0],
    note: '',
    createdAt: new Date(0).toISOString(),
    ...options
  }
}

describe('logical manual marks', () => {
  it('merges a mark added between two adjacent marks', () => {
    const marks = mergeMarkNeighbours(
      [mark('a', 1, 1.5), mark('b', 1.85, 2.3), mark('c', 1.55, 1.8)],
      ['c'],
      { createGroupId: () => 'group-1' }
    )
    expect(new Set(marks.map((item) => item.groupId))).toEqual(new Set(['group-1']))
    expect(groupManualMarks(marks)).toHaveLength(1)
    expect(manualDefectIdForMark(marks, 'c')).toBe('manual-group-group-1')
  })

  it('merges groups when a moved boundary starts touching another mark', () => {
    const marks = mergeMarkNeighbours(
      [
        mark('a', 1, 2, { groupId: 'left' }),
        mark('b', 2.05, 2.5, { groupId: 'right' })
      ],
      ['b'],
      { createGroupId: () => 'unused' }
    )
    const groups = groupManualMarks(marks)
    expect(groups).toHaveLength(1)
    expect(groups[0].groupId).toBe('left')
    expect(groups[0].marks).toHaveLength(2)
  })

  it('splits a mark out when it is moved away from its group', () => {
    const marks = mergeMarkNeighbours(
      [
        mark('a', 1, 2, { groupId: 'g' }),
        mark('b', 2.6, 3, { groupId: 'g' })
      ],
      ['b']
    )
    const moved = marks.find((item) => item.id === 'b')
    expect(moved?.groupId).toBeUndefined()
    expect(groupManualMarks(marks)).toHaveLength(2)
  })

  it('resolves a logical defect id back to all underlying marks', () => {
    const marks = [
      mark('a', 1, 1.5, { groupId: 'g' }),
      mark('b', 1.6, 2, { groupId: 'g' }),
      mark('c', 5, 6)
    ]
    expect(markIdsForDefectId('manual-group-g', marks)).toEqual(['a', 'b'])
    expect(markIdsForDefectId('manual-c', marks)).toEqual(['c'])
  })

  it('combines bounds, words and notes for a logical mark', () => {
    const groups = groupManualMarks([
      mark('a', 1, 1.5, { groupId: 'g', wordIds: [1, 2], note: 'первая' }),
      mark('b', 1.7, 2.2, { groupId: 'g', wordIds: [3], note: 'вторая' })
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      start: 1,
      end: 2.2,
      wordIds: [1, 2, 3],
      note: 'первая · вторая'
    })
  })
})

describe('confirmed state when marks merge and split', () => {
  it('keeps a merged group confirmed only when every mark was confirmed', () => {
    const before = [mark('a', 1, 1.5), mark('b', 1.6, 2)]
    const merged = [
      { ...before[0], groupId: 'g' },
      { ...before[1], groupId: 'g' }
    ]

    expect(
      reconcileConfirmedIds(before, merged, ['manual-a', 'manual-b'])
    ).toEqual(['manual-group-g'])

    expect(
      reconcileConfirmedIds(before, merged, ['manual-a'])
    ).toEqual([])
  })

  it('drops stale single-mark ids and keeps automatic defect ids', () => {
    const before = [mark('a', 1, 1.5), mark('b', 1.6, 2)]
    const merged = [
      { ...before[0], groupId: 'g' },
      { ...before[1], groupId: 'g' }
    ]
    expect(
      reconcileConfirmedIds(before, merged, ['pause-1', 'manual-a', 'manual-b'])
    ).toEqual(['pause-1', 'manual-group-g'])
  })

  it('confirms every split part when the group was confirmed', () => {
    const before = [
      mark('a', 1, 1.5, { groupId: 'g' }),
      mark('b', 1.6, 2, { groupId: 'g' })
    ]
    const split = before.map((item) => ({ ...item, groupId: undefined }))
    expect(reconcileConfirmedIds(before, split, ['manual-group-g'])).toEqual([
      'manual-a',
      'manual-b'
    ])
  })

  it('never confirms a newly added mark', () => {
    const before = [mark('a', 1, 1.5)]
    const after = [mark('a', 1, 1.5), mark('b', 3, 3.5)]
    expect(reconcileConfirmedIds(before, after, ['manual-a'])).toEqual(['manual-a'])
    expect(confirmIdForMark(after[1])).toBe('manual-b')
  })
})

describe('capturing neighbours with a cut handle', () => {
  it('groups a neighbour when the cut span reaches it and keeps original bounds', () => {
    const marks = [mark('a', 1, 1.5), mark('b', 2, 2.5)]
    const result = mergeMarksAtSpan(marks, 'a', { start: 1, end: 1.9 }, {
      createGroupId: () => 'g'
    })
    expect(result.activeDefectId).toBe('manual-group-g')
    expect(result.affectedMarkIds.sort()).toEqual(['a', 'b'])
    expect(result.affectedGroupIds).toEqual([])
    expect(result.marks.find((item) => item.id === 'a')).toMatchObject({
      start: 1,
      end: 1.5,
      groupId: 'g'
    })
    expect(result.marks.find((item) => item.id === 'b')).toMatchObject({
      start: 2,
      end: 2.5,
      groupId: 'g'
    })
  })

  it('does not group when the cut span stays short', () => {
    const marks = [mark('a', 1, 1.5), mark('b', 2, 2.5)]
    const result = mergeMarksAtSpan(marks, 'a', { start: 1, end: 1.7 })
    expect(result.activeDefectId).toBe('manual-a')
    expect(result.affectedMarkIds).toEqual(['a'])
    expect(result.affectedGroupIds).toEqual([])
    expect(result.marks.find((item) => item.id === 'a')?.groupId).toBeUndefined()
  })

  it('captures a whole existing group and reports its old id', () => {
    const marks = [
      mark('a', 1, 1.5),
      mark('b', 2, 2.5, { groupId: 'old' }),
      mark('c', 2.6, 3, { groupId: 'old' })
    ]
    const result = mergeMarksAtSpan(marks, 'a', { start: 1, end: 2.1 })
    expect(result.activeDefectId).toBe('manual-group-old')
    expect(result.affectedMarkIds.sort()).toEqual(['a', 'b', 'c'])
    expect(result.affectedGroupIds).toEqual(['old'])
  })
})

describe('edge-specific cut capture', () => {
  it('captures only on the dragged edge', () => {
    const marks = [mark('a', 1, 1.5), mark('b', 2, 2.5)]
    const byEnd = mergeMarksAtSpan(
      marks,
      'a',
      { start: 0.85, end: 1.9 },
      { edge: 'end', createGroupId: () => 'g' }
    )
    expect(byEnd.activeDefectId).toBe('manual-group-g')

    const byStart = mergeMarksAtSpan(
      marks,
      'a',
      { start: 1, end: 1.9 },
      { edge: 'start', createGroupId: () => 'g' }
    )
    expect(byStart.activeDefectId).toBe('manual-a')
  })

  it('captures a left neighbour from the start edge', () => {
    const marks = [mark('a', 2, 2.5), mark('b', 1, 1.5)]
    const byStart = mergeMarksAtSpan(
      marks,
      'a',
      { start: 1.6, end: 2.5 },
      { edge: 'start', createGroupId: () => 'g' }
    )
    expect(byStart.activeDefectId).toBe('manual-group-g')

    const byEnd = mergeMarksAtSpan(
      marks,
      'a',
      { start: 1.6, end: 2.5 },
      { edge: 'end', createGroupId: () => 'g' }
    )
    expect(byEnd.activeDefectId).toBe('manual-a')
  })
})
