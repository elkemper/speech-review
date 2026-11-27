import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from 'react'
import type { MessageKey, TParams } from '@shared/i18n'
import type { CutEdge } from '@shared/cutEdit'
import { cutEditForBounds } from '@shared/cutEdit'
import type { DefectTableState } from '@shared/defectTable'
import { exportValue } from '@shared/exportCsv'
import { formatTimeInput, isSameTimeInput, parseTimeInput } from '@shared/timeInput'
import { exportFieldLabel } from '@shared/labels'
import type { ExportDefect, ExportField, UiLanguage } from '@shared/types'
import {
  DEFAULT_TABLE_COLUMN_WIDTHS,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  ROW_NUMBER_WIDTH,
  columnWidthsFor,
  normalizeColumnWidths,
  tableAddFields,
  totalTableWidth
} from '../tableColumns'
import type { TableDraft } from '../tableDraft'
import type { RowSelection } from '../tableSelection'

const STORAGE_KEY = 'sr.tableColumns'

const TIME_FIELDS: Partial<Record<ExportField, { edge: CutEdge; format: 'tc' | 'sec' }>> = {
  start_tc: { edge: 'start', format: 'tc' },
  end_tc: { edge: 'end', format: 'tc' },
  start_sec: { edge: 'start', format: 'sec' },
  end_sec: { edge: 'end', format: 'sec' },
  duration_sec: { edge: 'duration', format: 'sec' }
}

const READ_ONLY_DEFECT_FIELDS = new Set<ExportField>([
  'defect_start_tc',
  'defect_end_tc',
  'defect_start_sec',
  'defect_end_sec',
  'defect_duration_sec'
])

function isEditable(field: ExportField): boolean {
  return field === 'note' || Boolean(TIME_FIELDS[field])
}

function loadStoredWidths(): Partial<Record<ExportField, number>> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return normalizeColumnWidths(raw ? JSON.parse(raw) : null)
  } catch {
    return {}
  }
}

function persistWidths(stored: Partial<Record<ExportField, number>>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // Widths are a convenience; without storage the defaults still work.
  }
}

/** Draft shown when a cell has no value yet (an uncut row's time cells). */
function draftFor(row: ExportDefect, field: ExportField): string {
  const value = exportValue(row, field)
  if (typeof value === 'string' && value !== '') return value
  const time = TIME_FIELDS[field]
  if (!time) return String(value)
  const seconds =
    time.edge === 'start' ? row.start : time.edge === 'end' ? row.end : row.end - row.start
  return time.format === 'tc' ? formatTimeInput(seconds) : seconds.toFixed(3)
}

/** A preview of the row the draft would become, for the read-only columns. */
function previewDefect(draft: TableDraft): ExportDefect {
  const start = parseTimeInput(draft.start)
  const end = parseTimeInput(draft.end)
  const safeStart = start === null ? 0 : Math.max(0, start)
  const safeEnd = end === null ? safeStart : Math.max(safeStart, end)
  return {
    id: '__draft__',
    type: 'manual',
    start: safeStart,
    end: safeEnd,
    wordIds: [],
    text: draft.note || 'manual',
    severity: 'medium',
    source: 'manual',
    confirmed: false,
    dismissed: false,
    note: draft.note,
    cutStart: safeStart,
    cutEnd: safeEnd
  }
}

interface Editing {
  rowId: string
  field: ExportField
  draft: string
  invalid?: boolean
  /** Bumped on every rejected commit so the input can be focused again. */
  failureToken?: number
}

interface FocusedCell {
  rowId: string
  field: ExportField
}

interface Props {
  state: DefectTableState
  selection: RowSelection
  focusedCell: FocusedCell | null
  draft: TableDraft | null
  lang: UiLanguage
  t: (key: MessageKey, params?: TParams) => string
  onSelect: (id: string, mode: 'replace' | 'toggle' | 'range') => void
  onSelectRange: (anchorId: string, id: string) => void
  onActivate: (id: string) => void
  onFocusCell: (cell: FocusedCell | null) => void
  onSetNote: (id: string, note: string) => void
  onSetCut: (id: string, edge: CutEdge, value: number) => void
  onDraftChange: (patch: Partial<TableDraft>) => void
  onDraftCommit: () => void
  onDraftCancel: () => void
  onError: (text: string) => void
}

export default function DefectTable({
  state,
  selection,
  focusedCell,
  draft,
  lang,
  t,
  onSelect,
  onSelectRange,
  onActivate,
  onFocusCell,
  onSetNote,
  onSetCut,
  onDraftChange,
  onDraftCommit,
  onDraftCancel,
  onError
}: Props) {
  const fieldsKey = state.fields.join(',')
  const [stored, setStored] = useState<Partial<Record<ExportField, number>>>(() =>
    loadStoredWidths()
  )
  const storedRef = useRef(stored)
  storedRef.current = stored
  const widths = useMemo(
    () => columnWidthsFor(state.fields, stored),
    // `fieldsKey` covers the field list; `stored` holds the widths.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fieldsKey, stored]
  )
  const widthsRef = useRef(widths)
  widthsRef.current = widths

  const [editing, setEditing] = useState<Editing | null>(null)
  const cancelRef = useRef(false)
  const dragRef = useRef<{
    field: ExportField
    startX: number
    startWidth: number
  } | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const editInputRef = useRef<HTMLInputElement | null>(null)
  const draftStartRef = useRef<HTMLInputElement | null>(null)
  const draftEndRef = useRef<HTMLInputElement | null>(null)
  const rowDragRef = useRef<{ anchorId: string; moved: boolean; lastId: string } | null>(
    null
  )
  const suppressRowClickUntilRef = useRef(0)

  const rowIds = useMemo(() => state.rows.map((row) => row.id), [state.rows])
  const rowIdSet = useMemo(() => new Set(rowIds), [rowIds])

  // Rows arrive from the main window; an edit against a row that vanished
  // (undo, partial transcript, deletion in the other window) must close.
  useEffect(() => {
    setEditing((current) => {
      if (!current) return null
      if (!state.fields.includes(current.field)) return null
      return state.rows.some((row) => row.id === current.rowId) ? current : null
    })
  }, [state.rows, state.fields])

  // The main window's active defect is mirrored here. Scrolling only on an
  // active change keeps a manual scroll from being reset by every snapshot.
  useEffect(() => {
    const id = state.activeDefectId
    if (!id) return
    const row = scrollRef.current?.querySelector(
      `tr[data-row-id="${CSS.escape(id)}"]`
    )
    row?.scrollIntoView({ block: 'nearest' })
  }, [state.activeDefectId])

  useEffect(() => {
    return () => {
      document.body.style.userSelect = ''
    }
  }, [])

  // A failed draft commit refocuses the invalid field.
  useEffect(() => {
    if (!draft?.errorField) return
    const element =
      draft.errorField === 'start' ? draftStartRef.current : draftEndRef.current
    element?.focus()
    element?.select()
  }, [draft?.focusToken])

  // A rejected cell edit keeps the typed text and returns focus to it.
  useEffect(() => {
    if (!editing?.failureToken) return
    editInputRef.current?.focus()
    editInputRef.current?.select()
  }, [editing?.failureToken])

  const beginEdit = (row: ExportDefect, field: ExportField): void => {
    if (!isEditable(field)) return
    cancelRef.current = false
    setEditing({ rowId: row.id, field, draft: draftFor(row, field) })
  }

  const commitEdit = (
    row: ExportDefect,
    field: ExportField,
    draftText: string
  ): boolean => {
    if (field === 'note') {
      // Opening and closing an editor without a change must not add a history
      // entry.
      if (draftText === row.note) return true
      onSetNote(row.id, draftText)
      return true
    }
    const time = TIME_FIELDS[field]
    if (!time) return true
    const current =
      row.cutStart !== null && row.cutEnd !== null
        ? { start: row.cutStart, end: row.cutEnd }
        : null
    // A cell without a cut is prefilled with the defect bounds. Opening it and
    // closing it unchanged must not start cutting a row that was deliberately
    // left uncut; typing the same moment in another accepted format is just as
    // unchanged.
    if (!current && isSameTimeInput(draftText, draftFor(row, field))) return true
    const value = parseTimeInput(draftText)
    if (value === null) {
      onError(t('table.edit.invalidTime'))
      return false
    }
    const next = cutEditForBounds(
      current,
      { start: row.start, end: row.end },
      time.edge,
      value,
      state.duration
    )
    if (!next) {
      onError(t('table.edit.invalidCut'))
      return false
    }
    // Committing an unchanged cell must not turn a derived cut into an
    // explicit override that stops following the padding. The cell shows three
    // decimals, so a difference below that precision is not an edit.
    if (
      current &&
      Math.abs(next.start - current.start) < 5e-4 &&
      Math.abs(next.end - current.end) < 5e-4
    ) {
      return true
    }
    onSetCut(row.id, time.edge, value)
    return true
  }

  const finishEdit = (): void => {
    const current = editing
    if (!current) return
    if (cancelRef.current) {
      cancelRef.current = false
      setEditing(null)
      return
    }
    const row = state.rows.find((item) => item.id === current.rowId)
    if (!row) {
      setEditing(null)
      return
    }
    // An invalid value stays in the editor with the typed text, like the
    // inline draft, so it can be corrected instead of retyped.
    if (commitEdit(row, current.field, current.draft)) setEditing(null)
    else
      setEditing({
        ...current,
        invalid: true,
        failureToken: (current.failureToken ?? 0) + 1
      })
  }

  const handleCellKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.currentTarget.blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancelRef.current = true
      setEditing(null)
    }
  }

  const applyWidth = (field: ExportField, width: number): void => {
    const next = { ...storedRef.current, [field]: width }
    storedRef.current = next
    setStored(next)
  }

  const startResize = (
    field: ExportField,
    event: ReactPointerEvent<HTMLSpanElement>
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = {
      field,
      startX: event.clientX,
      startWidth: widthsRef.current[field]
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveResize = (event: ReactPointerEvent<HTMLSpanElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    const width = Math.round(
      Math.min(
        MAX_COLUMN_WIDTH,
        Math.max(MIN_COLUMN_WIDTH, drag.startWidth + event.clientX - drag.startX)
      )
    )
    if (widthsRef.current[drag.field] !== width) applyWidth(drag.field, width)
  }

  const endResize = (event: ReactPointerEvent<HTMLSpanElement>): void => {
    if (!dragRef.current) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    persistWidths(storedRef.current)
  }

  const resetWidth = (field: ExportField): void => {
    applyWidth(field, DEFAULT_TABLE_COLUMN_WIDTHS[field])
    persistWidths(storedRef.current)
  }

  const startRowDrag = (
    rowId: string,
    event: ReactPointerEvent<HTMLTableCellElement>
  ): void => {
    if (event.button !== 0) return
    rowDragRef.current = { anchorId: rowId, moved: false, lastId: rowId }
    document.body.style.userSelect = 'none'
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveRowDrag = (event: ReactPointerEvent<HTMLTableCellElement>): void => {
    const drag = rowDragRef.current
    if (!drag) return
    const element = document.elementFromPoint(event.clientX, event.clientY)
    const row = element instanceof Element ? element.closest('tr[data-row-id]') : null
    const id = row?.getAttribute('data-row-id')
    if (!id || !rowIdSet.has(id)) return
    drag.lastId = id
    if (id !== drag.anchorId) drag.moved = true
    if (drag.moved) onSelectRange(drag.anchorId, id)
  }

  const endRowDrag = (event: ReactPointerEvent<HTMLTableCellElement>): void => {
    const drag = rowDragRef.current
    rowDragRef.current = null
    document.body.style.userSelect = ''
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!drag?.moved) return
    // The click that follows a drag must not collapse the range to one row.
    suppressRowClickUntilRef.current = Date.now() + 300
    onActivate(drag.lastId)
  }

  const renderDraftRow = (): ReactNode => {
    if (!draft) return null
    const addFields = tableAddFields(state.fields)
    if (!addFields.start || !addFields.end) return null
    const startField = addFields.start
    const endField = addFields.end
    const noteField = addFields.note
    const preview = previewDefect(draft)

    const onDraftKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'Enter') {
        event.preventDefault()
        onDraftCommit()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        onDraftCancel()
      }
    }

    return (
      <tr
        className="draft-row"
        onBlur={(event) => {
          const related = event.relatedTarget as Node | null
          if (related && event.currentTarget.contains(related)) return
          onDraftCommit()
        }}
      >
        <td
          className="row-number draft-marker"
          onClick={() => onFocusCell(null)}
          title={t('table.addRow')}
        >
          ＋
        </td>
        {state.fields.map((field) => {
          const isStart = field === startField
          const isEnd = field === endField
          const isNote = field === noteField
          const invalid =
            (isStart && draft.errorField === 'start') ||
            (isEnd && draft.errorField === 'end')
          return (
            <td
              key={field}
              className={`draft-cell ${invalid ? 'invalid' : ''}`}
              onClick={() => onFocusCell(null)}
            >
              {isStart ? (
                <input
                  ref={draftStartRef}
                  autoFocus
                  className={`cell-input ${invalid ? 'invalid' : ''}`}
                  value={draft.start}
                  spellCheck={false}
                  onChange={(event) => onDraftChange({ start: event.target.value })}
                  onKeyDown={onDraftKeyDown}
                />
              ) : isEnd ? (
                <input
                  ref={draftEndRef}
                  className={`cell-input ${invalid ? 'invalid' : ''}`}
                  value={draft.end}
                  spellCheck={false}
                  onChange={(event) => onDraftChange({ end: event.target.value })}
                  onKeyDown={onDraftKeyDown}
                />
              ) : isNote ? (
                <input
                  className="cell-input"
                  value={draft.note}
                  placeholder={t('panel.notePlaceholder')}
                  onChange={(event) => onDraftChange({ note: event.target.value })}
                  onKeyDown={onDraftKeyDown}
                />
              ) : (
                <span className="draft-preview">{String(exportValue(preview, field))}</span>
              )}
            </td>
          )
        })}
      </tr>
    )
  }

  const renderRow = (row: ExportDefect, index: number): ReactNode => {
    const selected = selection.selected.has(row.id)
    const active = row.id === state.activeDefectId
    return (
      <tr
        key={row.id}
        data-row-id={row.id}
        className={`${selected ? 'selected' : ''} ${active ? 'active' : ''}`}
        aria-selected={selected}
        onClick={(event) => {
          if (Date.now() < suppressRowClickUntilRef.current) {
            suppressRowClickUntilRef.current = 0
            return
          }
          onSelect(
            row.id,
            event.metaKey || event.ctrlKey
              ? 'toggle'
              : event.shiftKey
                ? 'range'
                : 'replace'
          )
          onActivate(row.id)
        }}
      >
        <td
          className="row-number"
          onClick={() => onFocusCell(null)}
          onPointerDown={(event) => startRowDrag(row.id, event)}
          onPointerMove={moveRowDrag}
          onPointerUp={endRowDrag}
          onPointerCancel={endRowDrag}
        >
          {index + 1}
        </td>
        {state.fields.map((field) => {
          const current =
            editing && editing.rowId === row.id && editing.field === field
              ? editing
              : null
          const value = current ? current.draft : String(exportValue(row, field))
          const editable = isEditable(field)
          const focused = focusedCell?.rowId === row.id && focusedCell.field === field
          const hint = READ_ONLY_DEFECT_FIELDS.has(field)
            ? t('table.defectBoundsHint')
            : ''
          return (
            <td
              key={field}
              className={`${editable ? 'editable' : ''} ${
                current ? 'editing' : ''
              } ${focused ? 'cell-focused' : ''}`}
              title={value ? (hint ? `${value} — ${hint}` : value) : hint}
              onClick={() => onFocusCell(field === 'note' ? { rowId: row.id, field } : null)}
              onDoubleClick={
                editable
                  ? (event) => {
                      event.stopPropagation()
                      beginEdit(row, field)
                    }
                  : undefined
              }
            >
              {current ? (
                <input
                  ref={editInputRef}
                  autoFocus
                  className={`cell-input ${current.invalid ? 'invalid' : ''}`}
                  value={current.draft}
                  spellCheck={false}
                  onChange={(event) =>
                    setEditing({
                      ...current,
                      draft: event.target.value,
                      invalid: false
                    })
                  }
                  onFocus={(event) => event.target.select()}
                  onBlur={finishEdit}
                  onKeyDown={handleCellKeyDown}
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                />
              ) : (
                value
              )}
            </td>
          )
        })}
      </tr>
    )
  }

  const tableWidth = totalTableWidth(state.fields, widths)
  const draftIndex = draft ? Math.min(draft.index, state.rows.length) : -1
  const draftRow = draft ? renderDraftRow() : null

  return (
    <div className="table-scroll" ref={scrollRef}>
      <table className="defect-grid" style={{ width: tableWidth, minWidth: tableWidth }}>
        <colgroup>
          <col style={{ width: ROW_NUMBER_WIDTH }} />
          {state.fields.map((field) => (
            <col key={field} style={{ width: widths[field] }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th
              className="row-number"
              style={{ width: ROW_NUMBER_WIDTH, minWidth: ROW_NUMBER_WIDTH }}
              title={t('table.rowNumber')}
            >
              {t('table.rowNumber')}
            </th>
            {state.fields.map((field) => (
              <th
                key={field}
                style={{
                  width: widths[field],
                  minWidth: widths[field],
                  maxWidth: widths[field]
                }}
                title={exportFieldLabel(lang, field)}
              >
                <span className="col-title">{exportFieldLabel(lang, field)}</span>
                <span
                  className="col-resize"
                  title={t('table.resizeColumn')}
                  onPointerDown={(event) => startResize(field, event)}
                  onPointerMove={moveResize}
                  onPointerUp={endResize}
                  onPointerCancel={endResize}
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    resetWidth(field)
                  }}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {state.rows.map((row, index) => (
            <Fragment key={row.id}>
              {draft && draftIndex === index ? draftRow : null}
              {renderRow(row, index)}
            </Fragment>
          ))}
          {draft && draftIndex >= state.rows.length ? draftRow : null}
        </tbody>
      </table>
    </div>
  )
}
