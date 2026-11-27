import { describe, expect, it } from 'vitest'
import { addManualMark } from '../src/shared/manualMarkAdd'
import { DEFAULT_RULES } from '../src/shared/defects'
import { DEFAULT_SETTINGS } from '../src/shared/settings'
import type { ManualMark, Project } from '../src/shared/types'

const playback = DEFAULT_SETTINGS.playback

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p',
    name: 'Demo',
    video: { path: '/v.mp4', name: 'v.mp4', size: 1, mtimeMs: 1 },
    duration: 60,
    language: 'ru',
    modelId: 'q8_0',
    backend: 'metal',
    createdAt: '',
    updatedAt: '',
    marks: [],
    rules: DEFAULT_RULES,
    cutOverrides: {},
    confirmedDefectIds: [],
    dismissedDefectIds: [],
    dismissedMarks: [],
    defectNotes: {},
    bookmarks: [],
    transcriptComplete: true,
    ...overrides
  }
}

function mark(id: string, start: number, end: number, options: Partial<ManualMark> = {}): ManualMark {
  return {
    id,
    type: 'manual',
    start,
    end,
    wordIds: [1],
    note: '',
    createdAt: new Date(0).toISOString(),
    ...options
  }
}

function input(id: string, start: number, end: number, note = '', wordIds = [1]) {
  return { id, start, end, wordIds, note, createdAt: new Date(0).toISOString() }
}

describe('addManualMark', () => {
  it('adds a standalone mark and writes the note to both stores', () => {
    const before = project()
    const result = addManualMark(before, input('m1', 5, 6, 'важно'), playback)
    const added = result.project.marks[0]

    expect(result.activeDefectId).toBe('manual-m1')
    expect(added).toMatchObject({ id: 'm1', start: 5, end: 6, note: 'важно' })
    expect(result.project.defectNotes).toEqual({ 'manual-m1': 'важно' })
    expect(result.project.cutOverrides).toEqual({})
    // The original project is never mutated.
    expect(before.marks).toEqual([])
    expect(before.defectNotes).toEqual({})
  })

  it('writes the exact cut when asked for a standalone mark', () => {
    const result = addManualMark(project(), input('m1', 5, 6), playback, {
      cut: { start: 4.5, end: 6.5 }
    })
    expect(result.project.cutOverrides['manual-m1']).toEqual({ start: 4.5, end: 6.5 })
  })

  it('keeps an empty note out of the note map and the mark', () => {
    const result = addManualMark(project(), input('m1', 5, 6, ''), playback)
    expect(result.project.defectNotes).toEqual({})
    expect(result.project.marks[0].note).toBe('')
  })

  it('merges a touching mark into a logical group and skips the exact cut', () => {
    const before = project({ marks: [mark('a', 1, 2)] })
    const result = addManualMark(before, input('b', 2.1, 3, 'общее'), playback, {
      cut: { start: 2.1, end: 3 }
    })

    expect(result.activeDefectId.startsWith('manual-group-')).toBe(true)
    expect(result.project.marks).toHaveLength(2)
    expect(result.project.marks.every((item) => item.groupId)).toBe(true)
    expect(result.project.marks.every((item) => item.note === 'общее')).toBe(true)
    expect(result.project.defectNotes).toEqual({ [result.activeDefectId]: 'общее' })
    // A group's cut follows its padding; pinning only the typed range would
    // leave the captured neighbour marked but not cut.
    expect(result.project.cutOverrides[result.activeDefectId]).toBeUndefined()
  })

  it('does not confirm a new mark merged next to a confirmed one', () => {
    const before = project({
      marks: [mark('a', 1, 2)],
      confirmedDefectIds: ['auto-filler-w1', 'manual-a']
    })
    const result = addManualMark(before, input('b', 2.1, 3), playback)
    expect(result.project.confirmedDefectIds).toEqual(['auto-filler-w1'])
  })

  it('drops the frozen cut of a group that gained an unconfirmed mark', () => {
    const before = project({
      marks: [
        mark('a', 1, 1.5, { groupId: 'g' }),
        mark('b', 1.6, 2, { groupId: 'g' })
      ],
      confirmedDefectIds: ['manual-group-g'],
      cutOverrides: {
        'manual-group-g': { start: 1, end: 2, pinned: true }
      }
    })
    const result = addManualMark(before, input('c', 2.1, 2.6), playback)

    expect(result.activeDefectId).toBe('manual-group-g')
    expect(result.project.marks).toHaveLength(3)
    expect(result.project.confirmedDefectIds).toEqual([])
    // The fill changed and the group is no longer confirmed, so nothing is
    // re-pinned and the stale override is gone.
    expect(result.project.cutOverrides['manual-group-g']).toBeUndefined()
  })
})
