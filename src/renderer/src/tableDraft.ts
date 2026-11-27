import { MIN_CUT_EDIT_SEC } from '@shared/cutEdit'
import { formatTimeInput, parseTimeInput } from '@shared/timeInput'
import type { ExportDefect, ExportField } from '@shared/types'
import { tableAddFields } from './tableColumns'
import { insertionIndexForRows } from './tableSelection'

/**
 * A new row that exists only in the table window until it is valid and the
 * user moves to another row. It is not a mark and is never sent to the main
 * window until it commits.
 */
export interface TableDraft {
  /** Display index in the current row list. */
  index: number
  start: string
  end: string
  note: string
  error: string | null
  errorField: 'start' | 'end' | null
  /** Bumped on every failed commit so the invalid field can refocus. */
  focusToken: number
}

export type DraftErrorCode = 'invalidStart' | 'invalidEnd' | 'tooShort' | 'outOfRange'

export type DraftValidation =
  | { ok: true; start: number; end: number }
  | { ok: false; error: DraftErrorCode; field: 'start' | 'end' }

/** Draft text for the column the time will be typed into. */
export function draftTimeText(seconds: number, field: ExportField): string {
  return field === 'start_sec' || field === 'end_sec'
    ? seconds.toFixed(3)
    : formatTimeInput(seconds)
}

/**
 * Default bounds for a new inline row: one second from the base position,
 * moved back so a row started near the end of the recording still gets a full
 * window. The user can edit both values before the draft commits.
 */
export function defaultDraftTimes(
  base: number,
  duration: number
): { start: number; end: number } {
  const max = Math.max(0, Number.isFinite(duration) ? duration : 0)
  if (max <= 0) return { start: 0, end: 0 }
  const span = Math.min(1, max)
  const safeBase = Number.isFinite(base) ? Math.max(0, base) : 0
  let end = Math.min(max, safeBase + span)
  let start = Math.max(0, Math.min(safeBase, end - span))
  if (end - start < MIN_CUT_EDIT_SEC) {
    end = max
    start = Math.max(0, max - span)
  }
  return { start, end }
}

/** Validation shared by the inline draft and its commit path. */
export function validateDraftTimes(
  startText: string,
  endText: string,
  duration: number
): DraftValidation {
  const max = Math.max(0, Number.isFinite(duration) ? duration : 0)
  const start = parseTimeInput(startText)
  const end = parseTimeInput(endText)
  if (start === null || start < 0 || start >= max) {
    return { ok: false, error: 'invalidStart', field: 'start' }
  }
  if (end === null) return { ok: false, error: 'invalidEnd', field: 'end' }
  if (end > max) return { ok: false, error: 'outOfRange', field: 'end' }
  if (end - start < MIN_CUT_EDIT_SEC) {
    return { ok: false, error: 'tooShort', field: 'end' }
  }
  return { ok: true, start, end }
}

/**
 * A draft placed below the last selected row, or where a row at the playhead
 * would sort when nothing is selected. Its default window starts at the
 * selected row's cut end, so the saved row lands directly below it.
 */
export function createTableDraft(
  rows: ExportDefect[],
  fields: ExportField[],
  duration: number,
  playhead: number,
  selectedIds: ReadonlySet<string>
): TableDraft {
  let selectedIndex = -1
  rows.forEach((row, index) => {
    if (selectedIds.has(row.id)) selectedIndex = index
  })
  const selected = selectedIndex >= 0 ? rows[selectedIndex] : null
  const base = selected ? selected.cutEnd ?? selected.end : playhead
  const times = defaultDraftTimes(base, duration)
  const addFields = tableAddFields(fields)
  return {
    index: selected ? selectedIndex + 1 : insertionIndexForRows(rows, playhead),
    start: draftTimeText(times.start, addFields.start ?? 'start_tc'),
    end: draftTimeText(times.end, addFields.end ?? 'end_tc'),
    note: '',
    error: null,
    errorField: null,
    focusToken: 0
  }
}
