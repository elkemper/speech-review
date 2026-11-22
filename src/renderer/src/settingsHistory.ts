import { translate, type UiLanguage } from '@shared/i18n'
import { defectTypeLabel } from '@shared/labels'
import type { DefectRules, DefectType, PlaybackSettings } from '@shared/types'

export interface SettingsHistoryMeta {
  label: string
  mergeKey: string
}

export interface SettingsHistoryPatch {
  rules?: Partial<DefectRules>
  playback?: Partial<PlaybackSettings>
}

/**
 * History labels are built in the language active at the moment of the change.
 * History lives in memory only, so entries created before a language switch
 * keep the old language — that is accepted.
 */
export function rulesHistory(lang: UiLanguage) {
  const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
    translate(lang, key, params)
  return {
    reset: { label: t('history.label.rulesReset'), mergeKey: 'rules:reset' },
    minDuration: (type: DefectType): SettingsHistoryMeta => ({
      label: t('history.label.minDuration', { type: defectTypeLabel(lang, type) }),
      mergeKey: `rules:min:${type}`
    }),
    enabled: (type: DefectType): SettingsHistoryMeta => ({
      label: t('history.label.type', { type: defectTypeLabel(lang, type) }),
      mergeKey: `rules:enabled:${type}`
    }),
    lexicalFillers: {
      label: t('history.label.lexicalFillers'),
      mergeKey: 'rules:lexical-fillers'
    },
    repetitionWindow: {
      label: t('history.label.repetitionWindow'),
      mergeKey: 'rules:repetition-window'
    },
    elongationRepeats: {
      label: t('history.label.elongationRepeats'),
      mergeKey: 'rules:elongation-repeats'
    },
    sentenceEndPause: {
      label: t('history.label.sentenceEndPause'),
      mergeKey: 'rules:sentence-end-pause'
    },
    autoGroup: {
      label: t('history.label.autoGroup'),
      mergeKey: 'rules:auto-group'
    },
    autoGroupGap: {
      label: t('history.label.autoGroupGap'),
      mergeKey: 'rules:auto-group-gap'
    }
  } satisfies Record<string, SettingsHistoryMeta | ((type: DefectType) => SettingsHistoryMeta)>
}

/** Kept in Russian for callers that do not pass a language (tests, defaults). */
export const RULES_HISTORY = rulesHistory('ru')

export function paddingHistory(lang: UiLanguage) {
  const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
    translate(lang, key, params)
  return {
    reset: { label: t('history.label.paddingReset'), mergeKey: 'padding:reset' },
    type: (type: DefectType): SettingsHistoryMeta => ({
      label: t('history.label.paddingType', { type: defectTypeLabel(lang, type) }),
      mergeKey: `padding:${type}`
    }),
    pauseKeep: { label: t('history.label.pauseKeep'), mergeKey: 'padding:pause-keep' },
    group: { label: t('history.label.groupPadding'), mergeKey: 'padding:group' }
  } satisfies Record<string, SettingsHistoryMeta | ((type: DefectType) => SettingsHistoryMeta)>
}

/** Kept in Russian for callers that do not pass a language (tests, defaults). */
export const PADDING_HISTORY = paddingHistory('ru')

function playbackTouchesPadding(patch: Partial<PlaybackSettings>): boolean {
  return (
    patch.skipBeforeSec !== undefined ||
    patch.skipAfterSec !== undefined ||
    patch.pauseKeepSec !== undefined ||
    patch.paddingByType !== undefined ||
    patch.groupPadding !== undefined
  )
}

/**
 * Fallback for callers that did not pass an explicit label. Changes such as
 * `skipEnabled` stay out of history because they are player state, not project
 * settings. The interface language is UI-only and never produces an entry.
 */
export function settingsHistoryMetaForPatch(
  patch: SettingsHistoryPatch,
  lang: UiLanguage = 'ru'
): SettingsHistoryMeta | null {
  if (patch.rules) return { label: translate(lang, 'history.label.rules'), mergeKey: 'rules' }
  if (patch.playback && playbackTouchesPadding(patch.playback)) {
    return { label: translate(lang, 'history.label.padding'), mergeKey: 'padding' }
  }
  return null
}
