import { describe, expect, it } from 'vitest'
import {
  applyEditable,
  canRedo,
  canUndo,
  createHistoryState,
  makeHistoryEntry,
  recordHistory,
  snapshotEditable,
  stateForHistoryIndex,
  withHistoryIndex,
  type EditableProjectState
} from '../src/renderer/src/history'
import type { Project } from '../src/shared/types'

function state(value: string): EditableProjectState {
  return {
    marks: [],
    confirmedDefectIds: [value],
    dismissedDefectIds: [],
    dismissedMarks: [],
    defectNotes: {},
    defectOverrides: {}
  }
}

function entry(label: string, before: string, after: string, at: string, mergeKey?: string) {
  return makeHistoryEntry(label, state(before), state(after), {
    id: label,
    at,
    ...(mergeKey ? { mergeKey } : {})
  })
}

describe('action history', () => {
  it('undoes and redoes entries by index', () => {
    let history = createHistoryState()
    history = recordHistory(history, entry('one', 'base', 'a', '2026-01-01T00:00:00.000Z'))
    history = recordHistory(history, entry('two', 'a', 'b', '2026-01-01T00:00:01.000Z'))

    expect(canUndo(history)).toBe(true)
    expect(canRedo(history)).toBe(false)
    expect(history.index).toBe(1)

    history = withHistoryIndex(history, 0)
    expect(stateForHistoryIndex(history, history.index)?.confirmedDefectIds).toEqual(['a'])

    history = withHistoryIndex(history, -1)
    expect(stateForHistoryIndex(history, -1)?.confirmedDefectIds).toEqual(['base'])
    expect(canUndo(history)).toBe(false)
    expect(canRedo(history)).toBe(true)
  })

  it('drops the redo branch when a new action follows an undo', () => {
    let history = createHistoryState()
    history = recordHistory(history, entry('one', 'base', 'a', '2026-01-01T00:00:00.000Z'))
    history = recordHistory(history, entry('two', 'a', 'b', '2026-01-01T00:00:01.000Z'))
    history = withHistoryIndex(history, 0)
    history = recordHistory(history, entry('three', 'a', 'c', '2026-01-01T00:00:02.000Z'))

    expect(history.entries.map((item) => item.id)).toEqual(['one', 'three'])
    expect(history.index).toBe(1)
    expect(canRedo(history)).toBe(false)
  })

  it('coalesces rapid edits with the same merge key', () => {
    let history = createHistoryState()
    history = recordHistory(
      history,
      entry('note', 'base', 'a', '2026-01-01T00:00:00.000Z', 'note:1'),
      Date.parse('2026-01-01T00:00:00.000Z')
    )
    history = recordHistory(
      history,
      entry('note', 'a', 'ab', '2026-01-01T00:00:01.000Z', 'note:1'),
      Date.parse('2026-01-01T00:00:01.000Z')
    )

    expect(history.entries).toHaveLength(1)
    expect(history.entries[0].before.confirmedDefectIds).toEqual(['base'])
    expect(history.entries[0].after.confirmedDefectIds).toEqual(['ab'])
  })

  it('keeps separate entries for different merge keys', () => {
    let history = createHistoryState()
    history = recordHistory(
      history,
      entry('note 1', 'base', 'a', '2026-01-01T00:00:00.000Z', 'note:1'),
      Date.parse('2026-01-01T00:00:00.000Z')
    )
    history = recordHistory(
      history,
      entry('note 2', 'a', 'b', '2026-01-01T00:00:01.000Z', 'note:2'),
      Date.parse('2026-01-01T00:00:01.000Z')
    )
    expect(history.entries).toHaveLength(2)
  })

  it('snapshots and restores the deleted-marks archive', () => {
    const mark = {
      id: 'm1',
      type: 'manual' as const,
      start: 1,
      end: 2,
      wordIds: [3],
      note: 'ошибка',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    const project = {
      marks: [],
      confirmedDefectIds: [],
      dismissedDefectIds: ['auto-pause-0'],
      dismissedMarks: [mark],
      defectNotes: {},
      defectOverrides: {}
    } as unknown as Project

    const snapshot = snapshotEditable(project)
    expect(snapshot.dismissedMarks).toEqual([mark])
    expect(snapshot.dismissedMarks[0].wordIds).not.toBe(mark.wordIds)

    const restored = applyEditable(project, { ...state('x'), dismissedMarks: [mark] })
    expect(restored.dismissedMarks).toEqual([mark])
    expect(restored.dismissedMarks[0].wordIds).not.toBe(mark.wordIds)
  })
})
