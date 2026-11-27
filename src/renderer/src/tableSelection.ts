export type RowSelectMode = 'replace' | 'toggle' | 'range'

export interface RowSelection {
  /** Last row clicked directly; the anchor of a Shift+click range. */
  anchorId: string | null
  selected: ReadonlySet<string>
}

export const EMPTY_ROW_SELECTION: RowSelection = {
  anchorId: null,
  selected: new Set<string>()
}

/**
 * Row selection for one click in the defect table. `range` falls back to a
 * plain selection when the anchor row no longer exists (deleted, undone or
 * rebuilt by a partial transcript).
 */
export function selectRow(
  rows: string[],
  current: RowSelection,
  id: string,
  mode: RowSelectMode
): RowSelection {
  const index = rows.indexOf(id)
  if (index < 0) return current

  if (mode === 'toggle') {
    const selected = new Set(current.selected)
    if (selected.has(id)) selected.delete(id)
    else selected.add(id)
    return { anchorId: id, selected }
  }

  if (mode === 'range' && current.anchorId) {
    const anchorIndex = rows.indexOf(current.anchorId)
    if (anchorIndex >= 0) {
      const from = Math.min(anchorIndex, index)
      const to = Math.max(anchorIndex, index)
      return { anchorId: current.anchorId, selected: new Set(rows.slice(from, to + 1)) }
    }
  }

  return { anchorId: id, selected: new Set([id]) }
}

export function selectAllRows(rows: string[]): RowSelection {
  return { anchorId: rows[0] ?? null, selected: new Set(rows) }
}

/**
 * Index where a new row with the given start would sort. Used to place the
 * draft row by the playhead when no row is selected.
 */
export function insertionIndexForRows(rows: Array<{ start: number }>, time: number): number {
  const index = rows.findIndex((row) => row.start > time)
  return index < 0 ? rows.length : index
}

/**
 * Drops selected ids that no longer exist and clears a stale anchor. Returns
 * the same object when nothing changed so the table does not re-render on
 * every snapshot.
 */
export function pruneRowSelection(selection: RowSelection, rows: string[]): RowSelection {
  const ids = new Set(rows)
  const selected = new Set([...selection.selected].filter((id) => ids.has(id)))
  const anchorMissing = selection.anchorId !== null && !ids.has(selection.anchorId)
  if (!anchorMissing && selected.size === selection.selected.size) return selection
  return {
    anchorId: anchorMissing ? null : selection.anchorId,
    selected
  }
}
