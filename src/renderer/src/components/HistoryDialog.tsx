import { useEffect } from 'react'
import { canRedo, canUndo } from '../history'
import { useApp } from '../store'

function clock(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export default function HistoryDialog() {
  const show = useApp((state) => state.showHistory)
  const history = useApp((state) => state.history)
  const undo = useApp((state) => state.undo)
  const redo = useApp((state) => state.redo)
  const jumpHistory = useApp((state) => state.jumpHistory)
  const setShowHistory = useApp((state) => state.setShowHistory)

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
            <h2>История действий</h2>
            <div className="muted small">
              {entries.length === 0
                ? 'Пока нет действий по этому проекту'
                : `Действий: ${entries.length} · текущая позиция ${history.index + 1}`}
            </div>
          </div>
          <button className="icon-btn" onClick={() => setShowHistory(false)} title="Закрыть">
            ×
          </button>
        </header>

        <div className="history-toolbar">
          <button
            className="btn ghost small"
            onClick={undo}
            disabled={!canUndo(history)}
            title="Отменить последнее действие"
          >
            ↶ Отменить
          </button>
          <button
            className="btn ghost small"
            onClick={redo}
            disabled={!canRedo(history)}
            title="Повторить отменённое действие"
          >
            ↷ Повторить
          </button>
          <span className="muted small">Клик по записи переходит к этому состоянию</span>
        </div>

        <div className="modal-body history-body">
          {entries.length === 0 ? (
            <div className="panel-empty">
              Добавьте метку, подтвердите или удалите дефект, измените границы или
              настройки дефектов — действия появятся здесь.
            </div>
          ) : (
            <div className="history-list">
              <button
                className={`history-item ${history.index < 0 ? 'current' : ''} ${
                  history.index >= 0 ? 'undone' : ''
                }`}
                onClick={() => jumpHistory(-1)}
              >
                <span className="history-dot" />
                <span className="history-label">Исходное состояние</span>
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
                  <span className="history-time">{clock(entry.at)}</span>
                  {index > history.index ? <span className="badge">отменено</span> : null}
                </button>
              ))}
            </div>
          )}
        </div>

        <footer className="modal-foot">
          <span className="muted small">
            <kbd>⌘Z</kbd> / <kbd>Ctrl+Z</kbd> — отменить, <kbd>⇧⌘Z</kbd> /{' '}
            <kbd>Ctrl+Y</kbd> — повторить
          </span>
          <button className="btn primary" onClick={() => setShowHistory(false)}>
            Готово
          </button>
        </footer>
      </div>
    </div>
  )
}
