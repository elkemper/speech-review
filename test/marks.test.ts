import { describe, expect, it } from 'vitest'
import {
  groupManualMarks,
  manualDefectIdForMark,
  markIdsForDefectId,
  mergeMarkNeighbours,
  reconcileReviewedIds,
  reviewIdForMark
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

describe('reviewed state when marks merge and split', () => {
  it('keeps a merged group reviewed only when every mark was reviewed', () => {
    const before = [mark('a', 1, 1.5), mark('b', 1.6, 2)]
    const merged = [
      { ...before[0], groupId: 'g' },
      { ...before[1], groupId: 'g' }
    ]

    expect(
      reconcileReviewedIds(before, merged, ['manual-a', 'manual-b'])
    ).toEqual(['manual-group-g'])

    expect(
      reconcileReviewedIds(before, merged, ['manual-a'])
    ).toEqual([])
  })

  it('drops stale single-mark ids and keeps automatic defect ids', () => {
    const before = [mark('a', 1, 1.5), mark('b', 1.6, 2)]
    const merged = [
      { ...before[0], groupId: 'g' },
      { ...before[1], groupId: 'g' }
    ]
    expect(
      reconcileReviewedIds(before, merged, ['pause-1', 'manual-a', 'manual-b'])
    ).toEqual(['pause-1', 'manual-group-g'])
  })

  it('marks every split part reviewed when the group was reviewed', () => {
    const before = [
      mark('a', 1, 1.5, { groupId: 'g' }),
      mark('b', 1.6, 2, { groupId: 'g' })
    ]
    const split = before.map((item) => ({ ...item, groupId: undefined }))
    expect(reconcileReviewedIds(before, split, ['manual-group-g'])).toEqual([
      'manual-a',
      'manual-b'
    ])
  })

  it('never marks a newly added mark as reviewed', () => {
    const before = [mark('a', 1, 1.5)]
    const after = [mark('a', 1, 1.5), mark('b', 3, 3.5)]
    expect(reconcileReviewedIds(before, after, ['manual-a'])).toEqual(['manual-a'])
    expect(reviewIdForMark(after[1])).toBe('manual-b')
  })
})
