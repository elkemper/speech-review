import type { DefectRules, DefectType, PlaybackSettings } from '@shared/types'
import { DEFECT_LABELS } from './defectsUi'

export interface SettingsHistoryMeta {
  label: string
  mergeKey: string
}

export interface SettingsHistoryPatch {
  rules?: Partial<DefectRules>
  playback?: Partial<PlaybackSettings>
}

export const RULES_HISTORY = {
  reset: { label: 'Правила сброшены', mergeKey: 'rules:reset' },
  minDuration: (type: DefectType): SettingsHistoryMeta => ({
    label: `Мин. длительность: ${DEFECT_LABELS[type]}`,
    mergeKey: `rules:min:${type}`
  }),
  enabled: (type: DefectType): SettingsHistoryMeta => ({
    label: `Тип: ${DEFECT_LABELS[type]}`,
    mergeKey: `rules:enabled:${type}`
  }),
  lexicalFillers: {
    label: 'Слова-филлеры',
    mergeKey: 'rules:lexical-fillers'
  },
  repetitionWindow: {
    label: 'Окно повторов',
    mergeKey: 'rules:repetition-window'
  },
  elongationRepeats: {
    label: 'Повторы буквы',
    mergeKey: 'rules:elongation-repeats'
  },
  sentenceEndPause: {
    label: 'Пауза после точки',
    mergeKey: 'rules:sentence-end-pause'
  },
  autoGroup: {
    label: 'Авто объединение',
    mergeKey: 'rules:auto-group'
  },
  autoGroupGap: {
    label: 'Макс. пауза объединения',
    mergeKey: 'rules:auto-group-gap'
  }
} satisfies Record<string, SettingsHistoryMeta | ((type: DefectType) => SettingsHistoryMeta)>

export const PADDING_HISTORY = {
  reset: { label: 'Отступы сброшены', mergeKey: 'padding:reset' },
  type: (type: DefectType): SettingsHistoryMeta => ({
    label: `Отступы: ${DEFECT_LABELS[type]}`,
    mergeKey: `padding:${type}`
  }),
  pauseKeep: { label: 'Тишина в паузах', mergeKey: 'padding:pause-keep' },
  group: { label: 'Отступы группы', mergeKey: 'padding:group' }
} satisfies Record<string, SettingsHistoryMeta | ((type: DefectType) => SettingsHistoryMeta)>

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
 * settings.
 */
export function settingsHistoryMetaForPatch(
  patch: SettingsHistoryPatch
): SettingsHistoryMeta | null {
  if (patch.rules) return { label: 'Правила дефектов', mergeKey: 'rules' }
  if (patch.playback && playbackTouchesPadding(patch.playback)) {
    return { label: 'Отступы пропуска', mergeKey: 'padding' }
  }
  return null
}
