import { describe, expect, it } from 'vitest'
import { buildCsv, exportValue } from '../src/shared/exportCsv'
import type { Defect, ExportSettings } from '../src/shared/types'

const settings: ExportSettings = {
  fields: ['start_tc', 'end_tc', 'type', 'text', 'note'],
  delimiter: ';',
  includeHeader: true
}

function defect(overrides: Partial<Defect> = {}): Defect {
  return {
    id: 'd1',
    type: 'filler',
    start: 1.5,
    end: 2,
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
      'note'
    ] as const
    for (const field of fields) {
      expect(exportValue(defect({ confirmed: true }), field)).not.toBeUndefined()
    }
    expect(exportValue(defect(), 'confirmed')).toBe('нет')
    expect(exportValue(defect({ confirmed: true }), 'confirmed')).toBe('да')
  })
})
