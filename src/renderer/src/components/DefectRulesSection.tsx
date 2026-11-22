import { Fragment } from 'react'
import {
  DEFAULT_GROUP_PADDING,
  DEFAULT_PAUSE_KEEP_SEC,
  DEFAULT_SKIP_PADDING_BY_TYPE,
  MAX_PAUSE_KEEP_SEC,
  MIN_PAUSE_KEEP_SEC
} from '@shared/settings'
import {
  defaultRulesForLanguage,
  fillerLanguage,
  MAX_PAUSE_MIN_DURATION,
  MIN_PAUSE_MIN_DURATION
} from '@shared/defects'
import { defectTypeLabel } from '@shared/labels'
import type { DefectRules, DefectType, PlaybackSettings, SkipPadding } from '@shared/types'
import { useT, useUiLanguage } from '../i18n'
import { paddingHistory, rulesHistory, type SettingsHistoryMeta } from '../settingsHistory'
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
  language,
  setRules,
  updateSettings
}: {
  rules: DefectRules
  playback: PlaybackSettings
  /** Recognition language; decides the filler lexicon of the reset defaults. */
  language: string
  setRules: (patch: Partial<DefectRules>, history?: SettingsHistoryMeta) => void
  updateSettings: (patch: {
    playback?: Partial<PlaybackSettings>
  }, history?: SettingsHistoryMeta) => void
}) {
  const t = useT()
  const lang = useUiLanguage()
  // Labels are built per change so their merge keys and session stay the same.
  const RULES_HISTORY = rulesHistory(lang)
  const PADDING_HISTORY = paddingHistory(lang)

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
        <h3>{t('rules.title')}</h3>
        <button
          className="link-btn"
          onClick={() => setRules(defaultRulesForLanguage(language), RULES_HISTORY.reset)}
        >
          {t('rules.reset')}
        </button>
      </div>

      <div className="defect-table">
        <div className="defect-row defect-row-head">
          <span>{t('rules.column.type')}</span>
          <span>{t('rules.column.minDuration')}</span>
          <span>{t('rules.column.padding')}</span>
          <span>{t('rules.column.specific')}</span>
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
                  <span>{defectTypeLabel(lang, type)}</span>
                </label>

                {isUnclear ? (
                  <span className="defect-row-placeholder muted small">—</span>
                ) : (
                  <RangeField
                    value={rules.minDurationByType?.[type] ?? 0}
                    min={type === 'pause' ? MIN_PAUSE_MIN_DURATION : 0}
                    max={MAX_MIN_DURATION[type]}
                    step={0.05}
                    suffix={t('common.secondsSuffix')}
                    disabled={!enabled}
                    compact
                    ariaLabel={t('rules.minDurationAria', {
                      type: defectTypeLabel(lang, type)
                    })}
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
                      {t('rules.lexicalFillers')}
                    </label>
                  ) : null}

                  {type === 'filler' ? (
                    <div className="hint">
                      {fillerLanguage(language) === 'en'
                        ? t('rules.lexicon.en')
                        : t('rules.lexicon.ru')}
                    </div>
                  ) : null}

                  {type === 'repetition' ? (
                    <RangeField
                      label={t('rules.repetitionWindow')}
                      value={rules.repetitionWindowSec}
                      min={0.5}
                      max={MAX_REPETITION_WINDOW}
                      step={0.5}
                      suffix={t('common.secondsSuffix')}
                      disabled={!enabled}
                      compact
                      onChange={(value) =>
                        setRules({ repetitionWindowSec: value }, RULES_HISTORY.repetitionWindow)
                      }
                    />
                  ) : null}

                  {type === 'elongation' ? (
                    <RangeField
                      label={t('rules.elongationRepeats')}
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
                      <span className="badge">{t('rules.inDevelopment')}</span>
                      <span className="muted small">{t('rules.needsConfidence')}</span>
                    </div>
                  ) : null}

                  {type === 'false_start' || type === 'vocal_sound' ? (
                    <span className="muted small">—</span>
                  ) : null}

                  {type === 'pause' ? (
                    <span className="muted small">{t('rules.pauseNote')}</span>
                  ) : null}
                </div>
              </div>

              {type === 'pause' ? (
                <div className="defect-row-extra">
                  <RangeField
                    label={t('rules.pauseKeep')}
                    value={playback.pauseKeepSec ?? DEFAULT_PAUSE_KEEP_SEC}
                    min={MIN_PAUSE_KEEP_SEC}
                    max={MAX_PAUSE_KEEP_SEC}
                    step={0.05}
                    suffix={t('common.secondsSuffix')}
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
                    {t('rules.sentenceEndPause')}
                  </label>
                </div>
              ) : null}
            </Fragment>
          )
        })}
      </div>

      <div className="hint">{t('rules.minDurationHint')}</div>
      <div className="hint">{t('rules.lexiconHint')}</div>

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
          {t('rules.autoGroup')}
        </label>
        <RangeField
          label={t('rules.autoGroupGap')}
          value={
            rules.autoGroupEnabled
              ? Math.max(0.05, rules.autoGroupGapSec)
              : rules.autoGroupGapSec
          }
          min={rules.autoGroupEnabled ? 0.05 : 0}
          max={MAX_AUTO_GROUP_GAP}
          step={0.05}
          suffix={t('common.secondsSuffix')}
          disabled={!rules.autoGroupEnabled}
          compact
          onChange={(value) =>
            setRules({ autoGroupGapSec: Math.max(0.05, value) }, RULES_HISTORY.autoGroupGap)
          }
        />
      </div>
      <div className="hint">{t('rules.autoGroupHint')}</div>

      <div className="padding-extra-head">
        <span className="muted small">{t('rules.padding.title')}</span>
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
          {t('rules.padding.reset')}
        </button>
      </div>

      <div className="padding-extra">
        <PaddingField
          label={t('rules.padding.manual')}
          value={paddingFor('manual')}
          onChange={(value) => setPadding('manual', value)}
        />
        <PaddingField
          label={t('rules.padding.group')}
          value={playback.groupPadding ?? DEFAULT_GROUP_PADDING}
          onChange={(value) =>
            updateSettings({ playback: { groupPadding: value } }, PADDING_HISTORY.group)
          }
        />
      </div>
      <div className="hint">{t('rules.padding.hint')}</div>
    </section>
  )
}
