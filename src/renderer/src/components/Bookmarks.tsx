import { useEffect } from 'react'
import { formatTimecode } from '@shared/format'
import { seekTo } from '../player'
import { useApp } from '../store'
import { useT } from '../i18n'

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
  const t = useT()

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
          <h3>{t('bookmarks.title')}</h3>
          <div className="muted small">{t('bookmarks.hint')}</div>
        </div>
        <button className="icon-btn" onClick={onClose} title={t('common.close')}>
          ×
        </button>
      </div>

      <div className="bookmarks-actions">
        <button className="btn small primary" onClick={() => addBookmark()}>
          {t('bookmarks.add', { time: formatTimecode(currentTime, true) })}
        </button>
      </div>

      <div className="bookmarks-list">
        {bookmarks.length === 0 ? (
          <div className="panel-empty">
            {t('bookmarks.empty')} <kbd>B</kbd> {t('bookmarks.emptySuffix')}
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
                title={t('bookmarks.go')}
              >
                {formatTimecode(bookmark.time, true)}
              </button>
              <input
                className="bookmark-note"
                value={bookmark.note}
                placeholder={t('bookmarks.notePlaceholder')}
                onChange={(event) => setBookmarkNote(bookmark.id, event.target.value)}
              />
              <button
                className="link-btn danger"
                onClick={() => removeBookmark(bookmark.id)}
                title={t('bookmarks.delete')}
              >
                {t('bookmarks.deleteShort')}
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
            {t('bookmarks.resume')}
          </button>
        </div>
      ) : null}
    </div>
  )
}