import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { translate, type MessageKey, type TParams } from '@shared/i18n'
import type { DefectTableState } from '@shared/defectTable'
import type { CutEdge } from '@shared/cutEdit'
import { exportTimecode } from '@shared/exportCsv'
import type { ExportField } from '@shared/types'
import {
  EMPTY_ROW_SELECTION,
  pruneRowSelection,
  selectAllRows,
  selectRow,
  type RowSelectMode,
  type RowSelection
} from '../tableSelection'
import { tableAddFields } from '../tableColumns'
import {
  applyTableTheme,
  loadTableTheme,
  saveTableTheme,
  type TableTheme
} from '../tableTheme'
import {
  createTableDraft,
  validateDraftTimes,
  type DraftErrorCode,
  type TableDraft
} from '../tableDraft'
import DefectTable from './DefectTable'
import AddTableRowDialog from './AddTableRowDialog'

interface ToastState {
  text: string
  kind: 'info' | 'success' | 'error'
}

interface FocusedCell {
  rowId: string
  field: ExportField
}

interface PendingCommand {
  kind: 'add' | 'delete'
  count: number
}

const DRAFT_ERROR_KEYS: Record<DraftErrorCode, MessageKey> = {
  invalidStart: 'table.add.invalidStart',
  invalidEnd: 'table.add.invalidEnd',
  tooShort: 'table.add.tooShort',
  outOfRange: 'table.add.outOfRange'
}

/**
 * Root of the defect table window. It is a passive mirror of the main window:
 * the state arrives over IPC, and every edit travels back as a command that
 * the main window applies through its normal store actions.
 */
export default function DefectTableApp() {
  const [state, setState] = useState<DefectTableState | null>(null)
  const [selection, setSelection] = useState<RowSelection>(EMPTY_ROW_SELECTION)
  const [focusedCell, setFocusedCell] = useState<FocusedCell | null>(null)
  const [draft, setDraft] = useState<TableDraft | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  // The table window has its own theme; the main window stays dark.
  const [theme, setTheme] = useState<TableTheme>(loadTableTheme)
  const projectIdRef = useRef<string | null>(null)
  const pendingAddRef = useRef<'draft' | 'modal' | null>(null)
  const addTimerRef = useRef<number | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const stateRef = useRef<DefectTableState | null>(null)
  stateRef.current = state
  const selectionRef = useRef<RowSelection>(selection)
  selectionRef.current = selection
  const draftRef = useRef<TableDraft | null>(draft)
  draftRef.current = draft
  const suppressAddClickRef = useRef(false)
  const addButtonPointerRef = useRef(false)
  // Success/failure for add and delete is shown when the main window echoes the
  // command result, so a rejected command is not reported as done.
  const pendingCommandsRef = useRef(new Map<string, PendingCommand>())
  const processedTokensRef = useRef(new Set<string>())
  const nextTokenRef = useRef(0)

  const tokenFor = useCallback((pending: PendingCommand): string => {
    const token = String(++nextTokenRef.current)
    pendingCommandsRef.current.set(token, pending)
    return token
  }, [])

  const lang = state?.uiLanguage ?? 'ru'
  const t = useCallback(
    (key: MessageKey, params?: TParams): string => translate(lang, key, params),
    [lang]
  )

  const showToast = useCallback((text: string, kind: ToastState['kind'] = 'info') => {
    setToast({ text, kind })
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3800)
  }, [])

  const clearAddTimer = (): void => {
    if (addTimerRef.current !== null) {
      window.clearTimeout(addTimerRef.current)
      addTimerRef.current = null
    }
  }

  useEffect(() => {
    const off = window.api.onDefectTableState((next) => {
      const projectChanged =
        projectIdRef.current !== null && projectIdRef.current !== next.projectId
      projectIdRef.current = next.projectId
      setState(next)
      setSelection((current) =>
        projectChanged
          ? EMPTY_ROW_SELECTION
          : pruneRowSelection(current, next.rows.map((row) => row.id))
      )
      if (projectChanged) {
        draftRef.current = null
        setDraft(null)
        setFocusedCell(null)
        pendingCommandsRef.current.clear()
        processedTokensRef.current.clear()
      }
      const result = next.lastCommand
      if (result && !processedTokensRef.current.has(result.token)) {
        processedTokensRef.current.add(result.token)
        const pending = pendingCommandsRef.current.get(result.token)
        pendingCommandsRef.current.delete(result.token)
        if (pending) {
          if (!result.ok) {
            showToast(translate(next.uiLanguage, 'table.commandFailed'), 'error')
          } else if (pending.kind === 'add') {
            showToast(translate(next.uiLanguage, 'table.added'), 'success')
          } else {
            showToast(
              `${translate(next.uiLanguage, 'table.deleted', {
                count: pending.count
              })} ${translate(next.uiLanguage, 'table.deletedUndoHint')}`
            )
          }
        }
      }
      const pending = pendingAddRef.current
      if (pending) {
        pendingAddRef.current = null
        clearAddTimer()
        const fields = tableAddFields(next.fields)
        if (pending === 'draft' && fields.start && fields.end) {
          setDraft(
            createTableDraft(
              next.rows,
              next.fields,
              next.duration,
              next.playhead,
              selectionRef.current.selected
            )
          )
        } else {
          setAddOpen(true)
        }
      }
    })
    window.api.requestDefectTableState()
    return off
  }, [showToast])

  useEffect(() => {
    if (!state) return
    document.documentElement.lang = state.uiLanguage
    document.title = translate(state.uiLanguage, 'table.windowTitle', {
      name: state.projectName
    })
  }, [state?.uiLanguage, state?.projectName])

  useEffect(() => {
    setFocusedCell((current) =>
      current &&
      state?.fields.includes(current.field) &&
      state.rows.some((row) => row.id === current.rowId)
        ? current
        : null
    )
  }, [state?.rows, state?.fields])

  useEffect(() => {
    return () => {
      clearAddTimer()
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    }
  }, [])

  const rowIds = useMemo(() => (state?.rows ?? []).map((row) => row.id), [state?.rows])

  const changeDraft = (patch: Partial<TableDraft>): void => {
    const current = draftRef.current
    if (!current) return
    const next = { ...current, ...patch, error: null, errorField: null }
    draftRef.current = next
    setDraft(next)
  }

  const cancelDraft = (): void => {
    draftRef.current = null
    setDraft(null)
  }

  const commitDraft = useCallback(
    (fromBlur = false): boolean => {
      const current = draftRef.current
      const currentState = stateRef.current
      if (!current) return true
      if (!currentState) return false
      const validation = validateDraftTimes(
        current.start,
        current.end,
        currentState.duration
      )
      if (!validation.ok) {
        const message = t(DRAFT_ERROR_KEYS[validation.error], {
          duration: exportTimecode(currentState.duration)
        })
        const next: TableDraft = {
          ...current,
          error: message,
          errorField: validation.field,
          focusToken: current.focusToken + 1
        }
        draftRef.current = next
        setDraft(next)
        showToast(message, 'error')
        return false
      }
      const token = tokenFor({ kind: 'add', count: 1 })
      window.api.sendDefectTableCommand({
        type: 'addMark',
        start: validation.start,
        end: validation.end,
        note: current.note,
        token
      })
      draftRef.current = null
      setDraft(null)
      if (fromBlur && addButtonPointerRef.current) {
        // The blur came from pressing the toolbar's Add button. The same
        // gesture must save the draft, not immediately start another one.
        suppressAddClickRef.current = true
        window.setTimeout(() => {
          suppressAddClickRef.current = false
        }, 500)
      }
      return true
    },
    [showToast, t, tokenFor]
  )

  const requestAddRow = (): void => {
    if (!state) return
    addButtonPointerRef.current = false
    if (suppressAddClickRef.current) {
      suppressAddClickRef.current = false
      return
    }
    if (draftRef.current) {
      commitDraft(true)
      return
    }
    const fields = tableAddFields(state.fields)
    const pendingAdd: 'draft' | 'modal' = fields.start && fields.end ? 'draft' : 'modal'
    setFocusedCell(null)
    pendingAddRef.current = pendingAdd
    window.api.requestDefectTableState()
    clearAddTimer()
    // The main window usually answers immediately with a fresh playhead. If
    // it does not, place the draft with the last known state.
    addTimerRef.current = window.setTimeout(() => {
      addTimerRef.current = null
      const pending = pendingAddRef.current
      if (!pending) return
      pendingAddRef.current = null
      const latest = stateRef.current
      if (!latest) return
      const latestFields = tableAddFields(latest.fields)
      if (pending === 'draft' && latestFields.start && latestFields.end) {
        setDraft(
          createTableDraft(
            latest.rows,
            latest.fields,
            latest.duration,
            latest.playhead,
            selectionRef.current.selected
          )
        )
      } else {
        setAddOpen(true)
      }
    }, 800)
  }

  const toggleTheme = (): void => {
    const next: TableTheme = theme === 'light' ? 'dark' : 'light'
    // Apply before the state update so the window does not flash the old theme.
    applyTableTheme(next)
    saveTableTheme(next)
    setTheme(next)
  }

  const deleteSelected = useCallback(() => {
    const ids = [...selection.selected]
    if (ids.length === 0) return
    const token = tokenFor({ kind: 'delete', count: ids.length })
    window.api.sendDefectTableCommand({ type: 'delete', ids, token })
    setSelection(EMPTY_ROW_SELECTION)
  }, [selection, tokenFor])

  useEffect(() => {
    if (addOpen) return
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select')) return
      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (mod && key === 'z') {
        event.preventDefault()
        window.api.sendDefectTableCommand({ type: event.shiftKey ? 'redo' : 'undo' })
        return
      }
      if (mod && key === 'y') {
        event.preventDefault()
        window.api.sendDefectTableCommand({ type: 'redo' })
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selection.selected.size === 0) return
        event.preventDefault()
        deleteSelected()
        return
      }
      if (mod && key === 'a') {
        event.preventDefault()
        setSelection(selectAllRows(rowIds))
        return
      }
      if (event.key === 'Escape') {
        setSelection(EMPTY_ROW_SELECTION)
        setFocusedCell(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [addOpen, deleteSelected, rowIds, selection.selected.size])

  // Cmd+C / Cmd+V on macOS go through the Edit menu roles, which dispatch the
  // DOM clipboard events. Handling them here works with the system clipboard
  // and replaces the note of the focused cell.
  useEffect(() => {
    const onCopy = (event: ClipboardEvent): void => {
      if (!focusedCell || focusedCell.field !== 'note') return
      const target = event.target
      // The event can be dispatched at the Document, which has no closest().
      if (target instanceof Element && target.closest('input, textarea, select')) return
      const row = stateRef.current?.rows.find((item) => item.id === focusedCell.rowId)
      if (!row || !event.clipboardData) return
      event.clipboardData.setData('text/plain', row.note)
      event.preventDefault()
    }
    const onPaste = (event: ClipboardEvent): void => {
      if (!focusedCell || focusedCell.field !== 'note') return
      const target = event.target
      if (target instanceof Element && target.closest('input, textarea, select')) return
      const text = event.clipboardData?.getData('text/plain')
      if (text === undefined) return
      event.preventDefault()
      window.api.sendDefectTableCommand({
        type: 'setNote',
        id: focusedCell.rowId,
        note: text
      })
    }
    window.addEventListener('copy', onCopy)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('copy', onCopy)
      window.removeEventListener('paste', onPaste)
    }
  }, [focusedCell])

  const onSelect = (id: string, mode: RowSelectMode): void => {
    setSelection((current) => selectRow(rowIds, current, id, mode))
  }

  const onSelectRange = (anchorId: string, id: string): void => {
    setSelection(selectRow(rowIds, { anchorId, selected: new Set() }, id, 'range'))
  }

  const activate = (id: string): void => {
    window.api.sendDefectTableCommand({ type: 'activate', id })
  }

  const setNote = (id: string, note: string): void => {
    window.api.sendDefectTableCommand({ type: 'setNote', id, note })
  }

  const setCut = (id: string, edge: CutEdge, value: number): void => {
    window.api.sendDefectTableCommand({ type: 'setCut', id, edge, value })
  }

  const addRow = (start: number, end: number, note: string): void => {
    const token = tokenFor({ kind: 'add', count: 1 })
    window.api.sendDefectTableCommand({ type: 'addMark', start, end, note, token })
    setAddOpen(false)
  }

  if (!state) {
    return (
      <div className="defect-table-shell table-loading">
        <div className="spinner" />
      </div>
    )
  }

  const selectedCount = selection.selected.size

  return (
    <div className="defect-table-shell">
      <header className="table-toolbar">
        <div className="table-toolbar-title">
          <h1>{t('table.title')}</h1>
          <span className="muted small">{state.projectName}</span>
        </div>
        <div className="table-toolbar-actions">
          <button
            className="btn ghost small"
            onClick={() => window.api.sendDefectTableCommand({ type: 'undo' })}
            disabled={!state.canUndo}
            title={t('workspace.undoTitle')}
            aria-label={t('workspace.undoTitle')}
          >
            ↶
          </button>
          <button
            className="btn ghost small"
            onClick={() => window.api.sendDefectTableCommand({ type: 'redo' })}
            disabled={!state.canRedo}
            title={t('workspace.redoTitle')}
            aria-label={t('workspace.redoTitle')}
          >
            ↷
          </button>
          <button
            className="btn small"
            onPointerDown={() => {
              addButtonPointerRef.current = true
              // If the gesture ends without a click, do not affect later blurs.
              window.setTimeout(() => {
                addButtonPointerRef.current = false
              }, 500)
            }}
            onClick={requestAddRow}
          >
            ＋ {t('table.addRow')}
          </button>
          <button
            className="btn ghost small danger"
            onClick={deleteSelected}
            disabled={selectedCount === 0}
            title={t('table.deleteTitle')}
          >
            {t('table.deleteSelected', { count: selectedCount })}
          </button>
          <button
            className="btn ghost small"
            onClick={toggleTheme}
            title={theme === 'light' ? t('table.themeDark') : t('table.themeLight')}
            aria-label={theme === 'light' ? t('table.themeDark') : t('table.themeLight')}
            aria-pressed={theme === 'light'}
          >
            {theme === 'light' ? '☾' : '☀'}
          </button>
        </div>
        <div className="table-toolbar-meta">
          <span>{t('table.rows', { count: state.rows.length })}</span>
          <span>{t('table.selected', { count: selectedCount })}</span>
        </div>
      </header>

      <div className="table-hint">
        {draft ? t('table.add.draftHint') : t('table.fieldsHint')}
      </div>

      <div className="table-body">
        {state.rows.length === 0 && !draft ? (
          <div className="table-empty">
            {state.hasTranscript ? t('table.empty') : t('table.emptyNoTranscript')}
          </div>
        ) : (
          <DefectTable
            key={state.projectId}
            state={state}
            selection={selection}
            focusedCell={focusedCell}
            draft={draft}
            lang={state.uiLanguage}
            t={t}
            onSelect={onSelect}
            onSelectRange={onSelectRange}
            onActivate={activate}
            onFocusCell={setFocusedCell}
            onSetNote={setNote}
            onSetCut={setCut}
            onDraftChange={changeDraft}
            onDraftCommit={() => commitDraft(true)}
            onDraftCancel={cancelDraft}
            onError={(text) => showToast(text, 'error')}
          />
        )}
      </div>

      {addOpen ? (
        <AddTableRowDialog
          duration={state.duration}
          defaultStart={state.playhead}
          t={t}
          onCancel={() => setAddOpen(false)}
          onSubmit={addRow}
        />
      ) : null}

      {toast ? <div className={`toast toast-${toast.kind}`}>{toast.text}</div> : null}
    </div>
  )
}
