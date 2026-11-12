import { describe, expect, it } from 'vitest'
import {
  canRedo,
  canUndo,
  createHistoryState,
  makeHistoryEntry,
  recordHistory,
  stateForHistoryIndex,
  withHistoryIndex,
  type EditableProjectState
} from '../src/renderer/src/history'

function state(value: string): EditableProjectState {
  return {
    marks: [],
    reviewedDefectIds: [value],
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
    expect(stateForHistoryIndex(history, history.index)?.reviewedDefectIds).toEqual(['a'])

    history = withHistoryIndex(history, -1)
    expect(stateForHistoryIndex(history, -1)?.reviewedDefectIds).toEqual(['base'])
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
    expect(history.entries[0].before.reviewedDefectIds).toEqual(['base'])
    expect(history.entries[0].after.reviewedDefectIds).toEqual(['ab'])
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
})
