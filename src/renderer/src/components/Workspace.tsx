import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { applyDefectOverrides, detectDefectsWithCandidates, sortDefects } from '@shared/defects'
import { formatDuration, formatTimecode } from '@shared/format'
import { MODEL_SPECS } from '@shared/models'
import type { Defect, TranscribeProgress } from '@shared/types'
import { useApp } from '../store'
import { canRedo, canUndo } from '../history'
import { useHotkeys } from '../hooks/useHotkeys'
import Player from './Player'
import Timeline from './Timeline'
import Transcript from './Transcript'
import DefectPanel from './DefectPanel'
import Bookmarks from './Bookmarks'

const STEPS: Array<{ phase: TranscribeProgress['phase']; label: string }> = [
  { phase: 'prepare', label: 'Подготовка' },
  { phase: 'audio', label: 'Аудио' },
  { phase: 'silence', label: 'Паузы' },
  { phase: 'peaks', label: 'Осциллограмма' },
  { phase: 'transcribe', label: 'Распознавание' },
  { phase: 'merge', label: 'Сборка' },
  { phase: 'done', label: 'Готово' }
]

const PHASE_LABELS = Object.fromEntries(
  STEPS.map((step) => [step.phase, step.label])
) as Record<TranscribeProgress['phase'], string>

function phaseIndex(phase: TranscribeProgress['phase']): number {
  const index = STEPS.findIndex((step) => step.phase === phase)
  return index < 0 ? STEPS.length : index
}

function formatEta(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return ''
  if (seconds < 60) return `~${Math.max(1, Math.round(seconds))} c`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `~${minutes} мин${rest > 0 ? ` ${rest} c` : ''}`
}

function readStoredNumber(key: string, fallback: number, min: number, max: number): number {
  const stored = Number(window.localStorage.getItem(key))
  if (!Number.isFinite(stored) || stored <= 0) return fallback
  return Math.min(max, Math.max(min, stored))
}

const VIDEO_MIN = 140
const TIMELINE_MIN = 80

export default function Workspace() {
  const project = useApp((state) => state.project)
  const activeDefectId = useApp((state) => state.activeDefectId)
  const status = useApp((state) => state.status)
  const progress = useApp((state) => state.progress)
  const jobId = useApp((state) => state.jobId)
  const closeProject = useApp((state) => state.closeProject)
  const startTranscription = useApp((state) => state.startTranscription)
  const cancelTranscription = useApp((state) => state.cancelTranscription)
  const setShowSettings = useApp((state) => state.setShowSettings)
  const setShowHistory = useApp((state) => state.setShowHistory)
  const settings = useApp((state) => state.settings)
  const history = useApp((state) => state.history)
  const undo = useApp((state) => state.undo)
  const redo = useApp((state) => state.redo)

  const [panelWidth, setPanelWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem('sr.panelWidth'))
    return Number.isFinite(stored) && stored >= 280 ? stored : 430
  })
  const [panelVisible, setPanelVisible] = useState(
    () => window.localStorage.getItem('sr.panelVisible') !== '0'
  )
  const [videoHeight, setVideoHeight] = useState(() =>
    readStoredNumber('sr.videoHeight', 300, VIDEO_MIN, 900)
  )
  const [timelineHeight, setTimelineHeight] = useState(() =>
    readStoredNumber('sr.timelineHeight', 120, TIMELINE_MIN, 420)
  )
  const [showBookmarks, setShowBookmarks] = useState(false)
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const rowResizeRef = useRef<{
    kind: 'video' | 'timeline'
    startY: number
    startHeight: number
  } | null>(null)

  useEffect(() => {
    window.localStorage.setItem('sr.panelWidth', String(Math.round(panelWidth)))
  }, [panelWidth])

  useEffect(() => {
    window.localStorage.setItem('sr.panelVisible', panelVisible ? '1' : '0')
  }, [panelVisible])

  useEffect(() => {
    window.localStorage.setItem('sr.videoHeight', String(Math.round(videoHeight)))
  }, [videoHeight])

  useEffect(() => {
    window.localStorage.setItem('sr.timelineHeight', String(Math.round(timelineHeight)))
  }, [timelineHeight])

  const startResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    resizeRef.current = { startX: event.clientX, startWidth: panelWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const start = resizeRef.current
    if (!start) return
    const max = Math.max(320, Math.min(760, window.innerWidth - 420))
    const next = Math.min(max, Math.max(280, start.startWidth + start.startX - event.clientX))
    setPanelWidth(next)
  }

  const endResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    resizeRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const startRowResize = (
    kind: 'video' | 'timeline',
    event: ReactPointerEvent<HTMLDivElement>
  ): void => {
    event.preventDefault()
    rowResizeRef.current = {
      kind,
      startY: event.clientY,
      startHeight: kind === 'video' ? videoHeight : timelineHeight
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveRowResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const start = rowResizeRef.current
    if (!start) return
    const delta = event.clientY - start.startY
    const max = Math.max(VIDEO_MIN + 40, Math.round(window.innerHeight * 0.75))
    if (start.kind === 'video') {
      const room = Math.max(VIDEO_MIN, window.innerHeight - timelineHeight - 260)
      setVideoHeight(Math.min(max, room, Math.max(VIDEO_MIN, start.startHeight + delta)))
    } else {
      const room = Math.max(TIMELINE_MIN, window.innerHeight - videoHeight - 220)
      setTimelineHeight(
        Math.min(420, room, Math.max(TIMELINE_MIN, start.startHeight + delta))
      )
    }
  }

  const endRowResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    rowResizeRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const promotedIds = useMemo<string[]>(() => {
    if (!project) return []
    return [
      ...Object.keys(project.defectOverrides ?? {}),
      ...project.confirmedDefectIds,
      ...project.dismissedDefectIds,
      ...Object.keys(project.defectNotes ?? {})
    ].filter((id) => id.startsWith('auto-'))
  }, [
    project?.defectOverrides,
    project?.confirmedDefectIds,
    project?.dismissedDefectIds,
    project?.defectNotes
  ])

  const detection = useMemo(() => {
    if (!project?.transcript) return { defects: [] as Defect[], candidates: [] }
    return detectDefectsWithCandidates(
      project.transcript,
      project.rules,
      project.marks,
      {
        dismissedIds: project.dismissedDefectIds,
        dismissedMarks: project.dismissedMarks,
        promotedIds
      }
    )
  }, [
    project?.transcript,
    project?.rules,
    project?.marks,
    project?.dismissedDefectIds,
    project?.dismissedMarks,
    promotedIds
  ])

  // Disabled types stay off; only the minimum-duration candidates are revealed.
  const candidates = useMemo(
    () => detection.candidates.filter((candidate) => candidate.reason === 'min-duration'),
    [detection.candidates]
  )

  const revealedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.id === activeDefectId) ?? null,
    [candidates, activeDefectId]
  )

  const defects = useMemo<Defect[]>(() => {
    if (!project) return []
    const confirmedIds = new Set(project.confirmedDefectIds)
    const dismissedIds = new Set(project.dismissedDefectIds)
    const base = applyDefectOverrides(detection.defects, project.defectOverrides).map(
      (defect) => {
        const groupDismissed =
          defect.groupIds && defect.groupIds.length > 0
            ? defect.groupIds.every((id) => dismissedIds.has(id))
            : false
        const dismissed = defect.dismissed || dismissedIds.has(defect.id) || groupDismissed
        const groupConfirmed =
          defect.groupIds && defect.groupIds.length > 0
            ? defect.groupIds.every((id) => confirmedIds.has(id))
            : false
        return {
          ...defect,
          dismissed,
          confirmed: !dismissed && (confirmedIds.has(defect.id) || groupConfirmed),
          note: project.defectNotes[defect.id] ?? defect.note
        }
      }
    )
    if (!revealedCandidate) return base

    const { reason: _reason, measuredSec: _measuredSec, ...candidate } = revealedCandidate
    return sortDefects([
      ...base,
      {
        ...candidate,
        candidate: true,
        note: project.defectNotes[candidate.id] ?? candidate.note
      }
    ])
  }, [
    detection.defects,
    revealedCandidate,
    project?.defectOverrides,
    project?.confirmedDefectIds,
    project?.dismissedDefectIds,
    project?.defectNotes
  ])

  useHotkeys(defects)

  if (!project) return null

  const spec = MODEL_SPECS[settings.modelId]
  const modelReady = status?.modelReady && status.modelId === settings.modelId
  const words = project.transcript?.words.length ?? 0
  const unconfirmed = defects.filter(
    (defect) => !defect.dismissed && !defect.confirmed && !defect.candidate
  ).length

  const onTranscribe = (): void => {
    if (project.transcript) {
      const confirmed = window.confirm(
        'Перераспознать запись? Транскрипт, подтверждения, заметки и удалённые автоматические дефекты будут сброшены. Ручные метки, включая удалённые, сохранятся.'
      )
      if (!confirmed) return
    }
    void startTranscription()
  }

  return (
    <div className="workspace">
      <header className="titlebar workspace-titlebar">
        <button className="btn ghost small" onClick={() => void closeProject()}>
          ← Проекты
        </button>
        <div className="workspace-title">
          <div className="workspace-name" title={project.video.path}>
            {project.name}
          </div>
          <div className="workspace-meta">
            {formatDuration(project.duration)} · {project.transcript ? `${words} слов` : 'без транскрипта'}
            {project.transcript ? ` · ${unconfirmed} неподтверждённых` : ''}
            {project.transcript && !project.transcriptComplete ? (
              <span className="badge live small-badge">частичный</span>
            ) : null}
          </div>
        </div>
        <div className="workspace-actions">
          <span className="badge">{spec.shortLabel}</span>
          <span className="badge">{settings.language.toUpperCase()}</span>
          {progress ? (
            <span className="badge live">
              {PHASE_LABELS[progress.phase]}
              {progress.phase === 'transcribe' ? ` · ${progress.percent}%` : '…'}
            </span>
          ) : null}
          <button
            className="btn ghost small"
            onClick={undo}
            disabled={!canUndo(history)}
            title="Отменить (⌘Z / Ctrl+Z)"
          >
            ↶
          </button>
          <button
            className="btn ghost small"
            onClick={redo}
            disabled={!canRedo(history)}
            title="Повторить (⇧⌘Z / Ctrl+Y)"
          >
            ↷
          </button>
          <button
            className="btn ghost small"
            onClick={() => setShowHistory(true)}
            title="История действий"
          >
            История
          </button>
          <button
            className={`btn ghost small ${showBookmarks ? 'active' : ''}`}
            onClick={() => setShowBookmarks((value) => !value)}
            title="Закладки — вернуться к месту, где остановились (B)"
          >
            🔖 {(project.bookmarks ?? []).length}
          </button>
          {!panelVisible ? (
            <button className="btn ghost small" onClick={() => setPanelVisible(true)}>
              Дефекты
            </button>
          ) : null}
          <button className="btn ghost small" onClick={() => setShowSettings(true)}>
            Настройки
          </button>
          <button className="btn small" disabled={Boolean(jobId)} onClick={onTranscribe}>
            {project.transcript ? 'Распознать заново' : 'Распознать'}
          </button>
        </div>
      </header>

      {showBookmarks ? <Bookmarks onClose={() => setShowBookmarks(false)} /> : null}

      <div
        className="workspace-body"
        style={{
          gridTemplateColumns: panelVisible
            ? `minmax(0, 1fr) 6px ${Math.round(panelWidth)}px`
            : 'minmax(0, 1fr)'
        }}
      >
        <main className="workspace-main">
          <Player defects={defects} videoHeight={videoHeight} />
          <div
            className="row-splitter"
            onPointerDown={(event) => startRowResize('video', event)}
            onPointerMove={moveRowResize}
            onPointerUp={endRowResize}
            onPointerCancel={endRowResize}
            title="Потяните, чтобы изменить высоту окна просмотра"
          />
          <Timeline defects={defects} height={timelineHeight} />
          <div
            className="row-splitter"
            onPointerDown={(event) => startRowResize('timeline', event)}
            onPointerMove={moveRowResize}
            onPointerUp={endRowResize}
            onPointerCancel={endRowResize}
            title="Потяните, чтобы изменить высоту таймлайна"
          />

          {progress && project.transcript ? (
            <div className="progress-banner">
              <div className="progress-banner-top">
                <span>{progress.message}</span>
                <span>
                  {progress.phase === 'transcribe'
                    ? `${progress.percent}%${
                        progress.etaSec !== undefined
                          ? ` · осталось ${formatEta(progress.etaSec)}`
                          : ''
                      }`
                    : PHASE_LABELS[progress.phase]}
                </span>
              </div>
              <div className={`progress-track ${progress.phase === 'transcribe' ? '' : 'indeterminate'}`}>
                <div
                  style={{
                    width:
                      progress.phase === 'transcribe' ? `${progress.percent}%` : '35%'
                  }}
                />
              </div>
              <button className="btn ghost small" onClick={() => void cancelTranscription()}>
                Отменить
              </button>
            </div>
          ) : null}

          {project.transcript ? (
            <Transcript defects={defects} candidates={candidates} />
          ) : progress ? (
            <ProgressCard progress={progress} onCancel={() => void cancelTranscription()} />
          ) : (
            <StartCard
              duration={project.duration}
              modelReady={Boolean(modelReady)}
              modelLabel={spec.label}
              onStart={onTranscribe}
              onSettings={() => setShowSettings(true)}
            />
          )}
        </main>

        {panelVisible ? (
          <>
            <div
              className="panel-splitter"
              onPointerDown={startResize}
              onPointerMove={moveResize}
              onPointerUp={endResize}
              onPointerCancel={endResize}
              title="Перетащите, чтобы изменить ширину панели"
            />
            <DefectPanel defects={defects} onHide={() => setPanelVisible(false)} />
          </>
        ) : null}
      </div>

      <footer className="hotkeys-bar">
        <span><kbd>Space</kbd> играть</span>
        <span><kbd>←</kbd><kbd>→</kbd> ±2 c</span>
        <span><kbd>[</kbd><kbd>]</kbd> дефект</span>
        <span><kbd>Enter</kbd> подтвердить</span>
        <span><kbd>R</kbd> удалить</span>
        <span><kbd>⇧Enter</kbd>/<kbd>⇧R</kbd> выделение</span>
        <span><kbd>M</kbd> метка</span>
        <span><kbd>B</kbd> закладка</span>
        <span><kbd>L</kbd> цикл</span>
        <span><kbd>1</kbd>–<kbd>6</kbd> скорость</span>
        <span className="hotkeys-spacer" />
        <span>{formatTimecode(project.duration)}</span>
      </footer>
    </div>
  )
}

function ProgressCard({
  progress,
  onCancel
}: {
  progress: TranscribeProgress
  onCancel: () => void
}) {
  const current = phaseIndex(progress.phase)
  const isTranscribe = progress.phase === 'transcribe'
  return (
    <div className="start-panel">
      <div className="start-card">
        <div className="start-eyebrow">Идёт обработка</div>
        <h2>{PHASE_LABELS[progress.phase]}</h2>
        <p className="muted">{progress.message}</p>

        <ol className="progress-steps">
          {STEPS.map((step, index) => (
            <li
              key={step.phase}
              className={index < current ? 'done' : index === current ? 'active' : ''}
            >
              <span className="step-dot" />
              {step.label}
            </li>
          ))}
        </ol>

        {isTranscribe ? (
          <div className="big-progress">
            <div style={{ width: `${progress.percent}%` }} />
          </div>
        ) : (
          <div className="big-progress indeterminate">
            <div style={{ width: '35%' }} />
          </div>
        )}

        <div className="progress-meta">
          {isTranscribe ? <span>{progress.percent}%</span> : <span>этап без процента</span>}
          {progress.chunks ? (
            <span>
              фрагмент {progress.chunk ?? 0} из {progress.chunks}
            </span>
          ) : null}
          {isTranscribe && progress.etaSec !== undefined ? (
            <span>осталось {formatEta(progress.etaSec)}</span>
          ) : null}
          {isTranscribe && progress.totalSec ? (
            <span>
              {Math.round(progress.processedSec ?? 0)} / {Math.round(progress.totalSec)} c
            </span>
          ) : null}
        </div>
        <div className="start-actions">
          <button className="btn ghost" onClick={onCancel}>
            Отменить
          </button>
        </div>
        <p className="hint">
          Готовые фрагменты появляются в транскрипте сразу. Можно переключиться в другое окно:
          обработка идёт в фоне. Не закрывайте приложение до завершения.
        </p>
      </div>
    </div>
  )
}

function StartCard({
  duration,
  modelReady,
  modelLabel,
  onStart,
  onSettings
}: {
  duration: number
  modelReady: boolean
  modelLabel: string
  onStart: () => void
  onSettings: () => void
}) {
  const estimate = Math.max(1, Math.round((duration / 60) * 0.2))
  return (
    <div className="start-panel">
      <div className="start-card">
        <div className="start-eyebrow">Транскрипт ещё не готов</div>
        <h2>Разобрать запись</h2>
        <p>
          Приложение извлечёт аудио, нарежет его по паузам и распознает речь моделью{' '}
          <strong>{modelLabel}</strong>. Затем отметит филлеры, паузы, обрывы и повторы.
        </p>
        <ul className="start-list">
          <li>Обработка локальная, запись никуда не отправляется.</li>
          <li>Ориентировочно {estimate} мин на Apple Silicon M4 Pro.</li>
          <li>Клик по слову в транскрипте сразу перематывает видео.</li>
        </ul>
        <div className="start-actions">
          {modelReady ? (
            <button className="btn primary big" onClick={onStart}>
              Распознать запись
            </button>
          ) : (
            <button className="btn primary big" onClick={onSettings}>
              Сначала скачать модель
            </button>
          )}
        </div>
        <p className="hint">
          Если запись длинная, приложение обрабатывает её фрагментами по 5–15 минут и сохраняет
          прогресс после каждого фрагмента.
        </p>
      </div>
    </div>
  )
}
