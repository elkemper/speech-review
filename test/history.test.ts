import { describe, expect, it } from 'vitest'
import {
  applyEditable,
  applySettingsSnapshot,
  canRedo,
  canUndo,
  createHistoryState,
  editableEquals,
  isSettingsSessionEntry,
  makeHistoryEntry,
  recordHistory,
  snapshotEditable,
  stateForHistoryIndex,
  withHistoryIndex,
  type EditableProjectState
} from '../src/renderer/src/history'
import { DEFAULT_RULES } from '../src/shared/defects'
import { DEFAULT_SETTINGS } from '../src/shared/settings'
import type { Project } from '../src/shared/types'

function state(value: string): EditableProjectState {
  return {
    marks: [],
    confirmedDefectIds: [value],
    dismissedDefectIds: [],
    dismissedMarks: [],
    defectNotes: {},
    defectOverrides: {},
    rules: DEFAULT_RULES,
    playback: {
      skipBeforeSec: 0.15,
      skipAfterSec: 0.35,
      paddingByType: { filler: { before: 0.1, after: 0.2 } },
      groupPadding: { before: 0.15, after: 0.35 }
    }
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
      defectOverrides: {},
      rules: DEFAULT_RULES
    } as unknown as Project

    const snapshot = snapshotEditable(project, DEFAULT_SETTINGS)
    expect(snapshot.dismissedMarks).toEqual([mark])
    expect(snapshot.dismissedMarks[0].wordIds).not.toBe(mark.wordIds)

    const restored = applyEditable(project, { ...state('x'), dismissedMarks: [mark] })
    expect(restored.dismissedMarks).toEqual([mark])
    expect(restored.dismissedMarks[0].wordIds).not.toBe(mark.wordIds)
  })

  it('snapshots and restores rules and skip padding', () => {
    const project = {
      marks: [],
      confirmedDefectIds: [],
      dismissedDefectIds: [],
      dismissedMarks: [],
      defectNotes: {},
      defectOverrides: {},
      rules: { ...DEFAULT_RULES, pauseThresholdSec: 1.8 }
    } as unknown as Project
    const settings = {
      ...DEFAULT_SETTINGS,
      playback: {
        ...DEFAULT_SETTINGS.playback,
        skipEnabled: true,
        paddingByType: { pause: { before: 0.2, after: 0.4 } },
        groupPadding: { before: 0.3, after: 0.6 }
      }
    }

    const snapshot = snapshotEditable(project, settings)
    expect(snapshot.rules.pauseThresholdSec).toBe(1.8)
    expect(snapshot.playback.paddingByType?.pause).toEqual({ before: 0.2, after: 0.4 })
    expect(snapshot.playback.groupPadding).toEqual({ before: 0.3, after: 0.6 })
    expect(snapshot.rules).not.toBe(project.rules)
    expect(snapshot.rules.minDurationByType).not.toBe(project.rules.minDurationByType)
    expect(snapshot.rules.fillerWords).not.toBe(project.rules.fillerWords)

    const restored = applyEditable(project, {
      ...snapshot,
      rules: { ...snapshot.rules, pauseThresholdSec: 1.2 }
    })
    expect(restored.rules.pauseThresholdSec).toBe(1.2)
    expect(restored.rules).not.toBe(snapshot.rules)
  })

  it('applies a settings snapshot without changing skipEnabled', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      playback: { ...DEFAULT_SETTINGS.playback, skipEnabled: true }
    }
    const applied = applySettingsSnapshot(settings, state('x'))

    expect(applied.playback.skipEnabled).toBe(true)
    expect(applied.playback.paddingByType).toEqual({ filler: { before: 0.1, after: 0.2 } })
    expect(applied.playback.groupPadding).toEqual({ before: 0.15, after: 0.35 })
    expect(applied.rules).toEqual(DEFAULT_RULES)
    expect(applied.rules).not.toBe(DEFAULT_RULES)
  })

  it('detects rules changes in editable state', () => {
    expect(editableEquals(state('x'), state('x'))).toBe(true)
    expect(
      editableEquals(state('x'), {
        ...state('x'),
        rules: { ...DEFAULT_RULES, pauseThresholdSec: 2 }
      })
    ).toBe(false)
  })

  it('does not coalesce settings edits across dialog sessions', () => {
    let history = createHistoryState()
    history = recordHistory(
      history,
      makeHistoryEntry('one', state('base'), state('a'), {
        id: 'one',
        at: '2026-01-01T00:00:00.000Z',
        mergeKey: 'rules:pause-threshold',
        settingsSession: 'session-1'
      }),
      Date.parse('2026-01-01T00:00:00.000Z')
    )
    history = recordHistory(
      history,
      makeHistoryEntry('two', state('a'), state('b'), {
        id: 'two',
        at: '2026-01-01T00:00:01.000Z',
        mergeKey: 'rules:pause-threshold',
        settingsSession: 'session-2'
      }),
      Date.parse('2026-01-01T00:00:01.000Z')
    )

    expect(history.entries.map((entry) => entry.id)).toEqual(['one', 'two'])
    expect(history.entries[1].settingsSession).toBe('session-2')
  })

  it('only treats entries from the current settings session as undoable there', () => {
    const sessionEntry = makeHistoryEntry('rule', state('a'), state('b'), {
      settingsSession: 'session-1'
    })
    const projectEntry = makeHistoryEntry('mark', state('b'), state('c'))

    expect(isSettingsSessionEntry(sessionEntry, 'session-1')).toBe(true)
    expect(isSettingsSessionEntry(sessionEntry, 'session-2')).toBe(false)
    expect(isSettingsSessionEntry(sessionEntry, null)).toBe(false)
    expect(isSettingsSessionEntry(projectEntry, 'session-1')).toBe(false)
    expect(isSettingsSessionEntry(undefined, 'session-1')).toBe(false)
  })
})
