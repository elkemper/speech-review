import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { MessageKey, TParams } from '@shared/i18n'
import { clamp } from '@shared/format'
import { exportTimecode } from '@shared/exportCsv'
import { formatTimeInput, parseTimeInput } from '@shared/timeInput'

const MIN_ROW_SEC = 0.05

interface Props {
  duration: number
  defaultStart: number
  t: (key: MessageKey, params?: TParams) => string
  onCancel: () => void
  onSubmit: (start: number, end: number, note: string) => void
}

/**
 * Adds a manual mark from the table. The typed bounds are the exact cut (the
 * store writes a cut override for a standalone mark); the note is stored on
 * the mark and in the defect-note map.
 */
export default function AddTableRowDialog({
  duration,
  defaultStart,
  t,
  onCancel,
  onSubmit
}: Props) {
  const max = Math.max(0, duration)
  const initialStart = clamp(defaultStart, 0, Math.max(0, max - MIN_ROW_SEC))
  const [start, setStart] = useState(() => formatTimeInput(initialStart))
  const [end, setEnd] = useState(() =>
    formatTimeInput(Math.min(max, initialStart + 1))
  )
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const durationLabel = exportTimecode(max)
    const from = parseTimeInput(start)
    const to = parseTimeInput(end)
    if (from === null || from < 0 || from >= max) {
      setError(t('table.add.invalidStart', { duration: durationLabel }))
      return
    }
    if (to === null) {
      setError(t('table.add.invalidEnd'))
      return
    }
    if (to > max) {
      setError(t('table.add.outOfRange', { duration: durationLabel }))
      return
    }
    if (to - from < MIN_ROW_SEC) {
      setError(t('table.add.tooShort'))
      return
    }
    onSubmit(from, to, note)
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <form className="modal table-add-modal" onSubmit={submit}>
        <header className="modal-head">
          <div>
            <h2>{t('table.add.title')}</h2>
            <div className="muted small">{t('table.add.hint')}</div>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onCancel}
            title={t('common.close')}
          >
            ×
          </button>
        </header>

        <div className="modal-body table-add-body">
          <label className="field">
            <span>{t('table.add.start')}</span>
            <input
              autoFocus
              value={start}
              spellCheck={false}
              onChange={(event) => setStart(event.target.value)}
              onFocus={(event) => event.target.select()}
            />
          </label>
          <label className="field">
            <span>{t('table.add.end')}</span>
            <input
              value={end}
              spellCheck={false}
              onChange={(event) => setEnd(event.target.value)}
              onFocus={(event) => event.target.select()}
            />
          </label>
          <label className="field">
            <span>{t('table.add.note')}</span>
            <input
              value={note}
              placeholder={t('panel.notePlaceholder')}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <p className="hint">{t('table.add.mergeHint')}</p>
          {error ? (
            <div className="table-add-error" role="alert">
              {error}
            </div>
          ) : null}
        </div>

        <footer className="modal-foot">
          <button type="button" className="btn ghost" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn primary">
            {t('table.add.submit')}
          </button>
        </footer>
      </form>
    </div>
  )
}
