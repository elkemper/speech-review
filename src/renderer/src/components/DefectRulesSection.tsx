import { Fragment } from 'react'
import {
  DEFAULT_GROUP_PADDING,
  DEFAULT_PAUSE_KEEP_SEC,
  DEFAULT_SKIP_PADDING_BY_TYPE,
  MAX_PAUSE_KEEP_SEC,
  MIN_PAUSE_KEEP_SEC
} from '@shared/settings'
import {
  DEFAULT_RULES,
  MAX_PAUSE_MIN_DURATION,
  MIN_PAUSE_MIN_DURATION
} from '@shared/defects'
import type { DefectRules, DefectType, PlaybackSettings, SkipPadding } from '@shared/types'
import { DEFECT_LABELS } from '../defectsUi'
import {
  PADDING_HISTORY,
  RULES_HISTORY,
  type SettingsHistoryMeta
} from '../settingsHistory'
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
  pause: MAX_PAUSE_MIN_DURATION,
  repetition: 3,
  elongation: 3,
  false_start: 3,
  vocal_sound: 3,
  unclear: 3,
  manual: 3
}

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
  setRules: (patch: Partial<DefectRules>, history?: SettingsHistoryMeta) => void
  updateSettings: (patch: {
    playback?: Partial<PlaybackSettings>
  }, history?: SettingsHistoryMeta) => void
}) {
  const isEnabled = (type: DefectType): boolean =>
    type === 'unclear' ? false : rules.enabledTypes?.[type] !== false

  const paddingFor = (type: DefectType): SkipPadding =>
    playback.paddingByType?.[type] ?? {
      before: playback.skipBeforeSec,
      after: playback.skipAfterSec
    }

  const setPadding = (type: DefectType, value: SkipPadding): void => {
    updateSettings(
      {
        playback: {
          paddingByType: {
            ...(playback.paddingByType ?? {}),
            [type]: value
          }
        }
      },
      PADDING_HISTORY.type(type)
    )
  }

  const setMinDuration = (type: DefectType, value: number): void => {
    setRules(
      {
        minDurationByType: {
          ...rules.minDurationByType,
          [type]: value
        }
      },
      RULES_HISTORY.minDuration(type)
    )
  }

  const setTypeEnabled = (type: DefectType, enabled: boolean): void => {
    setRules(
      {
        enabledTypes: {
          ...rules.enabledTypes,
          [type]: enabled
        }
      },
      RULES_HISTORY.enabled(type)
    )
  }

  return (
    <section className="settings-section">
      <div className="section-title-row">
        <h3>Правила дефектов</h3>
        <button className="link-btn" onClick={() => setRules(DEFAULT_RULES, RULES_HISTORY.reset)}>
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
                    min={type === 'pause' ? MIN_PAUSE_MIN_DURATION : 0}
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
                          setRules(
                            { detectLexicalFillers: event.target.checked },
                            RULES_HISTORY.lexicalFillers
                          )
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
                      onChange={(value) =>
                        setRules({ repetitionWindowSec: value }, RULES_HISTORY.repetitionWindow)
                      }
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
                      onChange={(value) =>
                        setRules(
                          { elongationMinRepeats: value },
                          RULES_HISTORY.elongationRepeats
                        )
                      }
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
                    <span className="muted small">тишина и конец предложения — ниже</span>
                  ) : null}
                </div>
              </div>

              {type === 'pause' ? (
                <div className="defect-row-extra">
                  <RangeField
                    label="оставить тишины"
                    value={playback.pauseKeepSec ?? DEFAULT_PAUSE_KEEP_SEC}
                    min={MIN_PAUSE_KEEP_SEC}
                    max={MAX_PAUSE_KEEP_SEC}
                    step={0.05}
                    suffix="с"
                    disabled={!enabled}
                    compact
                    onChange={(value) =>
                      updateSettings(
                        { playback: { pauseKeepSec: value } },
                        PADDING_HISTORY.pauseKeep
                      )
                    }
                  />
                  <label className={`check ${enabled ? '' : 'disabled'}`}>
                    <input
                      type="checkbox"
                      checked={rules.excludePauseAfterSentenceEnd}
                      disabled={!enabled}
                      onChange={(event) =>
                        setRules(
                          { excludePauseAfterSentenceEnd: event.target.checked },
                          RULES_HISTORY.sentenceEndPause
                        )
                      }
                    />
                    не считать дефектом паузу в конце предложения
                  </label>
                </div>
              ) : null}
            </Fragment>
          )
        })}
      </div>

      <div className="hint">
        Дефект короче минимальной длительности не попадает в список. Для повтора
        учитывается длительность повторяемого слова. Для паузы это порог тишины:
        более короткие разрывы не считаются дефектом. 0 — без ограничения (кроме
        паузы: минимум 0.3 с). Снятый тип не детектируется, но его настройки
        сохраняются.
      </div>

      <div className="auto-group-row">
        <label className="check">
          <input
            type="checkbox"
            checked={rules.autoGroupEnabled}
            onChange={(event) => {
              const enabled = event.target.checked
              setRules(
                {
                  autoGroupEnabled: enabled,
                  autoGroupGapSec:
                    enabled && rules.autoGroupGapSec < 0.05 ? 0.5 : rules.autoGroupGapSec
                },
                RULES_HISTORY.autoGroup
              )
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
          onChange={(value) =>
            setRules({ autoGroupGapSec: Math.max(0.05, value) }, RULES_HISTORY.autoGroupGap)
          }
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
            updateSettings(
              {
                playback: {
                  paddingByType: Object.fromEntries(
                    Object.entries(DEFAULT_SKIP_PADDING_BY_TYPE).map(([type, padding]) => [
                      type,
                      { ...padding }
                    ])
                  ),
                  pauseKeepSec: DEFAULT_PAUSE_KEEP_SEC,
                  groupPadding: { ...DEFAULT_GROUP_PADDING }
                }
              },
              PADDING_HISTORY.reset
            )
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
          onChange={(value) =>
            updateSettings({ playback: { groupPadding: value } }, PADDING_HISTORY.group)
          }
        />
      </div>
      <div className="hint">
        Отступы оставляют базовую паузу по краям, чтобы вырезанное место не
        склеивалось вплотную. Для паузы отдельно задаётся, сколько тишины
        оставить: она делится поровну между краями, а отступы паузы могут
        дополнительно расширить вырезанное место. Слишком короткий рез не
        выполняется. Для объединённой группы применяются отступы группы, а не
        каждого элемента внутри. Ручки на таймлайне двигают итоговые границы
        выреза; двойной клик по ручке возвращает рассчитанные отступы. В режиме
        пропуска вырезаются все дефекты и метки, кроме удалённых.
      </div>
    </section>
  )
}
