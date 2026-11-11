import { useMemo } from 'react'
import { detectDefects } from '@shared/defects'
import { formatDuration, formatTimecode } from '@shared/format'
import { MODEL_SPECS } from '@shared/models'
import type { Defect, TranscribeProgress } from '@shared/types'
import { useApp } from '../store'
import { useHotkeys } from '../hooks/useHotkeys'
import Player from './Player'
import Timeline from './Timeline'
import Transcript from './Transcript'
import DefectPanel from './DefectPanel'

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

export default function Workspace() {
  const project = useApp((state) => state.project)
  const status = useApp((state) => state.status)
  const progress = useApp((state) => state.progress)
  const jobId = useApp((state) => state.jobId)
  const closeProject = useApp((state) => state.closeProject)
  const startTranscription = useApp((state) => state.startTranscription)
  const cancelTranscription = useApp((state) => state.cancelTranscription)
  const setShowSettings = useApp((state) => state.setShowSettings)
  const settings = useApp((state) => state.settings)

  const defects = useMemo<Defect[]>(() => {
    if (!project?.transcript) return []
    return detectDefects(project.transcript, project.rules, project.marks).map((defect) => ({
      ...defect,
      reviewed: project.reviewedDefectIds.includes(defect.id),
      note: project.defectNotes[defect.id] ?? ''
    }))
  }, [
    project?.transcript,
    project?.rules,
    project?.marks,
    project?.reviewedDefectIds,
    project?.defectNotes
  ])

  useHotkeys(defects)

  if (!project) return null

  const spec = MODEL_SPECS[settings.modelId]
  const modelReady = status?.modelReady && status.modelId === settings.modelId
  const words = project.transcript?.words.length ?? 0
  const unreviewed = defects.filter((defect) => !defect.reviewed).length

  const onTranscribe = (): void => {
    if (project.transcript) {
      const confirmed = window.confirm(
        'Перераспознать запись? Текущий транскрипт и отметки «проверено» будут заменены. Ручные метки сохранятся.'
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
            {project.transcript ? ` · ${unreviewed} непроверенных` : ''}
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
          <button className="btn ghost small" onClick={() => setShowSettings(true)}>
            Настройки
          </button>
          <button className="btn small" disabled={Boolean(jobId)} onClick={onTranscribe}>
            {project.transcript ? 'Распознать заново' : 'Распознать'}
          </button>
        </div>
      </header>

      <div className="workspace-body">
        <main className="workspace-main">
          <Player defects={defects} />
          <Timeline defects={defects} />

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
            <Transcript defects={defects} />
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

        <DefectPanel defects={defects} />
      </div>

      <footer className="hotkeys-bar">
        <span><kbd>Space</kbd> играть</span>
        <span><kbd>←</kbd><kbd>→</kbd> ±2 c</span>
        <span><kbd>[</kbd><kbd>]</kbd> дефект</span>
        <span><kbd>R</kbd> проверено</span>
        <span><kbd>M</kbd> метка</span>
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
