import { useEffect, useState } from 'react'
import { formatBytes } from '@shared/format'
import { exportFieldLabel, modelNote } from '@shared/labels'
import { BUILTIN_VERSION, MODEL_ORDER, MODEL_SPECS } from '@shared/models'
import {
  DEFAULT_EXPORT_FIELDS,
  EXPORT_FIELDS,
  MAX_CHUNK_TARGET_SEC,
  MAX_MINI_TIMELINE_PAD_SEC,
  MAX_WAVEFORM_CONTRAST,
  MIN_CHUNK_TARGET_SEC,
  MIN_MINI_TIMELINE_PAD_SEC,
  MIN_WAVEFORM_CONTRAST
} from '@shared/settings'
import type {
  ExportField,
  ModelId,
  ModelUpdate,
  ModelStateInfo
} from '@shared/types'
import { useApp } from '../store'
import { useT, useUiLanguage } from '../i18n'
import DefectRulesSection from './DefectRulesSection'
import { RangeField } from './SettingsRangeField'

type SettingsTab = 'general' | 'defects' | 'export'

const TAB_IDS: SettingsTab[] = ['general', 'defects', 'export']

function PathRow({
  label,
  ready,
  path,
  onReveal
}: {
  label: string
  ready: boolean
  path: string | null
  onReveal: () => void
}) {
  const t = useT()
  return (
    <div className="path-row">
      <span className={`dot ${ready ? 'ok' : 'bad'}`} />
      <span className="path-label">{label}</span>
      <span className={`path-value ${ready ? '' : 'muted'}`} title={path ?? ''}>
        {path ?? t('common.notFound')}
      </span>
      <button className="link-btn" disabled={!path} onClick={onReveal}>
        {t('common.show')}
      </button>
    </div>
  )
}

export default function SettingsDialog() {
  const show = useApp((state) => state.showSettings)
  const settings = useApp((state) => state.settings)
  const project = useApp((state) => state.project)
  const status = useApp((state) => state.status)
  const jobId = useApp((state) => state.jobId)
  const downloadingModel = useApp((state) => state.downloadingModel)
  const modelDownload = useApp((state) => state.modelDownload)
  const modelUpdateCheck = useApp((state) => state.modelUpdateCheck)
  const checkingModelUpdates = useApp((state) => state.checkingModelUpdates)
  const setShowSettings = useApp((state) => state.setShowSettings)
  const updateSettings = useApp((state) => state.updateSettings)
  const setRules = useApp((state) => state.setRules)
  const downloadModel = useApp((state) => state.downloadModel)
  const checkModelUpdates = useApp((state) => state.checkModelUpdates)
  const refreshStatus = useApp((state) => state.refreshStatus)
  const notify = useApp((state) => state.notify)
  const t = useT()
  const lang = useUiLanguage()

  const [tab, setTab] = useState<SettingsTab>('general')
  const [modelStates, setModelStates] = useState<ModelStateInfo[]>([])
  const [deletingModel, setDeletingModel] = useState<ModelId | null>(null)
  const setModelUpdateCheck = (value: typeof modelUpdateCheck): void =>
    useApp.setState({ modelUpdateCheck: value })
  const projectOpen = Boolean(project)
  const recognitionActive = Boolean(jobId)
  const settingsLocked = recognitionActive
  const activeTab: SettingsTab = projectOpen || tab !== 'defects' ? tab : 'general'

  useEffect(() => {
    if (!projectOpen && tab === 'defects') setTab('general')
  }, [projectOpen, tab])

  useEffect(() => {
    if (!show) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setShowSettings(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [show, setShowSettings])

  useEffect(() => {
    if (!show) return
    let cancelled = false
    void window.api
      .getModelStates()
      .then((states) => {
        if (!cancelled) setModelStates(states)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [show, status?.modelId, status?.modelReady, downloadingModel, deletingModel])

  if (!show) return null

  const spec = MODEL_SPECS[settings.modelId]
  const stateById = new Map(modelStates.map((state) => [state.modelId, state]))
  const selectedState = stateById.get(settings.modelId)
  const selectedReady =
    selectedState?.ready ??
    Boolean(status?.modelId === settings.modelId && status?.modelReady)
  const downloadingThis = downloadingModel && modelDownload?.modelId === settings.modelId
  const rules = settings.rules
  const exportSettings = settings.export
  const playback = settings.playback
  const busy = downloadingModel || deletingModel !== null || Boolean(jobId)
  const updateByModelId = new Map<ModelId, ModelUpdate>(
    (modelUpdateCheck?.updates ?? []).map((update) => [update.modelId, update])
  )
  const installedVersion = (id: ModelId): string =>
    settings.modelVersions?.[id] ?? BUILTIN_VERSION

  const toggleField = (field: ExportField): void => {
    const selected = new Set(exportSettings.fields)
    if (selected.has(field)) selected.delete(field)
    else selected.add(field)
    if (selected.size === 0) return
    updateSettings({
      export: { fields: EXPORT_FIELDS.filter((item) => selected.has(item)) }
    })
  }

  const removeModel = async (id: ModelId): Promise<void> => {
    if (busy) return
    const model = MODEL_SPECS[id]
    const confirmed = window.confirm(
      t('settings.model.deleteConfirm', { model: model.shortLabel })
    )
    if (!confirmed) return
    setDeletingModel(id)
    try {
      await window.api.deleteModel(id)
      setModelStates(await window.api.getModelStates())
      await refreshStatus()
      setModelUpdateCheck(null)
      notify(t('settings.model.deleted'), 'success')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setDeletingModel(null)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setShowSettings(false)
      }}
    >
      <div className="modal settings-modal">
        <header className="modal-head">
          <div>
            <h2>{t('settings.title')}</h2>
            <div className="muted small">
              {recognitionActive
                ? t('settings.subtitleBusy')
                : t('settings.subtitle')}
            </div>
          </div>
          <button
            className="icon-btn"
            onClick={() => setShowSettings(false)}
            title={t('common.close')}
          >
            ×
          </button>
        </header>

        <div
          className={`settings-form ${settingsLocked ? 'is-locked' : ''}`}
          inert={settingsLocked ? true : undefined}
          aria-disabled={settingsLocked}
        >
          <div className="settings-tabs" role="tablist">
            {TAB_IDS.map((id) => {
              const tabDisabled = settingsLocked || (id === 'defects' && !projectOpen)
              const label =
                id === 'general'
                  ? t('settings.tab.general')
                  : id === 'defects'
                    ? t('settings.tab.defects')
                    : t('settings.tab.export')
              return (
                <button
                  key={id}
                  role="tab"
                  aria-selected={activeTab === id}
                  className={`settings-tab ${activeTab === id ? 'active' : ''}`}
                  disabled={tabDisabled}
                  title={
                    id === 'defects' && !projectOpen
                      ? t('settings.rulesUnavailableHint')
                      : undefined
                  }
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              )
            })}
          </div>

          <div className="modal-body">
            {activeTab === 'general' ? (
              <>
                {!projectOpen ? (
                  <div className="hint">{t('settings.rulesUnavailable')}</div>
                ) : null}
                <section className="settings-section">
                  <h3>{t('settings.interface.title')}</h3>
                  <div className="form-grid">
                    <label className="field">
                      <span>{t('settings.interface.language')}</span>
                      <select
                        value={settings.uiLanguage}
                        onChange={(event) =>
                          updateSettings({
                            uiLanguage: event.target.value === 'en' ? 'en' : 'ru'
                          })
                        }
                      >
                        <option value="ru">Русский</option>
                        <option value="en">English</option>
                      </select>
                    </label>
                  </div>
                  <div className="hint">{t('settings.interface.hint')}</div>
                </section>
                <section className="settings-section">
                  <div className="section-title-row">
                    <h3>{t('settings.engine.title')}</h3>
                    <button className="link-btn" onClick={() => void refreshStatus()}>
                      {t('common.check')}
                    </button>
                  </div>
                  <PathRow
                    label="audio.cpp CLI"
                    ready={Boolean(status?.engineReady)}
                    path={status?.enginePath ?? null}
                    onReveal={() => {
                      if (status?.enginePath) void window.api.showItemInFolder(status.enginePath)
                    }}
                  />
                  <PathRow
                    label="ffmpeg"
                    ready={Boolean(status?.ffmpegReady)}
                    path={status?.ffmpegPath ?? null}
                    onReveal={() => {
                      if (status?.ffmpegPath) void window.api.showItemInFolder(status.ffmpegPath)
                    }}
                  />
                  {!status?.engineReady || !status?.ffmpegReady ? (
                    <div className="notice small">
                      {t('settings.engine.missingPrefix')}{' '}
                      <code>npm run fetch:engine</code> {t('settings.engine.missingSuffix')}
                    </div>
                  ) : null}
                </section>

                <section className="settings-section">
                  <div className="section-title-row">
                    <h3>{t('settings.model.title')}</h3>
                    <div className="row-actions">
                      <button
                        className="link-btn"
                        disabled={busy || checkingModelUpdates}
                        onClick={() => void checkModelUpdates()}
                      >
                        {checkingModelUpdates
                          ? t('settings.model.checkingLabel')
                          : t('settings.model.checkLabel')}
                      </button>
                      <span className="muted small">{t('settings.model.deletableHint')}</span>
                    </div>
                  </div>
                  {modelUpdateCheck ? (
                    <div className="muted small">
                      {!modelUpdateCheck.reachable
                        ? t('settings.model.checkUnreachable')
                        : modelUpdateCheck.updates.length === 0
                          ? t('settings.model.checkUpToDate')
                          : t('settings.model.checkUpdates', {
                              count: modelUpdateCheck.updates.length
                            })}
                    </div>
                  ) : null}
                  <div className="model-options">
                    {MODEL_ORDER.map((id) => {
                      const model = MODEL_SPECS[id]
                      const state = stateById.get(id)
                      const selected = settings.modelId === id
                      const update = updateByModelId.get(id)
                      return (
                        <div
                          key={id}
                          role="button"
                          tabIndex={0}
                          className={`model-option ${selected ? 'selected' : ''}`}
                          onClick={() => {
                            if (!busy) updateSettings({ modelId: id })
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') return
                            event.preventDefault()
                            if (!busy) updateSettings({ modelId: id })
                          }}
                        >
                          <div className="model-option-top">
                            <span>{model.shortLabel}</span>
                            <span className="muted">{formatBytes(model.size, lang)}</span>
                          </div>
                          <div className="model-option-label">{model.label}</div>
                          <div className="model-option-note">{modelNote(lang, id)}</div>
                          <div className="model-option-foot">
                            <span className={`badge ${state?.ready ? 'ok' : ''}`}>
                              {state?.ready
                                ? t('settings.model.downloadedVersion', {
                                    version: installedVersion(id)
                                  })
                                : t('settings.model.notDownloaded')}
                            </span>
                            {update && state?.ready ? (
                              <span className="badge">
                                {t('settings.model.availableVersion', {
                                  version: update.availableVersion
                                })}
                              </span>
                            ) : null}
                            {state?.ready ? (
                              <button
                                className="link-btn danger"
                                disabled={busy}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void removeModel(id)
                                }}
                              >
                                {t('common.delete')}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  <div className="model-current">
                    <div>
                      <div className="model-current-label">{spec.label}</div>
                      <div className="muted small">
                        {selectedReady
                          ? t('settings.model.installedSize', {
                              version: installedVersion(settings.modelId),
                              size: formatBytes(
                                selectedState?.bytes ?? status?.modelBytes ?? spec.size,
                                lang
                              )
                            })
                          : t('settings.model.notInstalledSize', {
                              size: formatBytes(spec.size, lang)
                            })}
                      </div>
                    </div>
                    <div className="row-actions">
                      {selectedReady ? (
                        <button
                          className="btn ghost small danger"
                          disabled={busy}
                          onClick={() => void removeModel(settings.modelId)}
                        >
                          {deletingModel === settings.modelId
                            ? t('settings.model.deleting')
                            : t('settings.model.deleteButton')}
                        </button>
                      ) : (
                        <button
                          className="btn primary"
                          disabled={busy}
                          onClick={() => void downloadModel(settings.modelId)}
                        >
                          {downloadingThis
                            ? t('settings.model.downloading')
                            : t('settings.model.downloadButton')}
                        </button>
                      )}
                    </div>
                  </div>

                  {updateByModelId.get(settings.modelId) && selectedReady ? (
                    <div className="model-current">
                      <div>
                        <div className="model-current-label">
                          {t('settings.model.updateAvailable', {
                            version:
                              updateByModelId.get(settings.modelId)?.availableVersion ?? ''
                          })}
                        </div>
                        <div className="muted small">
                          {updateByModelId.get(settings.modelId)?.installedVersion
                            ? t('settings.model.updateLine', {
                                version:
                                  updateByModelId.get(settings.modelId)?.installedVersion ?? '',
                                size: formatBytes(
                                  updateByModelId.get(settings.modelId)?.size ?? spec.size,
                                  lang
                                )
                              })
                            : t('settings.model.unknownVersion')}
                        </div>
                      </div>
                      <div className="row-actions">
                        <button
                          className="btn primary"
                          disabled={busy}
                          onClick={() => void downloadModel(settings.modelId)}
                        >
                          {t('settings.model.updateButton')}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {downloadingThis && modelDownload ? (
                    <div className="model-progress">
                      <div className="progress-track">
                        <div style={{ width: `${modelDownload.percent}%` }} />
                      </div>
                      <div className="muted small">{modelDownload.message}</div>
                    </div>
                  ) : null}

                  <div className="hint">{t('settings.model.storageHint')}</div>
                </section>

                <section className="settings-section">
                  <h3>{t('settings.recognition.title')}</h3>
                  <div className="form-grid">
                    <label className="field">
                      <span>{t('settings.recognition.language')}</span>
                      <select
                        value={settings.language}
                        onChange={(event) => updateSettings({ language: event.target.value })}
                      >
                        <option value="ru">Русский</option>
                        <option value="en">English</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>{t('settings.recognition.backend')}</span>
                      <select
                        value={settings.backend}
                        onChange={(event) =>
                          updateSettings({ backend: event.target.value as 'metal' | 'cpu' })
                        }
                      >
                        <option value="metal">Metal (Apple Silicon)</option>
                        <option value="cpu">CPU</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>{t('settings.recognition.chunk')}</span>
                      <input
                        type="number"
                        min={MIN_CHUNK_TARGET_SEC / 60}
                        max={MAX_CHUNK_TARGET_SEC / 60}
                        step={1}
                        value={Math.round(settings.chunkTargetSec / 60)}
                        onChange={(event) =>
                          updateSettings({
                            chunkTargetSec: Math.round(
                              Math.min(
                                MAX_CHUNK_TARGET_SEC,
                                Math.max(
                                  MIN_CHUNK_TARGET_SEC,
                                  (Number(event.target.value) || 2) * 60
                                )
                              )
                            )
                          })
                        }
                      />
                    </label>
                  </div>
                  <div className="hint">{t('settings.recognition.hint')}</div>
                </section>

                <section className="settings-section">
                  <h3>{t('settings.data.title')}</h3>
                  <div className="hint">{t('settings.data.privacy')}</div>
                  <div className="hint">
                    {t('settings.data.license')} audio.cpp — Apache-2.0. ffmpeg — GPL-3.0.
                  </div>
                </section>
              </>
            ) : null}

            {activeTab === 'defects' ? (
              <>
                <div className="hint">{t('settings.historyHint')}</div>
                <section className="settings-section">
                  <h3>{t('settings.dismissed.title')}</h3>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={settings.showDismissed}
                      onChange={(event) =>
                        updateSettings({ showDismissed: event.target.checked })
                      }
                    />
                    {t('settings.dismissed.show')}
                  </label>
                  <div className="hint">{t('settings.dismissed.hint')}</div>
                </section>

                <DefectRulesSection
                  rules={rules}
                  playback={playback}
                  language={settings.language}
                  setRules={setRules}
                  updateSettings={updateSettings}
                />

                <section className="settings-section">
                  <h3>{t('settings.timeline.title')}</h3>
                  <div className="range-grid single">
                    <RangeField
                      label={t('settings.timeline.contrast')}
                      value={settings.waveformContrast}
                      min={MIN_WAVEFORM_CONTRAST}
                      max={MAX_WAVEFORM_CONTRAST}
                      step={5}
                      suffix="%"
                      onChange={(value) => updateSettings({ waveformContrast: value })}
                    />
                  </div>
                  <div className="hint">{t('settings.timeline.contrastHint')}</div>
                </section>

                <section className="settings-section">
                  <h3>{t('settings.miniTimeline.title')}</h3>
                  <div className="range-grid single">
                    <RangeField
                      label={t('settings.miniTimeline.pad')}
                      value={settings.miniTimelinePadSec}
                      min={MIN_MINI_TIMELINE_PAD_SEC}
                      max={MAX_MINI_TIMELINE_PAD_SEC}
                      step={0.5}
                      suffix={t('common.secondsSuffix')}
                      onChange={(value) => updateSettings({ miniTimelinePadSec: value })}
                    />
                  </div>
                  <div className="hint">{t('settings.miniTimeline.hint')}</div>
                </section>
              </>
            ) : null}

            {activeTab === 'export' ? (
              <>
                <section className="settings-section">
                  <div className="section-title-row">
                    <h3>{t('settings.export.fields.title')}</h3>
                    <div className="row-actions">
                      <button
                        className="link-btn"
                        onClick={() =>
                          updateSettings({ export: { fields: [...EXPORT_FIELDS] } })
                        }
                      >
                        {t('settings.export.fields.all')}
                      </button>
                      <button
                        className="link-btn"
                        onClick={() =>
                          updateSettings({
                            export: {
                              fields: [...DEFAULT_EXPORT_FIELDS]
                            }
                          })
                        }
                      >
                        {t('settings.export.fields.main')}
                      </button>
                    </div>
                  </div>
                  <div className="export-fields">
                    {EXPORT_FIELDS.map((field) => (
                      <label key={field} className="check export-field">
                        <input
                          type="checkbox"
                          checked={exportSettings.fields.includes(field)}
                          onChange={() => toggleField(field)}
                        />
                        {exportFieldLabel(lang, field)}
                      </label>
                    ))}
                  </div>
                </section>

                <section className="settings-section">
                  <h3>{t('settings.export.format.title')}</h3>
                  <div className="form-grid">
                    <label className="field">
                      <span>{t('settings.export.delimiter')}</span>
                      <select
                        value={exportSettings.delimiter}
                        onChange={(event) =>
                          updateSettings({
                            export: {
                              delimiter: event.target.value === ',' ? ',' : ';'
                            }
                          })
                        }
                      >
                        <option value=";">
                          {t('settings.export.delimiter.semicolon')}
                        </option>
                        <option value=",">{t('settings.export.delimiter.comma')}</option>
                      </select>
                    </label>
                  </div>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={exportSettings.includeHeader}
                      onChange={(event) =>
                        updateSettings({
                          export: { includeHeader: event.target.checked }
                        })
                      }
                    />
                    {t('settings.export.header')}
                  </label>
                  <div className="hint">{t('settings.export.jsonHint')}</div>
                </section>

                <section className="settings-section">
                  <h3>{t('settings.video.title')}</h3>
                  <div className="hint">{t('settings.video.hint')}</div>
                </section>
              </>
            ) : null}
          </div>
        </div>

        <footer className="modal-foot">
          <span className="muted small">
            {status
              ? t('settings.footer', {
                  platform: status.platform,
                  version: status.appVersion
                })
              : ''}
          </span>
          <button className="btn primary" onClick={() => setShowSettings(false)}>
            {t('common.done')}
          </button>
        </footer>
      </div>
    </div>
  )
}
