import { useEffect } from 'react'
import { formatTimecode } from '@shared/format'
import { seekTo } from '../player'
import { useApp } from '../store'

/**
 * A bookmark is a lightweight "I stopped here" marker. Unlike a manual mark it
 * is not a defect and does not take part in review, skip mode or undo/redo.
 */
export default function Bookmarks({ onClose }: { onClose: () => void }) {
  const project = useApp((state) => state.project)
  const currentTime = useApp((state) => state.currentTime)
  const addBookmark = useApp((state) => state.addBookmark)
  const removeBookmark = useApp((state) => state.removeBookmark)
  const setBookmarkNote = useApp((state) => state.setBookmarkNote)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!project) return null
  const bookmarks = [...(project.bookmarks ?? [])].sort((a, b) => a.time - b.time)

  return (
    <div className="bookmarks-popover">
      <div className="bookmarks-head">
        <div>
          <h3>Закладки</h3>
          <div className="muted small">
            Отметьте место и вернитесь к нему позже — прогресс сохраняется в проекте.
          </div>
        </div>
        <button className="icon-btn" onClick={onClose} title="Закрыть">
          ×
        </button>
      </div>

      <div className="bookmarks-actions">
        <button className="btn small primary" onClick={() => addBookmark()}>
          ＋ Закладка на {formatTimecode(currentTime, true)}
        </button>
      </div>

      <div className="bookmarks-list">
        {bookmarks.length === 0 ? (
          <div className="panel-empty">
            Пока нет закладок. Нажмите <kbd>B</kbd> в нужном месте записи.
          </div>
        ) : (
          bookmarks.map((bookmark) => (
            <div key={bookmark.id} className="bookmark-item">
              <button
                className="bookmark-time"
                onClick={() => {
                  seekTo(bookmark.time)
                  onClose()
                }}
                title="Перейти к закладке"
              >
                {formatTimecode(bookmark.time, true)}
              </button>
              <input
                className="bookmark-note"
                value={bookmark.note}
                placeholder="Заметка к месту…"
                onChange={(event) => setBookmarkNote(bookmark.id, event.target.value)}
              />
              <button
                className="link-btn danger"
                onClick={() => removeBookmark(bookmark.id)}
                title="Удалить закладку"
              >
                удалить
              </button>
            </div>
          ))
        )}
      </div>

      {bookmarks.length > 0 ? (
        <div className="bookmarks-foot">
          <button
            className="btn ghost small"
            onClick={() => {
              const last = bookmarks[bookmarks.length - 1]
              seekTo(last.time)
              onClose()
            }}
          >
            Продолжить с последней
          </button>
        </div>
      ) : null}
    </div>
  )
}