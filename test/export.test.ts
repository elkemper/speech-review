import { describe, expect, it } from 'vitest'
import { buildCsv, exportValue } from '../src/shared/exportCsv'
import type { ExportDefect, ExportSettings } from '../src/shared/types'

const settings: ExportSettings = {
  fields: ['start_tc', 'end_tc', 'type', 'text', 'note'],
  delimiter: ';',
  includeHeader: true
}

function defect(overrides: Partial<ExportDefect> = {}): ExportDefect {
  return {
    id: 'd1',
    type: 'filler',
    start: 1.5,
    end: 2,
    cutStart: 1.5,
    cutEnd: 2,
    wordIds: [0],
    text: 'ну',
    severity: 'low',
    source: 'auto',
    confirmed: false,
    dismissed: false,
    note: 'убрать; вместе с "ээ"',
    ...overrides
  }
}

describe('CSV export', () => {
  it('exports only the configured fields in order', () => {
    const csv = buildCsv([defect()], settings)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('start_tc;end_tc;type;text;note')
    expect(csv).toContain('00:00:01.500;00:00:02.000;филлер;ну;')
    expect(csv).not.toContain('severity')
  })

  it('quotes delimiters and quotes inside cells', () => {
    const csv = buildCsv([defect()], settings)
    expect(csv).toContain('"убрать; вместе с ""ээ"""')
  })

  it('supports comma delimiter and no header', () => {
    const csv = buildCsv(
      [defect()],
      { ...settings, delimiter: ',', includeHeader: false, fields: ['start_sec', 'text'] }
    )
    expect(csv).not.toContain('start_sec')
    expect(csv).toContain('1.500,ну')
  })

  it('uses cut bounds for the base fields and defect bounds for the optional ones', () => {
    const item = defect({ start: 1, end: 3, cutStart: 1.4, cutEnd: 2.2 })
    expect(exportValue(item, 'start_tc')).toBe('00:00:01.400')
    expect(exportValue(item, 'end_tc')).toBe('00:00:02.200')
    expect(exportValue(item, 'duration_sec')).toBe('0.800')
    expect(exportValue(item, 'defect_start_tc')).toBe('00:00:01.000')
    expect(exportValue(item, 'defect_end_tc')).toBe('00:00:03.000')
    expect(exportValue(item, 'defect_duration_sec')).toBe('2.000')
    expect(exportValue(item, 'cut')).toBe('да')
  })

  it('leaves cut fields empty when the defect is not removed', () => {
    const item = defect({ start: 1, end: 1.1, cutStart: null, cutEnd: null })
    expect(exportValue(item, 'start_tc')).toBe('')
    expect(exportValue(item, 'end_tc')).toBe('')
    expect(exportValue(item, 'start_sec')).toBe('')
    expect(exportValue(item, 'end_sec')).toBe('')
    expect(exportValue(item, 'duration_sec')).toBe('')
    expect(exportValue(item, 'cut')).toBe('нет')
    expect(exportValue(item, 'defect_start_tc')).toBe('00:00:01.000')
  })

  it('maps every field without throwing', () => {
    const fields = [
      'start_tc',
      'end_tc',
      'start_sec',
      'end_sec',
      'duration_sec',
      'type',
      'severity',
      'source',
      'confirmed',
      'text',
      'note',
      'cut',
      'defect_start_tc',
      'defect_end_tc',
      'defect_start_sec',
      'defect_end_sec',
      'defect_duration_sec'
    ] as const
    for (const field of fields) {
      expect(exportValue(defect({ confirmed: true }), field)).not.toBeUndefined()
    }
    expect(exportValue(defect(), 'confirmed')).toBe('нет')
    expect(exportValue(defect({ confirmed: true }), 'confirmed')).toBe('да')
  })
})
