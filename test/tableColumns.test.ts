import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TABLE_COLUMN_WIDTHS,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  ROW_NUMBER_WIDTH,
  columnWidthsFor,
  normalizeColumnWidth,
  normalizeColumnWidths,
  tableAddFields,
  totalTableWidth
} from '../src/renderer/src/tableColumns'

describe('table column widths', () => {
  it('normalizes stored values and clamps them', () => {
    expect(normalizeColumnWidth(120)).toBe(120)
    expect(normalizeColumnWidth('180')).toBe(180)
    expect(normalizeColumnWidth(10)).toBe(MIN_COLUMN_WIDTH)
    expect(normalizeColumnWidth(10_000)).toBe(MAX_COLUMN_WIDTH)
    expect(normalizeColumnWidth(120.6)).toBe(121)
    expect(normalizeColumnWidth(12.6)).toBe(MIN_COLUMN_WIDTH)
    expect(normalizeColumnWidth('nope')).toBeNull()
    expect(normalizeColumnWidth(null)).toBeNull()
    expect(normalizeColumnWidth(Number.NaN)).toBeNull()
  })

  it('keeps known fields and drops everything else', () => {
    expect(
      normalizeColumnWidths({
        start_tc: 200,
        note: '300',
        unknown: 100,
        type: 'bad'
      })
    ).toEqual({ start_tc: 200, note: 300 })
    expect(normalizeColumnWidths(null)).toEqual({})
    expect(normalizeColumnWidths(['x'])).toEqual({})
  })

  it('merges stored widths with defaults for the visible fields', () => {
    const widths = columnWidthsFor(['start_tc', 'note'], { note: 400 })
    expect(widths.start_tc).toBe(DEFAULT_TABLE_COLUMN_WIDTHS.start_tc)
    expect(widths.note).toBe(400)
    // Hidden fields keep their defaults so they render if they come back.
    expect(widths.text).toBe(DEFAULT_TABLE_COLUMN_WIDTHS.text)
  })

  it('adds the row-number column to the total width', () => {
    const fields = ['start_tc', 'note'] as const
    expect(totalTableWidth([...fields], DEFAULT_TABLE_COLUMN_WIDTHS)).toBe(
      ROW_NUMBER_WIDTH + DEFAULT_TABLE_COLUMN_WIDTHS.start_tc + DEFAULT_TABLE_COLUMN_WIDTHS.note
    )
  })

  it('finds the columns an inline draft row edits', () => {
    expect(tableAddFields(['type', 'start_tc', 'end_tc', 'note'])).toEqual({
      start: 'start_tc',
      end: 'end_tc',
      note: 'note'
    })
    expect(tableAddFields(['start_sec', 'end_sec'])).toEqual({
      start: 'start_sec',
      end: 'end_sec',
      note: null
    })
    // A timecode column wins when both time formats are visible.
    expect(tableAddFields(['start_sec', 'start_tc', 'end_tc'])).toMatchObject({
      start: 'start_tc',
      end: 'end_tc'
    })
    expect(tableAddFields(['type', 'text'])).toEqual({
      start: null,
      end: null,
      note: null
    })
  })
})
