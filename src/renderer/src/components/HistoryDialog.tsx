import { useEffect } from 'react'
import { formatClock } from '@shared/format'
import { canRedo, canUndo } from '../history'
import { useApp } from '../store'
import { useT, useUiLanguage } from '../i18n'

export default function HistoryDialog() {
  const show = useApp((state) => state.showHistory)
  const history = useApp((state) => state.history)
  const undo = useApp((state) => state.undo)
  const redo = useApp((state) => state.redo)
  const jumpHistory = useApp((state) => state.jumpHistory)
  const setShowHistory = useApp((state) => state.setShowHistory)
  const t = useT()
  const lang = useUiLanguage()

  useEffect(() => {
    if (!show) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setShowHistory(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [show, setShowHistory])

  if (!show) return null

  const entries = history.entries

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setShowHistory(false)
      }}
    >
      <div className="modal history-modal">
        <header className="modal-head">
          <div>
            <h2>{t('history.title')}</h2>
            <div className="muted small">
              {entries.length === 0
                ? t('history.empty')
                : t('history.count', {
                    count: entries.length,
                    position: history.index + 1
                  })}
            </div>
          </div>
          <button
            className="icon-btn"
            onClick={() => setShowHistory(false)}
            title={t('common.close')}
          >
            ×
          </button>
        </header>

        <div className="history-toolbar">
          <button
            className="btn ghost small"
            onClick={undo}
            disabled={!canUndo(history)}
            title={t('history.undoTitle')}
          >
            ↶ {t('common.undo')}
          </button>
          <button
            className="btn ghost small"
            onClick={redo}
            disabled={!canRedo(history)}
            title={t('history.redoTitle')}
          >
            ↷ {t('common.retry')}
          </button>
          <span className="muted small">{t('history.clickHint')}</span>
        </div>

        <div className="modal-body history-body">
          {entries.length === 0 ? (
            <div className="panel-empty">{t('history.help')}</div>
          ) : (
            <div className="history-list">
              <button
                className={`history-item ${history.index < 0 ? 'current' : ''} ${
                  history.index >= 0 ? 'undone' : ''
                }`}
                onClick={() => jumpHistory(-1)}
              >
                <span className="history-dot" />
                <span className="history-label">{t('history.initial')}</span>
                <span className="history-time" />
              </button>
              {entries.map((entry, index) => (
                <button
                  key={entry.id}
                  className={`history-item ${index === history.index ? 'current' : ''} ${
                    index > history.index ? 'undone' : ''
                  }`}
                  onClick={() => jumpHistory(index)}
                >
                  <span className="history-dot" />
                  <span className="history-label">{entry.label}</span>
                  <span className="history-time">{formatClock(entry.at, lang)}</span>
                  {index > history.index ? (
                    <span className="badge">{t('history.undone')}</span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>

        <footer className="modal-foot">
          <span className="muted small">
            <kbd>⌘Z</kbd> / <kbd>Ctrl+Z</kbd> — {t('history.hotkeyUndo')},{' '}
            <kbd>⇧⌘Z</kbd> / <kbd>Ctrl+Y</kbd> — {t('history.hotkeyRedo')}
          </span>
          <button className="btn primary" onClick={() => setShowHistory(false)}>
            {t('common.done')}
          </button>
        </footer>
      </div>
    </div>
  )
}
