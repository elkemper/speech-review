import type {
  DefectBoundsOverride,
  DefectRules,
  DefectType,
  ManualMark,
  PlaybackSettings,
  Project,
  Settings,
  SkipPadding
} from '@shared/types'

/** Only the playback fields that change skip intervals belong in history. */
export interface HistoryPlaybackState {
  skipBeforeSec: number
  skipAfterSec: number
  pauseKeepSec: number
  paddingByType?: Partial<Record<DefectType, SkipPadding>>
  groupPadding?: SkipPadding
}

export interface EditableProjectState {
  marks: ManualMark[]
  confirmedDefectIds: string[]
  dismissedDefectIds: string[]
  dismissedMarks: ManualMark[]
  defectNotes: Record<string, string>
  cutOverrides: Record<string, DefectBoundsOverride>
  rules: DefectRules
  playback: HistoryPlaybackState
}

export interface HistoryEntry {
  id: string
  label: string
  at: string
  before: EditableProjectState
  after: EditableProjectState
  mergeKey?: string
  /** Set while the settings dialog is open, so undo cannot cross its opening. */
  settingsSession?: string
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

function cloneRules(rules: DefectRules): DefectRules {
  return {
    ...rules,
    fillerWords: [...rules.fillerWords],
    multiWordFillers: rules.multiWordFillers.map((phrase) => [...phrase]),
    minDurationByType: { ...rules.minDurationByType },
    enabledTypes: { ...rules.enabledTypes }
  }
}

function clonePaddingMap(
  paddingByType: Partial<Record<DefectType, SkipPadding>> | undefined
): Partial<Record<DefectType, SkipPadding>> | undefined {
  if (!paddingByType) return undefined
  return Object.fromEntries(
    Object.entries(paddingByType).map(([type, padding]) => [type, { ...padding }])
  ) as Partial<Record<DefectType, SkipPadding>>
}

function clonePlayback(playback: PlaybackSettings): HistoryPlaybackState {
  return {
    skipBeforeSec: playback.skipBeforeSec,
    skipAfterSec: playback.skipAfterSec,
    pauseKeepSec: playback.pauseKeepSec,
    paddingByType: clonePaddingMap(playback.paddingByType),
    groupPadding: playback.groupPadding ? { ...playback.groupPadding } : undefined
  }
}

export function snapshotEditable(
  project: Project,
  settings: Settings
): EditableProjectState {
  return {
    marks: project.marks.map((mark) => ({
      ...mark,
      wordIds: mark.wordIds ? [...mark.wordIds] : undefined
    })),
    confirmedDefectIds: [...project.confirmedDefectIds],
    dismissedDefectIds: [...project.dismissedDefectIds],
    dismissedMarks: (project.dismissedMarks ?? []).map((mark) => ({
      ...mark,
      wordIds: mark.wordIds ? [...mark.wordIds] : undefined
    })),
    defectNotes: { ...project.defectNotes },
    cutOverrides: Object.fromEntries(
      Object.entries(project.cutOverrides ?? {}).map(([id, bounds]) => [
        id,
        { ...bounds }
      ])
    ),
    rules: cloneRules(project.rules),
    playback: clonePlayback(settings.playback)
  }
}

export function applyEditable(project: Project, state: EditableProjectState): Project {
  return {
    ...project,
    marks: state.marks.map((mark) => ({
      ...mark,
      wordIds: mark.wordIds ? [...mark.wordIds] : undefined
    })),
    confirmedDefectIds: [...state.confirmedDefectIds],
    dismissedDefectIds: [...state.dismissedDefectIds],
    dismissedMarks: state.dismissedMarks.map((mark) => ({
      ...mark,
      wordIds: mark.wordIds ? [...mark.wordIds] : undefined
    })),
    defectNotes: { ...state.defectNotes },
    cutOverrides: Object.fromEntries(
      Object.entries(state.cutOverrides ?? {}).map(([id, bounds]) => [id, { ...bounds }])
    ),
    rules: cloneRules(state.rules)
  }
}

/**
 * Apply the history snapshot to the global settings without touching
 * `skipEnabled`: the player owns that toggle and it is not a project setting.
 */
export function applySettingsSnapshot(
  settings: Settings,
  state: EditableProjectState
): Settings {
  return {
    ...settings,
    rules: cloneRules(state.rules),
    playback: {
      ...settings.playback,
      skipBeforeSec: state.playback.skipBeforeSec,
      skipAfterSec: state.playback.skipAfterSec,
      pauseKeepSec: state.playback.pauseKeepSec,
      paddingByType: clonePaddingMap(state.playback.paddingByType),
      groupPadding: state.playback.groupPadding
        ? { ...state.playback.groupPadding }
        : undefined
    }
  }
}

export function editableEquals(a: EditableProjectState, b: EditableProjectState): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function makeHistoryEntry(
  label: string,
  before: EditableProjectState,
  after: EditableProjectState,
  options: {
    mergeKey?: string
    id?: string
    at?: string
    settingsSession?: string
  } = {}
): HistoryEntry {
  return {
    id:
      options.id ??
      `history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    at: options.at ?? new Date().toISOString(),
    before,
    after,
    ...(options.mergeKey ? { mergeKey: options.mergeKey } : {}),
    ...(options.settingsSession ? { settingsSession: options.settingsSession } : {})
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
    last.settingsSession === entry.settingsSession &&
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

/** True for entries recorded while the current settings dialog is open. */
export function isSettingsSessionEntry(
  entry: HistoryEntry | undefined,
  session: string | null
): boolean {
  return Boolean(entry && session && entry.settingsSession === session)
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
