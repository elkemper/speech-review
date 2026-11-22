import { MODEL_SPECS } from '@shared/models'
import { formatBytes, formatDuration, formatProjectDate } from '@shared/format'
import { useApp } from '../store'
import { useT, useUiLanguage } from '../i18n'
import BrandMark from './BrandMark'

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`status-pill ${ok ? 'ok' : 'bad'}`}>
      <span className="dot" />
      {label}
    </span>
  )
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
  const t = useT()
  const lang = useUiLanguage()

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
          <StatusPill ok={Boolean(status?.engineReady)} label={t('welcome.engineLabel')} />
          <StatusPill ok={Boolean(status?.ffmpegReady)} label="ffmpeg" />
          <StatusPill ok={Boolean(status?.modelReady)} label={t('welcome.modelLabel')} />
          <button className="btn ghost small" onClick={() => setShowSettings(true)}>
            {t('welcome.settings')}
          </button>
        </div>
      </header>

      <div className="welcome-scroll">
        <section className="hero">
          <div className="eyebrow">{t('welcome.eyebrow')}</div>
          <h1>
            {t('welcome.heroLine1')},
            <br />
            {t('welcome.heroLine2')}
          </h1>
          <p className="hero-sub">{t('welcome.intro')}</p>
          <div className="hero-actions">
            <button className="btn primary big" disabled={opening} onClick={() => void openVideo()}>
              {opening ? t('welcome.opening') : t('welcome.open')}
            </button>
            <button className="btn ghost big" onClick={() => setShowSettings(true)}>
              {t('welcome.engineSettings')}
            </button>
          </div>
          <div className="drop-hint">{t('welcome.dropHint')}</div>
        </section>

        <section className="engine-grid">
          <article className={`engine-card ${status?.engineReady ? 'ready' : 'missing'}`}>
            <div className="engine-card-top">
              <span className="engine-name">audio.cpp</span>
              <StatusPill ok={Boolean(status?.engineReady)} label={status?.engineReady ? t('welcome.statusReady') : t(
                  'welcome.statusMissing'
                )} />
            </div>
            <p>{t('welcome.engineDescription')}</p>
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
              <StatusPill ok={Boolean(status?.ffmpegReady)} label={status?.ffmpegReady ? t('welcome.statusReady') : t(
                  'welcome.statusMissing'
                )} />
            </div>
            <p>{t('welcome.ffmpegDescription')}</p>
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
              <StatusPill ok={Boolean(status?.modelReady)} label={status?.modelReady ? t('welcome.statusReadyFem') : t(
                  'welcome.statusMissing'
                )} />
            </div>
            <p>{spec.label}</p>
            {status?.modelReady ? (
              <div className="engine-path">
                {t('welcome.shaChecked', { size: formatBytes(status.modelBytes, lang) })}
              </div>
            ) : (
              <button
                className="btn small"
                disabled={downloadingThis}
                onClick={() => void downloadModel(spec.id)}
              >
                {downloadingThis
                  ? t('welcome.downloading')
                  : t('welcome.downloadSize', { size: formatBytes(spec.size, lang) })}
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
            {t('welcome.fetchEnginePrefix')} <code>npm run fetch:engine</code>{' '}
            {t('welcome.fetchEngineSuffix')}
          </div>
        ) : null}

        {allReady ? (
          <div className="ready-line">
            <span className="dot ok" />
            {t('welcome.allReady')}
          </div>
        ) : null}

        <section className="projects-section">
          <div className="section-head">
            <h2>{t('welcome.projects')}</h2>
            <span className="muted">{projects.length}</span>
          </div>

          {projects.length === 0 ? (
            <div className="empty-projects">
              <div className="empty-icon">▶</div>
              <div>{t('welcome.projectsEmpty')}</div>
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
                      {formatDuration(project.duration)} ·{' '}
                      {formatProjectDate(project.updatedAt, lang)}
                      <span className={`badge ${project.transcriptComplete ? 'ok' : ''}`}>
                        {project.transcriptComplete
                          ? t('welcome.projectReady')
                          : project.hasTranscript
                            ? t('welcome.projectPartial')
                            : t('welcome.projectNoTranscript')}
                      </span>
                    </div>
                  </div>
                  <button
                    className="icon-btn danger-hover"
                    title={t('welcome.deleteProject')}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (window.confirm(t('welcome.deleteConfirm', { name: project.name }))) {
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
          <span>{t('welcome.footer')}</span>
          <span>
            {t('welcome.license')} Apache-2.0.
          </span>
        </footer>
      </div>
    </div>
  )
}
