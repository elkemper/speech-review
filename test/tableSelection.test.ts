import { describe, expect, it } from 'vitest'
import {
  EMPTY_ROW_SELECTION,
  insertionIndexForRows,
  pruneRowSelection,
  selectAllRows,
  selectRow
} from '../src/renderer/src/tableSelection'

const rows = ['a', 'b', 'c', 'd', 'e']

describe('row selection in the defect table', () => {
  it('replaces the selection on a plain click', () => {
    const next = selectRow(rows, EMPTY_ROW_SELECTION, 'c', 'replace')
    expect(next.anchorId).toBe('c')
    expect([...next.selected]).toEqual(['c'])
  })

  it('toggles a row with Cmd/Ctrl+click and moves the anchor', () => {
    const first = selectRow(rows, EMPTY_ROW_SELECTION, 'a', 'replace')
    const added = selectRow(rows, first, 'c', 'toggle')
    expect(added.anchorId).toBe('c')
    expect([...added.selected].sort()).toEqual(['a', 'c'])

    const removed = selectRow(rows, added, 'a', 'toggle')
    expect([...removed.selected]).toEqual(['c'])
  })

  it('selects an inclusive range from the anchor', () => {
    const first = selectRow(rows, EMPTY_ROW_SELECTION, 'b', 'replace')
    const forward = selectRow(rows, first, 'd', 'range')
    expect([...forward.selected].sort()).toEqual(['b', 'c', 'd'])
    expect(forward.anchorId).toBe('b')

    const backward = selectRow(rows, forward, 'a', 'range')
    expect([...backward.selected].sort()).toEqual(['a', 'b'])
  })

  it('falls back to a plain selection when the anchor is gone', () => {
    const stale = { anchorId: 'x', selected: new Set(['x']) }
    const next = selectRow(rows, stale, 'c', 'range')
    expect(next.anchorId).toBe('c')
    expect([...next.selected]).toEqual(['c'])
  })

  it('ignores ids that are not in the table', () => {
    const next = selectRow(rows, EMPTY_ROW_SELECTION, 'zzz', 'replace')
    expect(next).toBe(EMPTY_ROW_SELECTION)
  })

  it('selects all rows', () => {
    const all = selectAllRows(rows)
    expect(all.anchorId).toBe('a')
    expect([...all.selected].sort()).toEqual([...rows].sort())
    expect([...selectAllRows([]).selected]).toEqual([])
  })

  it('prunes ids that the new snapshot no longer contains', () => {
    const current = { anchorId: 'c', selected: new Set(['b', 'c']) }
    const pruned = pruneRowSelection(current, ['a', 'b'])
    expect(pruned.anchorId).toBeNull()
    expect([...pruned.selected]).toEqual(['b'])
  })

  it('returns the same object when nothing changed', () => {
    const current = { anchorId: 'b', selected: new Set(['b', 'c']) }
    expect(pruneRowSelection(current, rows)).toBe(current)
  })

  it('places a new row by time', () => {
    const sorted = [{ start: 1 }, { start: 5 }, { start: 10 }]
    expect(insertionIndexForRows(sorted, 0)).toBe(0)
    // Ties sort after the existing row with the same start.
    expect(insertionIndexForRows(sorted, 5)).toBe(2)
    expect(insertionIndexForRows(sorted, 7)).toBe(2)
    expect(insertionIndexForRows(sorted, 100)).toBe(3)
    expect(insertionIndexForRows([], 5)).toBe(0)
  })
})
