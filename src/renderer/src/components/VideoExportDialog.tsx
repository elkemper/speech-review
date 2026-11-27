import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDuration } from '@shared/format'
import {
  videoEncoderLabel,
  videoQualityNameLabel,
  videoResolutionLabel
} from '@shared/labels'
import {
  DEFAULT_VIDEO_EXPORT_SETTINGS,
  MAX_VIDEO_CROSSFADE_SEC,
  MIN_VIDEO_CROSSFADE_SEC,
  VIDEO_EXPORT_ENCODERS,
  VIDEO_EXPORT_QUALITIES,
  VIDEO_EXPORT_RESOLUTIONS
} from '@shared/settings'
import type {
  Defect,
  MediaStreamInfo,
  VideoExportProgress,
  VideoExportSettings
} from '@shared/types'
import { buildExportPlan, videoQualityLabel } from '@shared/videoExport'
import { buildCutList, complementRanges } from '../skip'
import { useApp } from '../store'
import { useT, useUiLanguage } from '../i18n'
import { RangeField } from './SettingsRangeField'

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
  const t = useT()
  const lang = useUiLanguage()

  const [options, setOptions] = useState<VideoExportSettings>(() => ({
    ...(settings.videoExport ?? DEFAULT_VIDEO_EXPORT_SETTINGS)
  }))
  const [running, setRunning] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [progress, setProgress] = useState<VideoExportProgress | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [media, setMedia] = useState<MediaStreamInfo | null>(null)
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

  // The summary must match the file, not the raw cut list: the crossfade
  // shortens every join and merges fragments shorter than two fades. One
  // ffprobe gives the frame rate and sample rate, then the same plan the
  // export resolves is built here. Until it answers, the cut-list total stands.
  useEffect(() => {
    const path = project?.video.path
    if (!path) return
    let cancelled = false
    setMedia(null)
    window.api
      .probeVideo(path)
      .then((info) => {
        if (!cancelled) setMedia(info)
      })
      .catch(() => {
        if (!cancelled) setMedia(null)
      })
    return () => {
      cancelled = true
    }
  }, [project?.video.path])

  const plan = useMemo(() => {
    if (!project || !media || !(media.fps > 0) || keep.length === 0) return null
    return buildExportPlan(
      keep,
      media.fps,
      media.sampleRate || 48000,
      options.crossfade ? options.crossfadeSec : 0
    )
  }, [keep, media, project, options.crossfade, options.crossfadeSec])

  const exportedSec = plan ? plan.audioSamples / plan.sampleRate : keepSec
  const cutSec = Math.max(0, (project?.duration ?? 0) - exportedSec)
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
      totalSec: exportedSec,
      message: t('videoExport.prepare')
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
        notify(t('videoExport.exported', { path }), 'success')
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
            <h2>{t('videoExport.title')}</h2>
            <div className="muted small">{t('videoExport.subtitle')}</div>
          </div>
          <button
            className="icon-btn"
            onClick={onClose}
            disabled={running}
            title={running ? t('videoExport.closeTitle') : t('common.close')}
          >
            ×
          </button>
        </header>

        <div className="modal-body">
          <section className="settings-section">
            <h3>{t('videoExport.cutsTitle')}</h3>
            <div className="video-export-summary">
              <span>
                {t('videoExport.cuts')} <strong>{cuts.length}</strong>
              </span>
              <span>
                {t('videoExport.cut')} <strong>{formatDuration(cutSec)}</strong>
              </span>
              <span>
                {t('videoExport.keep')} <strong>{formatDuration(exportedSec)}</strong>
              </span>
            </div>
            {nothingToExport ? (
              <div className="video-export-error">{t('videoExport.nothing')}</div>
            ) : null}
          </section>

          <section className="settings-section">
            <h3>{t('videoExport.options')}</h3>
            <div className="form-grid">
              <label className="field">
                <span>{t('videoExport.resolution')}</span>
                <select
                  value={options.resolution}
                  disabled={running}
                  onChange={(event) =>
                    setOption(
                      'resolution',
                      event.target.value as VideoExportSettings['resolution']
                    )
                  }
                >
                  {VIDEO_EXPORT_RESOLUTIONS.map((resolution) => (
                    <option key={resolution} value={resolution}>
                      {videoResolutionLabel(lang, resolution)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>{t('videoExport.quality')}</span>
                <select
                  value={options.quality}
                  disabled={running}
                  onChange={(event) =>
                    setOption(
                      'quality',
                      event.target.value as VideoExportSettings['quality']
                    )
                  }
                >
                  {VIDEO_EXPORT_QUALITIES.map((quality) => (
                    <option key={quality} value={quality}>
                      {videoQualityNameLabel(lang, quality)} ·{' '}
                      {videoQualityLabel(options.encoder, quality)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="field">
              <span>{t('videoExport.encoder')}</span>
              <select
                value={options.encoder}
                disabled={running}
                onChange={(event) =>
                  setOption(
                    'encoder',
                    event.target.value as VideoExportSettings['encoder']
                  )
                }
              >
                <optgroup label={t('videoExport.softwareGroup')}>
                  {VIDEO_EXPORT_ENCODERS.filter(
                    (encoder) =>
                      encoder === 'h264' || encoder === 'hevc'
                  ).map((encoder) => (
                    <option key={encoder} value={encoder}>
                      {videoEncoderLabel(lang, encoder)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t('videoExport.hardwareGroup')}>
                  {VIDEO_EXPORT_ENCODERS.filter(
                    (encoder) =>
                      encoder === 'h264_videotoolbox' ||
                      encoder === 'hevc_videotoolbox'
                  ).map((encoder) => (
                    <option key={encoder} value={encoder}>
                      {videoEncoderLabel(lang, encoder)}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>

            <div className="field">
              <label className="check">
                <input
                  type="checkbox"
                  checked={options.crossfade}
                  disabled={running}
                  onChange={(event) => setOption('crossfade', event.target.checked)}
                />
                <span>{t('videoExport.crossfade')}</span>
              </label>
              {options.crossfade ? (
                <>
                  <RangeField
                    label={t('videoExport.crossfadeSec')}
                    value={options.crossfadeSec}
                    min={MIN_VIDEO_CROSSFADE_SEC}
                    max={MAX_VIDEO_CROSSFADE_SEC}
                    step={0.01}
                    suffix={t('common.secondsSuffix')}
                    disabled={running}
                    compact
                    ariaLabel={t('videoExport.crossfadeSec')}
                    onChange={(value) => setOption('crossfadeSec', value)}
                  />
                  <div className="muted small">{t('videoExport.crossfadeHint')}</div>
                </>
              ) : null}
            </div>
          </section>

          {running || progress ? (
            <section className="settings-section">
              <h3>{t('videoExport.progress')}</h3>
              <div className="video-export-progress">
                <div className="progress-track">
                  <div style={{ width: `${progress?.percent ?? 0}%` }} />
                </div>
                <div className="progress-meta">
                  <span>{progress?.percent ?? 0}%</span>
                  <span>{progress?.message ?? t('videoExport.prepare')}</span>
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
                {t('videoExport.ready')}
                <div className="path-value" title={result}>
                  {result}
                </div>
              </div>
              <button
                className="btn ghost small"
                onClick={() => void window.api.showItemInFolder(result)}
              >
                {t('videoExport.showInFolder')}
              </button>
            </div>
          ) : null}
        </div>

        <footer className="modal-foot">
          <span className="muted small">
            {t('videoExport.sourceUntouched')}
          </span>
          {running ? (
            <button className="btn ghost" onClick={() => void cancel()} disabled={cancelling}>
              {cancelling ? t('videoExport.cancelling') : t('common.cancel')}
            </button>
          ) : result ? (
            <button className="btn primary" onClick={onClose}>
              {t('common.done')}
            </button>
          ) : (
            <div className="row-actions">
              <button className="btn ghost" onClick={onClose}>
                {t('common.cancel')}
              </button>
              <button
                className="btn primary"
                onClick={() => void start()}
                disabled={nothingToExport}
              >
                {t('videoExport.export')}
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>
  )
}
