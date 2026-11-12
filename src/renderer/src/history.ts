import type {
  DefectBoundsOverride,
  ManualMark,
  Project
} from '@shared/types'

export interface EditableProjectState {
  marks: ManualMark[]
  reviewedDefectIds: string[]
  defectNotes: Record<string, string>
  defectOverrides: Record<string, DefectBoundsOverride>
}

export interface HistoryEntry {
  id: string
  label: string
  at: string
  before: EditableProjectState
  after: EditableProjectState
  mergeKey?: string
}

export interface HistoryState {
  entries: HistoryEntry[]
  /** Index of the last applied entry. -1 means the initial state. */
  index: number
}

export const HISTORY_MERGE_WINDOW_MS = 2000

export function createHistoryState(): HistoryState {
  return { entries: [], index: -1 }
}

export function snapshotEditable(project: Project): EditableProjectState {
  return {
    marks: project.marks.map((mark) => ({
      ...mark,
      wordIds: mark.wordIds ? [...mark.wordIds] : undefined
    })),
    reviewedDefectIds: [...project.reviewedDefectIds],
    defectNotes: { ...project.defectNotes },
    defectOverrides: Object.fromEntries(
      Object.entries(project.defectOverrides ?? {}).map(([id, bounds]) => [
        id,
        { ...bounds }
      ])
    )
  }
}

export function applyEditable(project: Project, state: EditableProjectState): Project {
  return {
    ...project,
    marks: state.marks.map((mark) => ({
      ...mark,
      wordIds: mark.wordIds ? [...mark.wordIds] : undefined
    })),
    reviewedDefectIds: [...state.reviewedDefectIds],
    defectNotes: { ...state.defectNotes },
    defectOverrides: Object.fromEntries(
      Object.entries(state.defectOverrides ?? {}).map(([id, bounds]) => [id, { ...bounds }])
    )
  }
}

export function editableEquals(a: EditableProjectState, b: EditableProjectState): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function makeHistoryEntry(
  label: string,
  before: EditableProjectState,
  after: EditableProjectState,
  options: { mergeKey?: string; id?: string; at?: string } = {}
): HistoryEntry {
  return {
    id:
      options.id ??
      `history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    at: options.at ?? new Date().toISOString(),
    before,
    after,
    ...(options.mergeKey ? { mergeKey: options.mergeKey } : {})
  }
}

export function recordHistory(
  state: HistoryState,
  entry: HistoryEntry,
  now = Date.now()
): HistoryState {
  const entries = state.entries.slice(0, state.index + 1)
  const last = entries[entries.length - 1]

  if (
    last &&
    entry.mergeKey &&
    last.mergeKey === entry.mergeKey &&
    now - Date.parse(last.at) <= HISTORY_MERGE_WINDOW_MS
  ) {
    entries[entries.length - 1] = {
      ...last,
      label: entry.label,
      at: entry.at,
      after: entry.after
    }
    return { entries, index: entries.length - 1 }
  }

  entries.push(entry)
  return { entries, index: entries.length - 1 }
}

export function canUndo(state: HistoryState): boolean {
  return state.index >= 0
}

export function canRedo(state: HistoryState): boolean {
  return state.index < state.entries.length - 1
}

export function withHistoryIndex(state: HistoryState, index: number): HistoryState {
  return {
    ...state,
    index: Math.max(-1, Math.min(state.entries.length - 1, index))
  }
}

export function stateForHistoryIndex(
  state: HistoryState,
  index: number
): EditableProjectState | null {
  if (index < 0) return state.entries[0]?.before ?? null
  return state.entries[index]?.after ?? null
}
