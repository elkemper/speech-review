import { describe, expect, it } from 'vitest'
import {
  createTableDraft,
  defaultDraftTimes,
  draftTimeText,
  validateDraftTimes
} from '../src/renderer/src/tableDraft'
import type { ExportDefect } from '../src/shared/types'

function row(id: string, start: number, end: number, cutEnd?: number | null): ExportDefect {
  return {
    id,
    type: 'filler',
    start,
    end,
    wordIds: [1],
    text: id,
    severity: 'low',
    source: 'auto',
    confirmed: false,
    dismissed: false,
    note: '',
    cutStart: start,
    cutEnd: cutEnd === undefined ? end : cutEnd
  }
}

describe('validateDraftTimes', () => {
  it('accepts timecodes and seconds and returns the parsed bounds', () => {
    expect(validateDraftTimes('00:00:10.000', '00:00:11.500', 60)).toEqual({
      ok: true,
      start: 10,
      end: 11.5
    })
    expect(validateDraftTimes('10', '11,25', 60)).toEqual({
      ok: true,
      start: 10,
      end: 11.25
    })
  })

  it('rejects a missing, negative or out-of-range start', () => {
    expect(validateDraftTimes('', '11', 60)).toMatchObject({
      ok: false,
      error: 'invalidStart',
      field: 'start'
    })
    expect(validateDraftTimes('-1', '11', 60)).toMatchObject({ ok: false, error: 'invalidStart' })
    expect(validateDraftTimes('60', '61', 60)).toMatchObject({ ok: false, error: 'invalidStart' })
  })

  it('rejects a malformed end and an end beyond the recording', () => {
    expect(validateDraftTimes('10', 'nope', 60)).toMatchObject({
      ok: false,
      error: 'invalidEnd',
      field: 'end'
    })
    expect(validateDraftTimes('10', '61', 60)).toMatchObject({
      ok: false,
      error: 'outOfRange',
      field: 'end'
    })
  })

  it('rejects an end that is not after the start', () => {
    expect(validateDraftTimes('10', '10', 60)).toMatchObject({
      ok: false,
      error: 'tooShort',
      field: 'end'
    })
    expect(validateDraftTimes('10', '9', 60)).toMatchObject({ ok: false, error: 'tooShort' })
  })
})

describe('defaultDraftTimes', () => {
  it('starts at the base and spans one second', () => {
    expect(defaultDraftTimes(10, 60)).toEqual({ start: 10, end: 11 })
    expect(defaultDraftTimes(0, 60)).toEqual({ start: 0, end: 1 })
  })

  it('moves the window back near the end of the recording', () => {
    expect(defaultDraftTimes(59.9, 60)).toEqual({ start: 59, end: 60 })
    expect(defaultDraftTimes(60, 60)).toEqual({ start: 59, end: 60 })
  })

  it('handles short and empty recordings', () => {
    expect(defaultDraftTimes(0.4, 0.5)).toEqual({ start: 0, end: 0.5 })
    expect(defaultDraftTimes(10, 0)).toEqual({ start: 0, end: 0 })
    expect(defaultDraftTimes(-5, 60)).toEqual({ start: 0, end: 1 })
  })
})

describe('draftTimeText', () => {
  it('formats by the column being edited', () => {
    expect(draftTimeText(3723.5, 'start_tc')).toBe('01:02:03.500')
    expect(draftTimeText(10, 'start_sec')).toBe('10.000')
    expect(draftTimeText(1.23456, 'end_sec')).toBe('1.235')
  })
})

describe('createTableDraft', () => {
  const fields = ['start_tc', 'end_tc', 'note'] as const

  it('places the draft where the playhead would sort when nothing is selected', () => {
    const draft = createTableDraft(
      [row('a', 5, 6), row('b', 15, 16)],
      [...fields],
      60,
      10,
      new Set()
    )
    expect(draft.index).toBe(1)
    expect(draft.start).toBe('00:00:10.000')
    expect(draft.end).toBe('00:00:11.000')
    expect(draft.note).toBe('')
    expect(draft.error).toBeNull()
  })

  it('places the draft below the last selected row and starts at its cut end', () => {
    const draft = createTableDraft(
      [row('a', 5, 6), row('b', 15, 16, 17)],
      [...fields],
      60,
      10,
      new Set(['a', 'b'])
    )
    expect(draft.index).toBe(2)
    expect(draft.start).toBe('00:00:17.000')
    expect(draft.end).toBe('00:00:18.000')
  })

  it('falls back to the defect end when the cut is empty', () => {
    const draft = createTableDraft(
      [row('a', 5, 6, null)],
      [...fields],
      60,
      0,
      new Set(['a'])
    )
    expect(draft.start).toBe('00:00:06.000')
  })

  it('uses the seconds columns when they are the only time columns', () => {
    const draft = createTableDraft([], ['start_sec', 'end_sec'], 60, 10, new Set())
    expect(draft.start).toBe('10.000')
    expect(draft.end).toBe('11.000')
  })
})
