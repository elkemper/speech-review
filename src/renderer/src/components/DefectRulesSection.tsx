import { Fragment } from 'react'
import { DEFAULT_GROUP_PADDING, DEFAULT_SKIP_PADDING_BY_TYPE } from '@shared/settings'
import { DEFAULT_RULES } from '@shared/defects'
import type { DefectRules, DefectType, PlaybackSettings, SkipPadding } from '@shared/types'
import { DEFECT_LABELS } from '../defectsUi'
import { InlinePadding, PaddingField, RangeField } from './SettingsRangeField'

/** Pause is deliberately the last row: it carries the most extra controls. */
const ROW_ORDER: DefectType[] = [
  'filler',
  'repetition',
  'elongation',
  'false_start',
  'vocal_sound',
  'unclear',
  'pause'
]

const MAX_MIN_DURATION: Record<DefectType, number> = {
  filler: 3,
  pause: 10,
  repetition: 3,
  elongation: 3,
  false_start: 3,
  vocal_sound: 3,
  unclear: 3,
  manual: 3
}

const MAX_PAUSE_THRESHOLD = 5
const MAX_PAUSE_HIGH = 10
const MAX_REPETITION_WINDOW = 10
const MAX_ELONGATION_REPEATS = 10
const MAX_AUTO_GROUP_GAP = 5

export default function DefectRulesSection({
  rules,
  playback,
  setRules,
  updateSettings
}: {
  rules: DefectRules
  playback: PlaybackSettings
  setRules: (patch: Partial<DefectRules>) => void
  updateSettings: (patch: {
    playback?: Partial<PlaybackSettings>
  }) => void
}) {
  const isEnabled = (type: DefectType): boolean =>
    type === 'unclear' ? false : rules.enabledTypes?.[type] !== false

  const paddingFor = (type: DefectType): SkipPadding =>
    playback.paddingByType?.[type] ?? {
      before: playback.skipBeforeSec,
      after: playback.skipAfterSec
    }

  const setPadding = (type: DefectType, value: SkipPadding): void => {
    updateSettings({
      playback: {
        paddingByType: {
          ...(playback.paddingByType ?? {}),
          [type]: value
        }
      }
    })
  }

  const setMinDuration = (type: DefectType, value: number): void => {
    setRules({
      minDurationByType: {
        ...rules.minDurationByType,
        [type]: value
      }
    })
  }

  const setTypeEnabled = (type: DefectType, enabled: boolean): void => {
    setRules({
      enabledTypes: {
        ...rules.enabledTypes,
        [type]: enabled
      }
    })
  }

  return (
    <section className="settings-section">
      <div className="section-title-row">
        <h3>Правила дефектов</h3>
        <button className="link-btn" onClick={() => setRules(DEFAULT_RULES)}>
          сбросить
        </button>
      </div>

      <div className="defect-table">
        <div className="defect-row defect-row-head">
          <span>Тип</span>
          <span>Мин. длительность</span>
          <span>Отступы до / после</span>
          <span>Особенности</span>
        </div>

        {ROW_ORDER.map((type) => {
          const enabled = isEnabled(type)
          const isUnclear = type === 'unclear'
          return (
            <Fragment key={type}>
              <div
                className={`defect-row ${enabled ? '' : 'is-off'} ${
                  type === 'pause' ? 'is-pause' : ''
                }`}
              >
                <label className="defect-row-name">
                  <input
                    type="checkbox"
                    checked={enabled}
                    disabled={isUnclear}
                    onChange={(event) => setTypeEnabled(type, event.target.checked)}
                  />
                  <span>{DEFECT_LABELS[type]}</span>
                </label>

                {isUnclear ? (
                  <span className="defect-row-placeholder muted small">—</span>
                ) : (
                  <RangeField
                    value={rules.minDurationByType?.[type] ?? 0}
                    min={0}
                    max={MAX_MIN_DURATION[type]}
                    step={0.05}
                    suffix="с"
                    disabled={!enabled}
                    compact
                    ariaLabel={`Минимальная длительность: ${DEFECT_LABELS[type]}`}
                    onChange={(value) => setMinDuration(type, value)}
                  />
                )}

                {isUnclear ? (
                  <span className="defect-row-placeholder muted small">—</span>
                ) : (
                  <InlinePadding
                    value={paddingFor(type)}
                    disabled={!enabled}
                    onChange={(value) => setPadding(type, value)}
                  />
                )}

                <div className="defect-row-specifics">
                  {type === 'filler' ? (
                    <label className={`check ${enabled ? '' : 'disabled'}`}>
                      <input
                        type="checkbox"
                        checked={rules.detectLexicalFillers}
                        disabled={!enabled}
                        onChange={(event) =>
                          setRules({ detectLexicalFillers: event.target.checked })
                        }
                      />
                      искать слова-филлеры
                    </label>
                  ) : null}

                  {type === 'repetition' ? (
                    <RangeField
                      label="окно повторов"
                      value={rules.repetitionWindowSec}
                      min={0.5}
                      max={MAX_REPETITION_WINDOW}
                      step={0.5}
                      suffix="с"
                      disabled={!enabled}
                      compact
                      onChange={(value) => setRules({ repetitionWindowSec: value })}
                    />
                  ) : null}

                  {type === 'elongation' ? (
                    <RangeField
                      label="повторов буквы"
                      value={rules.elongationMinRepeats}
                      min={2}
                      max={MAX_ELONGATION_REPEATS}
                      step={1}
                      disabled={!enabled}
                      compact
                      onChange={(value) => setRules({ elongationMinRepeats: value })}
                    />
                  ) : null}

                  {type === 'unclear' ? (
                    <div className="unclear-note">
                      <span className="badge">в разработке</span>
                      <span className="muted small">нужна уверенность модели</span>
                    </div>
                  ) : null}

                  {type === 'false_start' || type === 'vocal_sound' ? (
                    <span className="muted small">—</span>
                  ) : null}

                  {type === 'pause' ? (
                    <span className="muted small">порог и конец предложения — ниже</span>
                  ) : null}
                </div>
              </div>

              {type === 'pause' ? (
                <div className="defect-row-extra">
                  <RangeField
                    label="порог паузы"
                    value={rules.pauseThresholdSec}
                    min={0.3}
                    max={MAX_PAUSE_THRESHOLD}
                    step={0.1}
                    suffix="с"
                    disabled={!enabled}
                    compact
                    onChange={(value) => setRules({ pauseThresholdSec: value })}
                  />
                  <RangeField
                    label="критичная пауза"
                    value={rules.pauseHighSec}
                    min={0.5}
                    max={MAX_PAUSE_HIGH}
                    step={0.1}
                    suffix="с"
                    disabled={!enabled}
                    compact
                    onChange={(value) => setRules({ pauseHighSec: value })}
                  />
                  <label className={`check ${enabled ? '' : 'disabled'}`}>
                    <input
                      type="checkbox"
                      checked={rules.excludePauseAfterSentenceEnd}
                      disabled={!enabled}
                      onChange={(event) =>
                        setRules({ excludePauseAfterSentenceEnd: event.target.checked })
                      }
                    />
                    не считать после . ? ! …
                  </label>
                </div>
              ) : null}
            </Fragment>
          )
        })}
      </div>

      <div className="hint">
        Дефект короче минимальной длительности не попадает в список. Для повтора
        учитывается длительность повторяемого слова, для паузы — длина тишины.
        0 — без ограничения. Снятый тип не детектируется, но его настройки
        сохраняются.
      </div>

      <div className="auto-group-row">
        <label className="check">
          <input
            type="checkbox"
            checked={rules.autoGroupEnabled}
            onChange={(event) => {
              const enabled = event.target.checked
              setRules({
                autoGroupEnabled: enabled,
                autoGroupGapSec:
                  enabled && rules.autoGroupGapSec < 0.05 ? 0.5 : rules.autoGroupGapSec
              })
            }}
          />
          Авто объединение
        </label>
        <RangeField
          label="макс. пауза между дефектами"
          value={
            rules.autoGroupEnabled
              ? Math.max(0.05, rules.autoGroupGapSec)
              : rules.autoGroupGapSec
          }
          min={rules.autoGroupEnabled ? 0.05 : 0}
          max={MAX_AUTO_GROUP_GAP}
          step={0.05}
          suffix="с"
          disabled={!rules.autoGroupEnabled}
          compact
          onChange={(value) => setRules({ autoGroupGapSec: Math.max(0.05, value) })}
        />
      </div>
      <div className="hint">
        Соседние автоматические дефекты склеиваются, если между ними нет других
        слов и пауза не больше указанной. Пауза внутри строки считается от
        тишины, поэтому филлер прямо перед паузой объединяется с ней.
      </div>

      <div className="padding-extra-head">
        <span className="muted small">Отступы при пропуске</span>
        <button
          className="link-btn"
          onClick={() =>
            updateSettings({
              playback: {
                paddingByType: Object.fromEntries(
                  Object.entries(DEFAULT_SKIP_PADDING_BY_TYPE).map(([type, padding]) => [
                    type,
                    { ...padding }
                  ])
                ),
                groupPadding: { ...DEFAULT_GROUP_PADDING }
              }
            })
          }
        >
          сбросить отступы
        </button>
      </div>

      <div className="padding-extra">
        <PaddingField
          label="Отступы ручных меток"
          value={paddingFor('manual')}
          onChange={(value) => setPadding('manual', value)}
        />
        <PaddingField
          label="Отступы группы дефектов"
          value={playback.groupPadding ?? DEFAULT_GROUP_PADDING}
          onChange={(value) => updateSettings({ playback: { groupPadding: value } })}
        />
      </div>
      <div className="hint">
        Отступы оставляют базовую паузу по краям, чтобы вырезанное место не
        склеивалось вплотную. Для объединённой группы применяются отступы
        группы, а не каждого элемента внутри. В режиме пропуска вырезаются все
        дефекты и метки, кроме удалённых.
      </div>
    </section>
  )
}
