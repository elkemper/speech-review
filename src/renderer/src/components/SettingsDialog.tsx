import { useEffect, useState } from 'react'
import { AUTO_DEFECT_TYPES, DEFAULT_RULES } from '@shared/defects'
import { formatBytes } from '@shared/format'
import { MODEL_ORDER, MODEL_SPECS } from '@shared/models'
import {
  DEFAULT_GROUP_PADDING,
  DEFAULT_SKIP_PADDING_BY_TYPE,
  EXPORT_FIELDS,
  EXPORT_FIELD_LABELS,
  MAX_CHUNK_TARGET_SEC,
  MIN_CHUNK_TARGET_SEC
} from '@shared/settings'
import type {
  DefectType,
  ExportField,
  ModelId,
  ModelStateInfo,
  SkipPadding,
  SkipScope
} from '@shared/types'
import { DEFECT_LABELS } from '../defectsUi'
import { useApp } from '../store'

type SettingsTab = 'general' | 'defects' | 'export'

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: 'Общие' },
  { id: 'defects', label: 'Дефекты' },
  { id: 'export', label: 'Экспорт' }
]

const PADDING_TYPES: DefectType[] = [...AUTO_DEFECT_TYPES, 'manual']

function RangeField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  disabled,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  disabled?: boolean
  onChange: (value: number) => void
}) {
  const clampValue = (next: number): number => Math.min(max, Math.max(min, next))
  return (
    <div className={`range-field ${disabled ? 'disabled' : ''}`}>
      <div className="range-head">
        <span className="range-label">{label}</span>
        <span className="range-number">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (Number.isFinite(next)) onChange(clampValue(next))
            }}
          />
          {suffix ? <span className="muted small">{suffix}</span> : null}
        </span>
      </div>
      <input
        className="range-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(clampValue(Number(event.target.value)))}
      />
    </div>
  )
}

function PaddingField({
  label,
  value,
  disabled,
  onChange
}: {
  label: string
  value: SkipPadding
  disabled?: boolean
  onChange: (value: SkipPadding) => void
}) {
  return (
    <div className="padding-field">
      <div className="padding-title">{label}</div>
      <RangeField
        label="до"
        value={value.before}
        min={0}
        max={5}
        step={0.05}
        suffix="с"
        disabled={disabled}
        onChange={(before) => onChange({ ...value, before })}
      />
      <RangeField
        label="после"
        value={value.after}
        min={0}
        max={5}
        step={0.05}
        suffix="с"
        disabled={disabled}
        onChange={(after) => onChange({ ...value, after })}
      />
    </div>
  )
}

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
            <div className="muted small">Движок, модель, распознавание, дефекты и экспорт</div>
          </div>
          <button className="icon-btn" onClick={() => setShowSettings(false)} title="Закрыть">
            ×
          </button>
        </header>

        <div className="settings-tabs" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              className={`settings-tab ${tab === item.id ? 'active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="modal-body">
          {tab === 'general' ? (
            <>
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

          {tab === 'defects' ? (
            <>
              <section className="settings-section">
                <h3>Просмотр</h3>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={playback.skipEnabled}
                    onChange={(event) =>
                      updateSettings({ playback: { skipEnabled: event.target.checked } })
                    }
                  />
                  Пропускать непроверенные дефекты при проигрывании
                </label>
                <label className="field">
                  <span>Что пропускать</span>
                  <select
                    value={playback.skipScope}
                    onChange={(event) =>
                      updateSettings({
                        playback: { skipScope: event.target.value as SkipScope }
                      })
                    }
                  >
                    <option value="all">Все дефекты и метки</option>
                    <option value="marks">Только ручные метки</option>
                  </select>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={settings.hideReviewed}
                    onChange={(event) =>
                      updateSettings({ hideReviewed: event.target.checked })
                    }
                  />
                  Убирать проверенные дефекты из списка полностью
                </label>
                <div className="hint">
                  Проверенные дефекты и метки не пропускаются. Отступы оставляют базовую паузу по
                  краям, чтобы вырезанное место не склеивалось вплотную. Видео не перекодируется.
                </div>
              </section>

              <section className="settings-section">
                <div className="section-title-row">
                  <h3>Отступы при пропуске</h3>
                  <button
                    className="link-btn"
                    onClick={() =>
                      updateSettings({
                        playback: {
                          paddingByType: Object.fromEntries(
                            Object.entries(DEFAULT_SKIP_PADDING_BY_TYPE).map(
                              ([type, padding]) => [type, { ...padding }]
                            )
                          ),
                          groupPadding: { ...DEFAULT_GROUP_PADDING }
                        }
                      })
                    }
                  >
                    сбросить
                  </button>
                </div>
                <div className="hint">
                  Отступы настраиваются отдельно для каждого типа и не зависят от включённого
                  режима пропуска. Для паузы по умолчанию отступов нет.
                </div>
                <div className="padding-grid">
                  {PADDING_TYPES.map((type) => (
                    <PaddingField
                      key={type}
                      label={DEFECT_LABELS[type]}
                      value={
                        playback.paddingByType?.[type] ?? {
                          before: playback.skipBeforeSec,
                          after: playback.skipAfterSec
                        }
                      }
                      onChange={(value) =>
                        updateSettings({
                          playback: {
                            paddingByType: {
                              ...(playback.paddingByType ?? {}),
                              [type]: value
                            }
                          }
                        })
                      }
                    />
                  ))}
                  <PaddingField
                    label="группа дефектов"
                    value={playback.groupPadding ?? DEFAULT_GROUP_PADDING}
                    onChange={(value) =>
                      updateSettings({ playback: { groupPadding: value } })
                    }
                  />
                </div>
                <div className="hint">
                  Если дефекты объединены в группу, применяются отступы группы, а не каждого
                  элемента внутри.
                </div>
              </section>

              <section className="settings-section">
                <div className="section-title-row">
                  <h3>Правила дефектов</h3>
                  <button className="link-btn" onClick={() => setRules(DEFAULT_RULES)}>
                    сбросить
                  </button>
                </div>

                <div className="range-grid">
                  <RangeField
                    label="Пауза от"
                    value={rules.pauseThresholdSec}
                    min={0.3}
                    max={5}
                    step={0.1}
                    suffix="с"
                    onChange={(value) => setRules({ pauseThresholdSec: value })}
                  />
                  <RangeField
                    label="Критичная пауза"
                    value={rules.pauseHighSec}
                    min={0.5}
                    max={10}
                    step={0.1}
                    suffix="с"
                    onChange={(value) => setRules({ pauseHighSec: value })}
                  />
                  <RangeField
                    label="Окно повторов"
                    value={rules.repetitionWindowSec}
                    min={0.5}
                    max={10}
                    step={0.5}
                    suffix="с"
                    onChange={(value) => setRules({ repetitionWindowSec: value })}
                  />
                  <RangeField
                    label="Растяжка, повторов буквы"
                    value={rules.elongationMinRepeats}
                    min={2}
                    max={10}
                    step={1}
                    onChange={(value) => setRules({ elongationMinRepeats: value })}
                  />
                  <RangeField
                    label="Автообъединение: макс. пауза"
                    value={rules.autoGroupGapSec}
                    min={0}
                    max={2}
                    step={0.05}
                    suffix="с"
                    onChange={(value) => setRules({ autoGroupGapSec: value })}
                  />
                </div>

                <label className="check">
                  <input
                    type="checkbox"
                    checked={rules.excludePauseAfterSentenceEnd}
                    onChange={(event) =>
                      setRules({ excludePauseAfterSentenceEnd: event.target.checked })
                    }
                  />
                  Не считать паузой остановку после точки, вопроса или многоточия
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={rules.detectLexicalFillers}
                    onChange={(event) => setRules({ detectLexicalFillers: event.target.checked })}
                  />
                  Искать слова-филлеры: «ну», «вот», «типа», «как бы» и т.п.
                </label>
                <label className="check disabled">
                  <input type="checkbox" disabled />
                  Неразборчивые слова по confidence
                  <span className="badge">в разработке</span>
                </label>

                <details className="settings-advanced">
                  <summary>Минимальная длительность по типам</summary>
                  <div className="hint">
                    Дефект короче указанного значения не попадает в список. Для повтора
                    учитывается длительность повторяемого слова, для паузы — длина тишины.
                    0 — без ограничения.
                  </div>
                  <div className="range-grid">
                    {AUTO_DEFECT_TYPES.map((type) => (
                      <RangeField
                        key={type}
                        label={DEFECT_LABELS[type]}
                        value={rules.minDurationByType?.[type] ?? 0}
                        min={0}
                        max={type === 'pause' ? 10 : 3}
                        step={0.05}
                        suffix="с"
                        onChange={(value) =>
                          setRules({
                            minDurationByType: {
                              ...rules.minDurationByType,
                              [type]: value
                            }
                          })
                        }
                      />
                    ))}
                  </div>
                </details>

                <div className="hint">
                  Правила применяются к открытому проекту сразу, пересчитывать транскрипт не нужно.
                  Автообъединение склеивает соседние дефекты, если между ними нет других слов и
                  пауза не больше указанной; 0 — выключено. Границы выбранного дефекта можно
                  двигать мышкой на таймлайне.
                </div>
              </section>
            </>
          ) : null}

          {tab === 'export' ? (
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
                            fields: ['start_tc', 'end_tc', 'type', 'severity', 'text', 'note']
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
            </>
          ) : null}
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
