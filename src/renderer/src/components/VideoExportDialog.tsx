import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDuration } from '@shared/format'
import {
  DEFAULT_VIDEO_EXPORT_SETTINGS,
  VIDEO_EXPORT_ENCODERS,
  VIDEO_EXPORT_ENCODER_LABELS,
  VIDEO_EXPORT_QUALITIES,
  VIDEO_EXPORT_QUALITY_LABELS,
  VIDEO_EXPORT_RESOLUTIONS,
  VIDEO_EXPORT_RESOLUTION_LABELS
} from '@shared/settings'
import type {
  Defect,
  VideoExportProgress,
  VideoExportSettings
} from '@shared/types'
import { videoQualityLabel } from '@shared/videoExport'
import { buildCutList, complementRanges } from '../skip'
import { useApp } from '../store'

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

export default function VideoExportDialog({
  defects,
  onClose
}: {
  defects: Defect[]
  onClose: () => void
}) {
  const project = useApp((state) => state.project)
  const settings = useApp((state) => state.settings)
  const updateSettings = useApp((state) => state.updateSettings)
  const notify = useApp((state) => state.notify)

  const [options, setOptions] = useState<VideoExportSettings>(() => ({
    ...(settings.videoExport ?? DEFAULT_VIDEO_EXPORT_SETTINGS)
  }))
  const [running, setRunning] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [progress, setProgress] = useState<VideoExportProgress | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const startingRef = useRef(false)

  const exportable = useMemo(
    () => defects.filter((defect) => !defect.dismissed && !defect.candidate),
    [defects]
  )
  const cuts = useMemo(
    () =>
      project
        ? buildCutList(
            exportable,
            settings.playback,
            project.duration,
            project.cutOverrides
          )
        : [],
    [exportable, project, settings.playback]
  )
  const keep = useMemo(
    () => (project ? complementRanges(cuts, project.duration) : []),
    [cuts, project]
  )
  const keepSec = keep.reduce(
    (total, range) => total + Math.max(0, range.end - range.start),
    0
  )
  const cutSec = Math.max(0, (project?.duration ?? 0) - keepSec)
  const nothingToExport = keep.length === 0

  useEffect(() => {
    if (!project) return
    return window.api.onVideoExportProgress((value) => {
      if (value.projectId === project.id) setProgress(value)
    })
  }, [project?.id])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !running) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, running])

  if (!project) return null

  const setOption = <Key extends keyof VideoExportSettings>(
    key: Key,
    value: VideoExportSettings[Key]
  ): void => {
    setOptions((current) => ({ ...current, [key]: value }))
  }

  const start = async (): Promise<void> => {
    if (startingRef.current || running || nothingToExport) return
    startingRef.current = true
    updateSettings({ videoExport: options })
    setRunning(true)
    setCancelling(false)
    setResult(null)
    setError(null)
    setProgress({
      projectId: project.id,
      phase: 'prepare',
      percent: 0,
      processedSec: 0,
      totalSec: keepSec,
      message: 'Подготовка…'
    })

    try {
      const path = await window.api.exportVideo({
        projectId: project.id,
        projectName: project.name,
        videoPath: project.video.path,
        duration: project.duration,
        cuts,
        settings: options
      })
      if (path) {
        setResult(path)
        notify(`Видео экспортировано: ${path}`, 'success')
      } else {
        setProgress(null)
      }
    } catch (caught) {
      const message = cleanError(caught)
      setProgress(null)
      setError(message)
      notify(message, 'error')
    } finally {
      startingRef.current = false
      setRunning(false)
      setCancelling(false)
    }
  }

  const cancel = async (): Promise<void> => {
    if (!running || cancelling) return
    setCancelling(true)
    try {
      await window.api.cancelVideoExport()
    } catch {
      setCancelling(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (!running && event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal video-export-modal">
        <header className="modal-head">
          <div>
            <h2>Экспорт видео</h2>
            <div className="muted small">
              Чистая запись по текущим меткам: все неудалённые дефекты и ручные метки.
            </div>
          </div>
          <button
            className="icon-btn"
            onClick={onClose}
            disabled={running}
            title={running ? 'Дождитесь завершения или отмените экспорт' : 'Закрыть'}
          >
            ×
          </button>
        </header>

        <div className="modal-body">
          <section className="settings-section">
            <h3>Что будет вырезано</h3>
            <div className="video-export-summary">
              <span>
                Вырезов: <strong>{cuts.length}</strong>
              </span>
              <span>
                Вырезано: <strong>{formatDuration(cutSec)}</strong>
              </span>
              <span>
                Останется: <strong>{formatDuration(keepSec)}</strong>
              </span>
            </div>
            {nothingToExport ? (
              <div className="video-export-error">
                Все отмеченные места вырезаны — экспортировать нечего.
              </div>
            ) : null}
          </section>

          <section className="settings-section">
            <h3>Параметры</h3>
            <div className="form-grid">
              <label className="field">
                <span>Разрешение</span>
                <select
                  value={options.resolution}
                  disabled={running || options.copyMode}
                  onChange={(event) =>
                    setOption(
                      'resolution',
                      event.target.value as VideoExportSettings['resolution']
                    )
                  }
                >
                  {VIDEO_EXPORT_RESOLUTIONS.map((resolution) => (
                    <option key={resolution} value={resolution}>
                      {VIDEO_EXPORT_RESOLUTION_LABELS[resolution]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Качество</span>
                <select
                  value={options.quality}
                  disabled={running || options.copyMode}
                  onChange={(event) =>
                    setOption(
                      'quality',
                      event.target.value as VideoExportSettings['quality']
                    )
                  }
                >
                  {VIDEO_EXPORT_QUALITIES.map((quality) => (
                    <option key={quality} value={quality}>
                      {VIDEO_EXPORT_QUALITY_LABELS[quality]} ·{' '}
                      {videoQualityLabel(options.encoder, quality)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="field">
              <span>Энкодер</span>
              <select
                value={options.encoder}
                disabled={running || options.copyMode}
                onChange={(event) =>
                  setOption(
                    'encoder',
                    event.target.value as VideoExportSettings['encoder']
                  )
                }
              >
                <optgroup label="Программные · CRF">
                  {VIDEO_EXPORT_ENCODERS.filter(
                    (encoder) =>
                      encoder === 'h264' || encoder === 'hevc'
                  ).map((encoder) => (
                    <option key={encoder} value={encoder}>
                      {VIDEO_EXPORT_ENCODER_LABELS[encoder]}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Аппаратные · VideoToolbox">
                  {VIDEO_EXPORT_ENCODERS.filter(
                    (encoder) =>
                      encoder === 'h264_videotoolbox' ||
                      encoder === 'hevc_videotoolbox'
                  ).map((encoder) => (
                    <option key={encoder} value={encoder}>
                      {VIDEO_EXPORT_ENCODER_LABELS[encoder]}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <div className="hint">
              {options.encoder === 'h264_videotoolbox' ||
              options.encoder === 'hevc_videotoolbox'
                ? 'VideoToolbox не использует CRF: пресеты передаются в аппаратный энкодер как q:v (1–100, больше — лучше).'
                : 'CRF задаёт постоянное качество: меньше значение — выше качество и размер.'}
            </div>

            <label className="check">
              <input
                type="checkbox"
                checked={options.copyMode}
                disabled={running}
                onChange={(event) => setOption('copyMode', event.target.checked)}
              />
              Без перекодирования
            </label>
            {options.copyMode ? (
              <div className="hint">
                Видео и звук копируются без потери качества, но границы привязываются к
                ключевым кадрам. Рядом с меткой может остаться лишний фрагмент; формат
                файла остаётся как у исходника.
              </div>
            ) : null}
          </section>

          {running || progress ? (
            <section className="settings-section">
              <h3>Прогресс</h3>
              <div className="video-export-progress">
                <div className="progress-track">
                  <div style={{ width: `${progress?.percent ?? 0}%` }} />
                </div>
                <div className="progress-meta">
                  <span>{progress?.percent ?? 0}%</span>
                  <span>{progress?.message ?? 'Подготовка…'}</span>
                  {progress ? (
                    <span>
                      {formatDuration(progress.processedSec)} /{' '}
                      {formatDuration(progress.totalSec)}
                    </span>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {error ? <div className="video-export-error">{error}</div> : null}

          {result ? (
            <div className="video-export-result">
              <div>
                Файл готов:
                <div className="path-value" title={result}>
                  {result}
                </div>
              </div>
              <button
                className="btn ghost small"
                onClick={() => void window.api.showItemInFolder(result)}
              >
                Показать в папке
              </button>
            </div>
          ) : null}
        </div>

        <footer className="modal-foot">
          <span className="muted small">
            Исходный файл не изменяется. Экспорт идёт локально.
          </span>
          {running ? (
            <button className="btn ghost" onClick={() => void cancel()} disabled={cancelling}>
              {cancelling ? 'Отменяю…' : 'Отменить'}
            </button>
          ) : result ? (
            <button className="btn primary" onClick={onClose}>
              Готово
            </button>
          ) : (
            <div className="row-actions">
              <button className="btn ghost" onClick={onClose}>
                Отмена
              </button>
              <button
                className="btn primary"
                onClick={() => void start()}
                disabled={nothingToExport}
              >
                Экспортировать
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>
  )
}
