import { MODEL_SPECS } from '@shared/models'
import { formatBytes, formatDuration } from '@shared/format'
import { useApp } from '../store'
import BrandMark from './BrandMark'

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`status-pill ${ok ? 'ok' : 'bad'}`}>
      <span className="dot" />
      {label}
    </span>
  )
}

function projectDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export default function Welcome() {
  const status = useApp((state) => state.status)
  const projects = useApp((state) => state.projects)
  const opening = useApp((state) => state.opening)
  const downloadingModel = useApp((state) => state.downloadingModel)
  const modelDownload = useApp((state) => state.modelDownload)
  const openVideo = useApp((state) => state.openVideo)
  const openProject = useApp((state) => state.openProject)
  const deleteProject = useApp((state) => state.deleteProject)
  const setShowSettings = useApp((state) => state.setShowSettings)
  const downloadModel = useApp((state) => state.downloadModel)

  const spec = status ? MODEL_SPECS[status.modelId] : MODEL_SPECS.q8_0
  const downloadingThis = downloadingModel && modelDownload?.modelId === status?.modelId
  const engineReady = Boolean(status?.engineReady && status?.ffmpegReady)
  const allReady = engineReady && Boolean(status?.modelReady)

  return (
    <div className="welcome">
      <header className="titlebar">
        <div className="brand">
          <BrandMark />
          <span className="brand-name">Speech Review</span>
        </div>
        <div className="titlebar-right">
          <StatusPill ok={Boolean(status?.engineReady)} label="движок" />
          <StatusPill ok={Boolean(status?.ffmpegReady)} label="ffmpeg" />
          <StatusPill ok={Boolean(status?.modelReady)} label="модель" />
          <button className="btn ghost small" onClick={() => setShowSettings(true)}>
            Настройки
          </button>
        </div>
      </header>

      <div className="welcome-scroll">
        <section className="hero">
          <div className="eyebrow">Локальный разбор речи</div>
          <h1>
            Найдите оговорки в вебинаре,
            <br />
            не переслушивая его целиком
          </h1>
          <p className="hero-sub">
            CrisperWhisper 2.0 на Apple Silicon распознаёт запись, отмечает филлеры, паузы,
            обрывы и повторы. Клик по слову — переход к нужному месту. Всё считается на этом
            компьютере.
          </p>
          <div className="hero-actions">
            <button className="btn primary big" disabled={opening} onClick={() => void openVideo()}>
              {opening ? 'Открываю…' : 'Открыть запись'}
            </button>
            <button className="btn ghost big" onClick={() => setShowSettings(true)}>
              Настройки движка
            </button>
          </div>
          <div className="drop-hint">или перетащите MP4, MOV, MKV, MP3 или WAV в окно</div>
        </section>

        <section className="engine-grid">
          <article className={`engine-card ${status?.engineReady ? 'ready' : 'missing'}`}>
            <div className="engine-card-top">
              <span className="engine-name">audio.cpp</span>
              <StatusPill ok={Boolean(status?.engineReady)} label={status?.engineReady ? 'готов' : 'нет'} />
            </div>
            <p>Нативный рантайм CrisperWhisper с Metal-ускорением.</p>
            {!status?.engineReady ? (
              <code className="inline-code">npm run fetch:engine</code>
            ) : (
              <div className="engine-path" title={status.enginePath ?? ''}>
                {status.enginePath}
              </div>
            )}
          </article>

          <article className={`engine-card ${status?.ffmpegReady ? 'ready' : 'missing'}`}>
            <div className="engine-card-top">
              <span className="engine-name">ffmpeg</span>
              <StatusPill ok={Boolean(status?.ffmpegReady)} label={status?.ffmpegReady ? 'готов' : 'нет'} />
            </div>
            <p>Извлекает аудио 16 кГц и находит тишину для нарезки.</p>
            {!status?.ffmpegReady ? (
              <code className="inline-code">npm run fetch:engine</code>
            ) : (
              <div className="engine-path" title={status.ffmpegPath ?? ''}>
                {status.ffmpegPath}
              </div>
            )}
          </article>

          <article className={`engine-card ${status?.modelReady ? 'ready' : 'missing'}`}>
            <div className="engine-card-top">
              <span className="engine-name">{spec.shortLabel}</span>
              <StatusPill ok={Boolean(status?.modelReady)} label={status?.modelReady ? 'готова' : 'нет'} />
            </div>
            <p>{spec.label}</p>
            {status?.modelReady ? (
              <div className="engine-path">{formatBytes(status.modelBytes)} · SHA-256 проверен</div>
            ) : (
              <button
                className="btn small"
                disabled={downloadingThis}
                onClick={() => void downloadModel(spec.id)}
              >
                {downloadingThis ? 'Скачиваю…' : `Скачать ${formatBytes(spec.size)}`}
              </button>
            )}
            {downloadingThis && modelDownload ? (
              <div className="mini-progress">
                <div style={{ width: `${modelDownload.percent}%` }} />
              </div>
            ) : null}
          </article>
        </section>

        {!engineReady ? (
          <div className="notice">
            Для первого запуска выполните <code>npm run fetch:engine</code> в папке проекта — скрипт
            скачает audio.cpp и ffmpeg под вашу платформу. Модель скачивается отдельно из приложения.
          </div>
        ) : null}

        {allReady ? (
          <div className="ready-line">
            <span className="dot ok" />
            Всё готово к работе. Обработка идёт локально, интернет нужен только для модели.
          </div>
        ) : null}

        <section className="projects-section">
          <div className="section-head">
            <h2>Проекты</h2>
            <span className="muted">{projects.length}</span>
          </div>

          {projects.length === 0 ? (
            <div className="empty-projects">
              <div className="empty-icon">▶</div>
              <div>Пока пусто. Откройте запись вебинара, и здесь появится проект.</div>
            </div>
          ) : (
            <div className="project-list">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="project-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => void openProject(project.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void openProject(project.id)
                  }}
                >
                  <div className="project-icon">▶</div>
                  <div className="project-info">
                    <div className="project-name">{project.name}</div>
                    <div className="project-meta">
                      {formatDuration(project.duration)} · {projectDate(project.updatedAt)}
                      <span className={`badge ${project.transcriptComplete ? 'ok' : ''}`}>
                        {project.transcriptComplete
                          ? 'транскрипт готов'
                          : project.hasTranscript
                            ? 'транскрипт частичный'
                            : 'без транскрипта'}
                      </span>
                    </div>
                  </div>
                  <button
                    className="icon-btn danger-hover"
                    title="Удалить проект"
                    onClick={(event) => {
                      event.stopPropagation()
                      if (window.confirm(`Удалить проект «${project.name}»?`)) {
                        void deleteProject(project.id)
                      }
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <footer className="welcome-footer">
          <span>Локальная обработка · Electron + audio.cpp</span>
          <span>
            Модель CrisperWhisper 2.0 — Nyra Health Non-Commercial Research License. audio.cpp —
            Apache-2.0.
          </span>
        </footer>
      </div>
    </div>
  )
}
