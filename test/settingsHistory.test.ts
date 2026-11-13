import { describe, expect, it } from 'vitest'
import {
  PADDING_HISTORY,
  RULES_HISTORY,
  settingsHistoryMetaForPatch
} from '../src/renderer/src/settingsHistory'

describe('settings history metadata', () => {
  it('labels per-type rules and keeps distinct merge keys', () => {
    expect(RULES_HISTORY.minDuration('pause').label).toBe('Мин. длительность: пауза')
    expect(RULES_HISTORY.minDuration('pause').mergeKey).toBe('rules:min:pause')
    expect(RULES_HISTORY.enabled('filler').mergeKey).toBe('rules:enabled:filler')
    expect(RULES_HISTORY.reset.mergeKey).toBe('rules:reset')
  })

  it('labels padding changes', () => {
    expect(PADDING_HISTORY.type('repetition').label).toBe('Отступы: повтор')
    expect(PADDING_HISTORY.pauseKeep.label).toBe('Тишина в паузах')
    expect(PADDING_HISTORY.group.label).toBe('Отступы группы')
    expect(PADDING_HISTORY.reset.mergeKey).toBe('padding:reset')
  })

  it('falls back to a generic entry for rules', () => {
    expect(settingsHistoryMetaForPatch({ rules: { repetitionWindowSec: 1.4 } })).toEqual({
      label: 'Правила дефектов',
      mergeKey: 'rules'
    })
  })

  it('ignores skip-enabled-only changes', () => {
    expect(settingsHistoryMetaForPatch({ playback: { skipEnabled: true } })).toBeNull()
  })

  it('records padding changes', () => {
    expect(
      settingsHistoryMetaForPatch({
        playback: { paddingByType: { pause: { before: 0, after: 0 } } }
      })
    ).toEqual({ label: 'Отступы пропуска', mergeKey: 'padding' })
    expect(
      settingsHistoryMetaForPatch({ playback: { pauseKeepSec: 0.6 } })
    ).toEqual({ label: 'Отступы пропуска', mergeKey: 'padding' })
  })
})
