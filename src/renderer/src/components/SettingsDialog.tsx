import { useEffect, useState } from 'react'
import { formatBytes } from '@shared/format'
import { MODEL_ORDER, MODEL_SPECS } from '@shared/models'
import {
  DEFAULT_EXPORT_FIELDS,
  EXPORT_FIELDS,
  EXPORT_FIELD_LABELS,
  MAX_CHUNK_TARGET_SEC,
  MAX_MINI_TIMELINE_PAD_SEC,
  MAX_WAVEFORM_CONTRAST,
  MIN_CHUNK_TARGET_SEC,
  MIN_MINI_TIMELINE_PAD_SEC,
  MIN_WAVEFORM_CONTRAST
} from '@shared/settings'
import type { ExportField, ModelId, ModelStateInfo } from '@shared/types'
import { useApp } from '../store'
import DefectRulesSection from './DefectRulesSection'
import { RangeField } from './SettingsRangeField'

type SettingsTab = 'general' | 'defects' | 'export'

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: 'Общие' },
  { id: 'defects', label: 'Дефекты' },
  { id: 'export', label: 'Экспорт' }
]

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
  return (
    <div className="path-row">
      <span className={`dot ${ready ? 'ok' : 'bad'}`} />
      <span className="path-label">{label}</span>
      <span className={`path-value ${ready ? '' : 'muted'}`} title={path ?? ''}>
        {path ?? 'не найден'}
      </span>
      <button className="link-btn" disabled={!path} onClick={onReveal}>
        показать
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
  const setShowSettings = useApp((state) => state.setShowSettings)
  const updateSettings = useApp((state) => state.updateSettings)
  const setRules = useApp((state) => state.setRules)
  const downloadModel = useApp((state) => state.downloadModel)
  const refreshStatus = useApp((state) => state.refreshStatus)
  const notify = useApp((state) => state.notify)

  const [tab, setTab] = useState<SettingsTab>('general')
  const [modelStates, setModelStates] = useState<ModelStateInfo[]>([])
  const [deletingModel, setDeletingModel] = useState<ModelId | null>(null)
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
      `Удалить модель ${model.shortLabel}? Файл будет удалён с диска. При необходимости её можно скачать заново.`
    )
    if (!confirmed) return
    setDeletingModel(id)
    try {
      await window.api.deleteModel(id)
      setModelStates(await window.api.getModelStates())
      await refreshStatus()
      notify('Модель удалена', 'success')
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
            <h2>Настройки</h2>
            <div className="muted small">
              {recognitionActive
                ? 'Распознавание выполняется — настройки недоступны'
                : 'Движок, модель, распознавание, дефекты и экспорт'}
            </div>
          </div>
          <button className="icon-btn" onClick={() => setShowSettings(false)} title="Закрыть">
            ×
          </button>
        </header>

        <div
          className={`settings-form ${settingsLocked ? 'is-locked' : ''}`}
          inert={settingsLocked ? true : undefined}
          aria-disabled={settingsLocked}
        >
          <div className="settings-tabs" role="tablist">
            {TABS.map((item) => {
              const tabDisabled =
                settingsLocked || (item.id === 'defects' && !projectOpen)
              return (
                <button
                  key={item.id}
                  role="tab"
                  aria-selected={activeTab === item.id}
                  className={`settings-tab ${activeTab === item.id ? 'active' : ''}`}
                  disabled={tabDisabled}
                  title={
                    item.id === 'defects' && !projectOpen
                      ? 'Откройте проект, чтобы настроить правила дефектов'
                      : undefined
                  }
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              )
            })}
          </div>

          <div className="modal-body">
            {activeTab === 'general' ? (
              <>
                {!projectOpen ? (
                  <div className="hint">
                    Правила дефектов и отступы пропуска доступны после открытия
                    проекта.
                  </div>
                ) : null}
                <section className="settings-section">
                  <div className="section-title-row">
                    <h3>Движок</h3>
                    <button className="link-btn" onClick={() => void refreshStatus()}>
                      проверить
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
                      Не хватает бинарников. Выполните <code>npm run fetch:engine</code> в папке
                      проекта, затем перезапустите приложение.
                    </div>
                  ) : null}
                </section>

                <section className="settings-section">
                  <div className="section-title-row">
                    <h3>Модель распознавания</h3>
                    <span className="muted small">скачанные модели можно удалять</span>
                  </div>
                  <div className="model-options">
                    {MODEL_ORDER.map((id) => {
                      const model = MODEL_SPECS[id]
                      const state = stateById.get(id)
                      const selected = settings.modelId === id
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
                            <span className="muted">{formatBytes(model.size)}</span>
                          </div>
                          <div className="model-option-label">{model.label}</div>
                          <div className="model-option-note">{model.note}</div>
                          <div className="model-option-foot">
                            <span className={`badge ${state?.ready ? 'ok' : ''}`}>
                              {state?.ready ? 'скачана' : 'не скачана'}
                            </span>
                            {state?.ready ? (
                              <button
                                className="link-btn danger"
                                disabled={busy}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void removeModel(id)
                                }}
                              >
                                удалить
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
                          ? `Скачана · ${formatBytes(
                              selectedState?.bytes ?? status?.modelBytes ?? spec.size
                            )} · SHA-256 проверен`
                          : `Не скачана · нужно ${formatBytes(spec.size)}`}
                      </div>
                    </div>
                    <div className="row-actions">
                      {selectedReady ? (
                        <button
                          className="btn ghost small danger"
                          disabled={busy}
                          onClick={() => void removeModel(settings.modelId)}
                        >
                          {deletingModel === settings.modelId ? 'Удаляю…' : 'Удалить модель'}
                        </button>
                      ) : (
                        <button
                          className="btn primary"
                          disabled={busy}
                          onClick={() => void downloadModel(settings.modelId)}
                        >
                          {downloadingThis ? 'Скачиваю…' : 'Скачать модель'}
                        </button>
                      )}
                    </div>
                  </div>

                  {downloadingThis && modelDownload ? (
                    <div className="model-progress">
                      <div className="progress-track">
                        <div style={{ width: `${modelDownload.percent}%` }} />
                      </div>
                      <div className="muted small">{modelDownload.message}</div>
                    </div>
                  ) : null}

                  <div className="hint">
                    Модель хранится в папке приложения и скачивается один раз. Файл проверяется по
                    SHA-256. Удаление освобождает место; перед распознаванием модель нужно будет
                    скачать снова.
                  </div>
                </section>

                <section className="settings-section">
                  <h3>Распознавание</h3>
                  <div className="form-grid">
                    <label className="field">
                      <span>Язык</span>
                      <select
                        value={settings.language}
                        onChange={(event) => updateSettings({ language: event.target.value })}
                      >
                        <option value="ru">Русский</option>
                        <option value="en">English</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Бэкенд</span>
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
                      <span>Фрагмент, минут</span>
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
                  <div className="hint">
                    Смена языка или модели применяется при следующем распознавании. Первый фрагмент
                    всегда короче (до 3 минут), поэтому первые слова появляются раньше. Меньший
                    фрагмент даёт более быстрый отклик, но модель загружается чаще.
                  </div>
                </section>

                <section className="settings-section">
                  <h3>Данные и лицензии</h3>
                  <div className="hint">
                    Запись и транскрипт остаются на этом компьютере. В сеть уходит только загрузка
                    модели с Hugging Face.
                  </div>
                  <div className="hint">
                    CrisperWhisper 2.0 распространяется по Nyra Health Non-Commercial Research
                    License. audio.cpp — Apache-2.0. ffmpeg — GPL-3.0.
                  </div>
                </section>
              </>
            ) : null}

            {activeTab === 'defects' ? (
              <>
                <div className="hint">
                  Правила дефектов и отступы пропуска отменяются через ⌘Z / Ctrl+Z.
                  Пока это окно открыто, история ограничена изменениями, сделанными
                  после его открытия.
                </div>
                <section className="settings-section">
                  <h3>Список дефектов</h3>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={settings.showDismissed}
                      onChange={(event) =>
                        updateSettings({ showDismissed: event.target.checked })
                      }
                    />
                    Показывать удалённые дефекты в списке
                  </label>
                  <div className="hint">
                    Удалённые дефекты и метки остаются тонкой карточкой с кнопкой
                    возврата и не участвуют в пропуске и экспорте. Если галочка снята,
                    карточки скрыты — включите её снова, чтобы вернуть их в список.
                  </div>
                </section>

                <DefectRulesSection
                  rules={rules}
                  playback={playback}
                  setRules={setRules}
                  updateSettings={updateSettings}
                />

                <section className="settings-section">
                  <h3>Таймлайн</h3>
                  <div className="range-grid single">
                    <RangeField
                      label="Контраст осциллограммы"
                      value={settings.waveformContrast}
                      min={MIN_WAVEFORM_CONTRAST}
                      max={MAX_WAVEFORM_CONTRAST}
                      step={5}
                      suffix="%"
                      onChange={(value) => updateSettings({ waveformContrast: value })}
                    />
                  </div>
                  <div className="hint">
                    Поднимает тихую речь относительно громкой: шумовой пол отсекается, а тихие слова
                    становятся заметнее. 0% — линейная осциллограмма, 55% — по умолчанию. Меняется
                    только отображение, запись и транскрипт не затрагиваются.
                  </div>
                </section>

                <section className="settings-section">
                  <h3>Мини-таймлайн</h3>
                  <div className="range-grid single">
                    <RangeField
                      label="Отступ вокруг метки"
                      value={settings.miniTimelinePadSec}
                      min={MIN_MINI_TIMELINE_PAD_SEC}
                      max={MAX_MINI_TIMELINE_PAD_SEC}
                      step={0.5}
                      suffix="с"
                      onChange={(value) => updateSettings({ miniTimelinePadSec: value })}
                    />
                  </div>
                  <div className="hint">
                    Сколько секунд показывать слева и справа от выбранной метки в маленьком
                    таймлайне. По умолчанию ±3 с. Внутри этого окна можно приближать до 400% и
                    прокручивать.
                  </div>
                </section>
              </>
            ) : null}

            {activeTab === 'export' ? (
              <>
                <section className="settings-section">
                  <div className="section-title-row">
                    <h3>Поля CSV</h3>
                    <div className="row-actions">
                      <button
                        className="link-btn"
                        onClick={() =>
                          updateSettings({ export: { fields: [...EXPORT_FIELDS] } })
                        }
                      >
                        все
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
                        основные
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
                        {EXPORT_FIELD_LABELS[field]}
                      </label>
                    ))}
                  </div>
                </section>

                <section className="settings-section">
                  <h3>Формат</h3>
                  <div className="form-grid">
                    <label className="field">
                      <span>Разделитель CSV</span>
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
                        <option value=";">точка с запятой (Excel)</option>
                        <option value=",">запятая</option>
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
                    Выводить строку заголовков
                  </label>
                  <div className="hint">
                    JSON всегда содержит полный набор полей и исходные заметки. Настройки полей
                    применяются к CSV.
                  </div>
                </section>

                <section className="settings-section">
                  <h3>Видео</h3>
                  <div className="hint">
                    Разрешение, качество, энкодер и режим без перекодирования задаются
                    в окне «Экспорт видео» в панели дефектов. Параметры последнего
                    экспорта сохраняются.
                  </div>
                </section>
              </>
            ) : null}
          </div>
        </div>

        <footer className="modal-foot">
          <span className="muted small">
            {status ? `${status.platform} · версия ${status.appVersion}` : ''}
          </span>
          <button className="btn primary" onClick={() => setShowSettings(false)}>
            Готово
          </button>
        </footer>
      </div>
    </div>
  )
}
