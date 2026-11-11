import { useEffect, useState } from 'react'
import { DEFAULT_RULES } from '@shared/defects'
import { formatBytes } from '@shared/format'
import { MODEL_ORDER, MODEL_SPECS } from '@shared/models'
import {
  EXPORT_FIELDS,
  EXPORT_FIELD_LABELS,
  MAX_CHUNK_TARGET_SEC,
  MIN_CHUNK_TARGET_SEC
} from '@shared/settings'
import type { ExportField, SkipScope } from '@shared/types'
import { useApp } from '../store'

type SettingsTab = 'general' | 'recognition' | 'export'

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: 'Общие' },
  { id: 'recognition', label: 'Распознавание' },
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
  const status = useApp((state) => state.status)
  const downloadingModel = useApp((state) => state.downloadingModel)
  const modelDownload = useApp((state) => state.modelDownload)
  const setShowSettings = useApp((state) => state.setShowSettings)
  const updateSettings = useApp((state) => state.updateSettings)
  const setRules = useApp((state) => state.setRules)
  const downloadModel = useApp((state) => state.downloadModel)
  const refreshStatus = useApp((state) => state.refreshStatus)

  const [tab, setTab] = useState<SettingsTab>('general')

  useEffect(() => {
    if (!show) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setShowSettings(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [show, setShowSettings])

  if (!show) return null

  const spec = MODEL_SPECS[settings.modelId]
  const selectedReady = status?.modelId === settings.modelId && status?.modelReady
  const downloadingThis = downloadingModel && modelDownload?.modelId === settings.modelId
  const rules = settings.rules
  const exportSettings = settings.export
  const playback = settings.playback

  const toggleField = (field: ExportField): void => {
    const selected = new Set(exportSettings.fields)
    if (selected.has(field)) selected.delete(field)
    else selected.add(field)
    if (selected.size === 0) return
    updateSettings({
      export: { fields: EXPORT_FIELDS.filter((item) => selected.has(item)) }
    })
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
            <div className="muted small">Движок, распознавание, просмотр и экспорт</div>
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
                <h3>Просмотр</h3>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={playback.skipEnabled}
                    onChange={(event) =>
                      updateSettings({ playback: { skipEnabled: event.target.checked } })
                    }
                  />
                  Пропускать помеченные места при проигрывании
                </label>
                <div className="form-grid">
                  <label className="field">
                    <span>Что пропускать</span>
                    <select
                      value={playback.skipScope}
                      disabled={!playback.skipEnabled}
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
                  <label className="field">
                    <span>Отступ до, сек</span>
                    <input
                      type="number"
                      min={0}
                      max={5}
                      step={0.05}
                      value={playback.skipBeforeSec}
                      disabled={!playback.skipEnabled}
                      onChange={(event) =>
                        updateSettings({
                          playback: {
                            skipBeforeSec: Math.max(0, Number(event.target.value) || 0)
                          }
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Отступ после, сек</span>
                    <input
                      type="number"
                      min={0}
                      max={5}
                      step={0.05}
                      value={playback.skipAfterSec}
                      disabled={!playback.skipEnabled}
                      onChange={(event) =>
                        updateSettings({
                          playback: {
                            skipAfterSec: Math.max(0, Number(event.target.value) || 0)
                          }
                        })
                      }
                    />
                  </label>
                </div>
                <div className="hint">
                  Отступы оставляют базовую паузу по краям, чтобы вырезанное место не склеивалось
                  вплотную. Видео не перекодируется — переходы выполняются на лету.
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

          {tab === 'recognition' ? (
            <>
              <section className="settings-section">
                <h3>Модель распознавания</h3>
                <div className="model-options">
                  {MODEL_ORDER.map((id) => {
                    const model = MODEL_SPECS[id]
                    const selected = settings.modelId === id
                    return (
                      <button
                        key={id}
                        className={`model-option ${selected ? 'selected' : ''}`}
                        disabled={downloadingModel}
                        onClick={() => updateSettings({ modelId: id })}
                      >
                        <div className="model-option-top">
                          <span>{model.shortLabel}</span>
                          <span className="muted">{formatBytes(model.size)}</span>
                        </div>
                        <div className="model-option-label">{model.label}</div>
                        <div className="model-option-note">{model.note}</div>
                      </button>
                    )
                  })}
                </div>

                <div className="model-current">
                  <div>
                    <div className="model-current-label">{spec.label}</div>
                    <div className="muted small">
                      {selectedReady
                        ? `Скачана · ${formatBytes(status?.modelBytes ?? spec.size)} · SHA-256 проверен`
                        : `Не скачана · нужно ${formatBytes(spec.size)}`}
                    </div>
                  </div>
                  {selectedReady ? (
                    <span className="badge ok">готова</span>
                  ) : (
                    <button
                      className="btn primary"
                      disabled={downloadingThis}
                      onClick={() => void downloadModel(settings.modelId)}
                    >
                      {downloadingThis ? 'Скачиваю…' : 'Скачать модель'}
                    </button>
                  )}
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
                  SHA-256.
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
                <div className="section-title-row">
                  <h3>Правила дефектов</h3>
                  <button className="link-btn" onClick={() => setRules(DEFAULT_RULES)}>
                    сбросить
                  </button>
                </div>

                <div className="form-grid">
                  <label className="field">
                    <span>Пауза от, сек</span>
                    <input
                      type="number"
                      min={0.3}
                      max={5}
                      step={0.1}
                      value={rules.pauseThresholdSec}
                      onChange={(event) =>
                        setRules({ pauseThresholdSec: Number(event.target.value) || 0.3 })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Критичная пауза, сек</span>
                    <input
                      type="number"
                      min={0.5}
                      max={10}
                      step={0.1}
                      value={rules.pauseHighSec}
                      onChange={(event) =>
                        setRules({ pauseHighSec: Number(event.target.value) || 0.5 })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Окно повторов, сек</span>
                    <input
                      type="number"
                      min={0.5}
                      max={10}
                      step={0.5}
                      value={rules.repetitionWindowSec}
                      onChange={(event) =>
                        setRules({ repetitionWindowSec: Number(event.target.value) || 0.5 })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Растяжка, повторов буквы</span>
                    <input
                      type="number"
                      min={2}
                      max={10}
                      step={1}
                      value={rules.elongationMinRepeats}
                      onChange={(event) =>
                        setRules({ elongationMinRepeats: Number(event.target.value) || 2 })
                      }
                    />
                  </label>
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
                <div className="hint">
                  Правила применяются к открытому проекту сразу, пересчитывать транскрипт не нужно.
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
