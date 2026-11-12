import { useEffect, useState } from 'react'
import { useApp } from './store'
import Welcome from './components/Welcome'
import Workspace from './components/Workspace'
import SettingsDialog from './components/SettingsDialog'
import HistoryDialog from './components/HistoryDialog'

export default function App() {
  const loading = useApp((state) => state.loading)
  const status = useApp((state) => state.status)
  const project = useApp((state) => state.project)
  const error = useApp((state) => state.error)
  const toast = useApp((state) => state.toast)
  const init = useApp((state) => state.init)
  const openVideoPath = useApp((state) => state.openVideoPath)
  const setError = useApp((state) => state.setError)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    if (status) document.body.dataset.platform = status.platform
  }, [status])

  useEffect(() => {
    return window.api.onMenuAction((action) => {
      if (action === 'open-video') void useApp.getState().openVideo()
      if (action === 'settings') useApp.getState().setShowSettings(true)
    })
  }, [])

  useEffect(() => {
    let depth = 0
    const onDragEnter = (event: DragEvent): void => {
      event.preventDefault()
      depth++
      if (event.dataTransfer?.types.includes('Files')) setDragging(true)
    }
    const onDragOver = (event: DragEvent): void => {
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (event: DragEvent): void => {
      event.preventDefault()
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onDrop = (event: DragEvent): void => {
      event.preventDefault()
      depth = 0
      setDragging(false)
      const file = event.dataTransfer?.files?.[0]
      if (!file) return
      const path = window.api.pathForFile(file)
      if (path) void openVideoPath(path)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [openVideoPath])

  if (loading && !status) {
    return (
      <div className="splash">
        <div className="splash-mark">SR</div>
        <div className="splash-text">Speech Review</div>
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div className="app-shell">
      {project ? <Workspace /> : <Welcome />}
      <SettingsDialog />
      <HistoryDialog />

      {error ? (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button className="icon-btn" onClick={() => setError(null)} title="Закрыть">
            ×
          </button>
        </div>
      ) : null}

      {toast ? (
        <div className={`toast toast-${toast.kind}`}>
          <span>{toast.text}</span>
        </div>
      ) : null}

      {dragging ? (
        <div className="drop-overlay">
          <div className="drop-card">
            <div className="drop-icon">↓</div>
            <div>Отпустите видео или аудио</div>
            <div className="muted">MP4, MOV, WebM, MKV, MP3, WAV</div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
