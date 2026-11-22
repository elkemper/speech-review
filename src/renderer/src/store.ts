import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { formatTimecode } from '@shared/format'
import {
  markIdsForDefectId,
  manualDefectIdForMark,
  mergeMarkNeighbours,
  mergeMarksAtSpan,
  reconcileConfirmedIds
} from '@shared/marks'
import { pinCutFor, withoutPinnedCuts } from '@shared/cuts'
import { reconcileManualPins } from '@shared/pinnedCuts'
import type {
  Bookmark,
  Defect,
  DefectRules,
  EngineStatus,
  ExportSettings,
  ManualMark,
  ModelDownloadProgress,
  ModelId,
  ModelUpdateCheckResult,
  Peaks,
  PlaybackSettings,
  Project,
  ProjectSummary,
  Settings,
  TranscribeProgress,
  VideoExportSettings
} from '@shared/types'
import {
  markRangeForSelection,
  markRangeForTimeSelection,
  timeSelectionFor,
  type TimeSelection,
  type WordSelection
} from './selection'
import {
  applyEditable,
  applySettingsSnapshot,
  canRedo,
  canUndo,
  createHistoryState,
  editableEquals,
  isSettingsSessionEntry,
  makeHistoryEntry,
  recordHistory,
  snapshotEditable,
  stateForHistoryIndex,
  withHistoryIndex,
  type HistoryState
} from './history'
import {
  settingsHistoryMetaForPatch,
  type SettingsHistoryMeta
} from './settingsHistory'

let saveTimer: ReturnType<typeof setTimeout> | null = null
let settingsTimer: ReturnType<typeof setTimeout> | null = null
let listenersAttached = false
let startingTranscription = false

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
}

export type DefectFilter = 'all' | 'filler' | 'pause' | 'repetition' | 'elongation' | 'false_start' | 'vocal_sound' | 'unclear' | 'manual'

/** Nested settings objects accept partial patches; the store merges them. */
export type SettingsPatch = Partial<
  Omit<Settings, 'rules' | 'export' | 'playback' | 'videoExport'>
> & {
  rules?: Partial<DefectRules>
  export?: Partial<ExportSettings>
  videoExport?: Partial<VideoExportSettings>
  playback?: Partial<PlaybackSettings>
}

interface AppStore {
  initialized: boolean
  loading: boolean
  opening: boolean
  status: EngineStatus | null
  settings: Settings
  projects: ProjectSummary[]
  project: Project | null
  peaks: Peaks | null
  mediaUrl: string | null
  error: string | null
  toast: Toast | null

  currentTime: number
  playing: boolean
  rate: number
  loop: { start: number; end: number } | null
  activeDefectId: string | null
  selectedWordId: number | null
  selection: WordSelection | null
  /** Exact time range from Shift+drag on the main timeline. */
  timeSelection: TimeSelection | null
  follow: boolean

  jobId: string | null
  progress: TranscribeProgress | null
  modelDownload: ModelDownloadProgress | null
  downloadingModel: boolean
  /** Result of the last explicit model update check (UI-only state). */
  modelUpdateCheck: ModelUpdateCheckResult | null
  checkingModelUpdates: boolean

  showSettings: boolean
  showHistory: boolean
  /** Identifies the settings-dialog session so undo cannot cross its opening. */
  settingsSession: string | null
  filter: DefectFilter
  history: HistoryState

  init: () => Promise<void>
  refreshStatus: () => Promise<void>
  refreshProjects: () => Promise<void>
  openVideo: () => Promise<void>
  openVideoPath: (path: string) => Promise<void>
  openProject: (id: string) => Promise<void>
  closeProject: () => Promise<void>
  deleteProject: (id: string) => Promise<void>
  startTranscription: () => Promise<void>
  cancelTranscription: () => Promise<void>
  downloadModel: (id: ModelId) => Promise<void>
  checkModelUpdates: () => Promise<void>
  updateSettings: (patch: SettingsPatch, history?: SettingsHistoryMeta) => void
  setRules: (patch: Partial<DefectRules>, history?: SettingsHistoryMeta) => void
  toggleSkip: () => void
  confirmDefect: (defect: Defect, label?: string) => void
  confirmMany: (defects: Defect[], label?: string) => void
  unconfirmDefect: (defectId: string, label?: string, relatedIds?: string[]) => void
  restoreDefect: (defectId: string, relatedIds?: string[]) => void
  setNote: (defectId: string, note: string) => void
  addMark: () => void
  addBookmark: (time?: number) => void
  removeBookmark: (id: string) => void
  setBookmarkNote: (id: string, note: string) => void
  removeDefect: (defectId: string, relatedIds?: string[]) => void
  removeDefects: (items: Array<{ id: string; relatedIds?: string[] }>) => void
  splitManualGroup: (defectId: string) => void
  setCutBounds: (
    defectId: string,
    start: number,
    end: number,
    edge?: 'start' | 'end'
  ) => void
  resetCutBounds: (defect: Defect) => void
  undo: () => void
  redo: () => void
  jumpHistory: (index: number) => void
  scheduleSave: () => void
  setCurrentTime: (time: number) => void
  setPlaying: (playing: boolean) => void
  setRate: (rate: number) => void
  setLoop: (loop: { start: number; end: number } | null) => void
  setActiveDefect: (id: string | null) => void
  selectWord: (id: number | null, extend?: boolean) => void
  selectRange: (anchorId: number, focusId: number) => void
  selectTimeRange: (start: number, end: number) => void
  clearSelection: () => void
  setFollow: (follow: boolean) => void
  setFilter: (filter: DefectFilter) => void
  setShowSettings: (show: boolean) => void
  setShowHistory: (show: boolean) => void
  setError: (error: string | null) => void
  notify: (text: string, kind?: Toast['kind']) => void
}

const FALLBACK_SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  rules: {
    ...DEFAULT_SETTINGS.rules,
    fillerWords: [...DEFAULT_SETTINGS.rules.fillerWords],
    multiWordFillers: DEFAULT_SETTINGS.rules.multiWordFillers.map((phrase) => [...phrase]),
    minDurationByType: { ...DEFAULT_SETTINGS.rules.minDurationByType },
    enabledTypes: { ...DEFAULT_SETTINGS.rules.enabledTypes }
  },
  export: { ...DEFAULT_SETTINGS.export, fields: [...DEFAULT_SETTINGS.export.fields] },
  videoExport: { ...DEFAULT_SETTINGS.videoExport },
  playback: {
    ...DEFAULT_SETTINGS.playback,
    paddingByType: Object.fromEntries(
      Object.entries(DEFAULT_SETTINGS.playback.paddingByType ?? {}).map(([type, padding]) => [
        type,
        { ...padding }
      ])
    ),
    groupPadding: DEFAULT_SETTINGS.playback.groupPadding
      ? { ...DEFAULT_SETTINGS.playback.groupPadding }
      : undefined
  }
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

export const useApp = create<AppStore>((set, get) => ({
  initialized: false,
  loading: true,
  opening: false,
  status: null,
  settings: FALLBACK_SETTINGS,
  projects: [],
  project: null,
  peaks: null,
  mediaUrl: null,
  error: null,
  toast: null,

  currentTime: 0,
  playing: false,
  rate: 1,
  loop: null,
  activeDefectId: null,
  selectedWordId: null,
  selection: null,
  timeSelection: null,
  follow: true,

  jobId: null,
  progress: null,
  modelDownload: null,
  downloadingModel: false,
  modelUpdateCheck: null,
  checkingModelUpdates: false,

  showSettings: false,
  showHistory: false,
  settingsSession: null,
  filter: 'all',
  history: createHistoryState(),

  init: async () => {
    if (get().initialized) return
    set({ initialized: true, loading: true })
    try {
      const [status, settings, projects] = await Promise.all([
        window.api.getEngineStatus(),
        window.api.getSettings(),
        window.api.listProjects()
      ])
      set({ status, settings, projects })
      attachListeners(set, get)
    } catch (error) {
      set({ error: cleanError(error) })
    } finally {
      set({ loading: false })
    }
  },

  refreshStatus: async () => {
    try {
      set({ status: await window.api.getEngineStatus() })
    } catch (error) {
      set({ error: cleanError(error) })
    }
  },

  refreshProjects: async () => {
    try {
      set({ projects: await window.api.listProjects() })
    } catch {
      // Non-critical.
    }
  },

  openVideo: async () => {
    if (get().opening) return
    try {
      set({ opening: true })
      const media = await window.api.openVideo()
      if (media) await createFromMedia(media, set, get)
    } catch (error) {
      set({ error: cleanError(error) })
    } finally {
      set({ opening: false })
    }
  },

  openVideoPath: async (path) => {
    if (get().opening) return
    try {
      set({ opening: true })
      const media = await window.api.openVideoPath(path)
      if (media) await createFromMedia(media, set, get)
    } catch (error) {
      set({ error: cleanError(error) })
    } finally {
      set({ opening: false })
    }
  },

  openProject: async (id) => {
    if (get().opening) return
    try {
      set({ opening: true })
      // Persist pending note/review edits before the store points at another project.
      await flushSave(get)
      const loaded = await window.api.loadProject(id)
      const media = await window.api.registerMedia(loaded.project.video.path)
      const mergedSettings: Settings = {
        ...get().settings,
        language: loaded.project.language,
        modelId: loaded.project.modelId,
        backend: loaded.project.backend,
        rules: loaded.project.rules
      }
      set({
        project: loaded.project,
        peaks: loaded.peaks,
        mediaUrl: media.url,
        settings: mergedSettings,
        currentTime: 0,
        playing: false,
        loop: null,
        activeDefectId: null,
        selectedWordId: null,
        selection: null,
        timeSelection: null,
        filter: 'all',
        progress: null,
        jobId: null,
        follow: true,
        history: createHistoryState()
      })
      void window.api
        .saveSettings(mergedSettings)
        .then(() => get().refreshStatus())
        .catch(() => undefined)
    } catch (error) {
      set({ error: cleanError(error) })
    } finally {
      set({ opening: false })
    }
  },

  closeProject: async () => {
    await flushSave(get)
    set({
      project: null,
      peaks: null,
      mediaUrl: null,
      currentTime: 0,
      playing: false,
      loop: null,
      activeDefectId: null,
      selectedWordId: null,
      selection: null,
      timeSelection: null,
      jobId: null,
      progress: null,
      history: createHistoryState()
    })
  },

  deleteProject: async (id) => {
    try {
      await window.api.deleteProject(id)
      if (get().project?.id === id) {
        set({
          project: null,
          peaks: null,
          mediaUrl: null,
          currentTime: 0,
          playing: false,
          loop: null,
          activeDefectId: null,
          selectedWordId: null,
          selection: null,
          timeSelection: null,
          jobId: null,
          progress: null,
          history: createHistoryState()
        })
      }
      await get().refreshProjects()
      get().notify('Проект удалён')
    } catch (error) {
      set({ error: cleanError(error) })
    }
  },

  startTranscription: async () => {
    const { project, settings, jobId } = get()
    if (!project || jobId || startingTranscription) return

    startingTranscription = true
    try {
      if (settings.modelId !== get().status?.modelId || !get().status?.modelReady) {
        await get().downloadModel(settings.modelId)
        if (!get().status?.modelReady) return
      }

      const updated: Project = {
        ...project,
        language: settings.language,
        modelId: settings.modelId,
        backend: settings.backend,
        rules: settings.rules
      }
      set({ project: updated, error: null })
      await window.api.saveProject(updated)

      const result = await window.api.startTranscription({
        projectId: project.id,
        videoPath: project.video.path,
        language: settings.language,
        modelId: settings.modelId,
        backend: settings.backend,
        rules: settings.rules,
        chunkTargetSec: settings.chunkTargetSec,
        force: true
      })

      set({
        jobId: result.jobId,
        progress: {
          jobId: result.jobId,
          projectId: project.id,
          phase: 'prepare',
          percent: 0,
          message: 'Запускаю распознавание…'
        }
      })
    } catch (error) {
      set({ error: cleanError(error) })
      if (!get().jobId) set({ progress: null })
    } finally {
      startingTranscription = false
    }
  },

  cancelTranscription: async () => {
    const jobId = get().jobId
    if (!jobId) return
    await window.api.cancelTranscription(jobId).catch(() => undefined)
    set({ jobId: null, progress: null })
    get().notify('Распознавание отменено')
  },

  downloadModel: async (id) => {
    if (get().downloadingModel) return
    get().updateSettings({ modelId: id })
    set({
      downloadingModel: true,
      modelDownload: { modelId: id, percent: 0, message: 'Начинаю загрузку…' }
    })
    try {
      await window.api.downloadModel(id)
      // Main records the installed version in settings.json; reload it so the
      // renderer copy (and its later saves) do not drop the new version.
      const persisted = await window.api.getSettings().catch(() => null)
      if (persisted?.modelVersions) {
        set({ settings: { ...get().settings, modelVersions: persisted.modelVersions } })
      }
      await get().refreshStatus()
      // The installed version changed; a stale check result would be wrong.
      set({ modelUpdateCheck: null })
      get().notify('Модель скачана и проверена', 'success')
    } catch (error) {
      set({ error: cleanError(error) })
    } finally {
      set({ downloadingModel: false })
      setTimeout(() => {
        if (!get().downloadingModel) set({ modelDownload: null })
      }, 2500)
    }
  },

  checkModelUpdates: async () => {
    if (get().checkingModelUpdates) return
    set({ checkingModelUpdates: true })
    try {
      const result = await window.api.checkModelUpdates()
      set({ modelUpdateCheck: result })
    } catch (error) {
      get().notify(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      set({ checkingModelUpdates: false })
    }
  },

  updateSettings: (patch, historyMeta) => {
    const current = get().settings
    const project = get().project
    const before = project ? snapshotEditable(project, current) : null
    const settings: Settings = {
      ...current,
      ...patch,
      rules: { ...current.rules, ...patch.rules },
      export: { ...current.export, ...patch.export },
      videoExport: { ...current.videoExport, ...patch.videoExport },
      playback: { ...current.playback, ...patch.playback }
    }

    if (project) {
      // Settings and the project copy must update in one render so the defect
      // list never sees the new rules with the old project state.
      set({
        settings,
        project: {
          ...project,
          language: settings.language,
          modelId: settings.modelId,
          backend: settings.backend,
          rules: settings.rules
        }
      })
    } else {
      set({ settings })
    }

    if (project && before) {
      const meta = historyMeta ?? settingsHistoryMetaForPatch(patch)
      if (meta) {
        recordProjectChange(
          set,
          get,
          before,
          meta.label,
          meta.mergeKey,
          get().settingsSession ?? undefined
        )
      }
    }

    if (project) get().scheduleSave()

    if (patch.modelId || patch.language || patch.backend) {
      void window.api
        .saveSettings(settings)
        .then(() => get().refreshStatus())
        .catch((error) => set({ error: cleanError(error) }))
    } else {
      scheduleSettingsSave(get)
    }
  },

  setRules: (patch, history) => {
    get().updateSettings({ rules: patch }, history)
  },

  toggleSkip: () => {
    const state = get()
    state.updateSettings({
      playback: { skipEnabled: !state.settings.playback.skipEnabled }
    })
  },

  confirmDefect: (defect, label) => {
    get().confirmMany([defect], label)
  },

  confirmMany: (items, label) => {
    const project = get().project
    if (!project || items.length === 0) return
    const before = snapshotEditable(project, get().settings)
    const confirmed = new Set(project.confirmedDefectIds)
    const dismissed = new Set(project.dismissedDefectIds)
    // Confirming freezes the cut: the review decision must not move when the
    // padding settings change later. An existing hand-dragged cut is kept as is.
    // Re-confirming an already confirmed defect changes nothing, so a bulk
    // confirmation cannot pin old decisions retroactively.
    const overrides = { ...(project.cutOverrides ?? {}) }
    for (const defect of items) {
      if (confirmed.has(defect.id)) continue
      confirmed.add(defect.id)
      dismissed.delete(defect.id)
      if (!overrides[defect.id]) {
        const pinned = pinCutFor(
          { ...defect, confirmed: true },
          get().settings.playback,
          project.duration
        )
        if (pinned) overrides[defect.id] = pinned
      }
    }
    set({
      project: {
        ...project,
        confirmedDefectIds: [...confirmed],
        dismissedDefectIds: [...dismissed],
        cutOverrides: overrides
      }
    })
    recordProjectChange(
      set,
      get,
      before,
      label ?? (items.length === 1 ? 'Дефект подтверждён' : `Подтверждено: ${items.length}`)
    )
    get().scheduleSave()
  },

  unconfirmDefect: (defectId, label, relatedIds = []) => {
    const project = get().project
    if (!project) return
    const stale = new Set([defectId, ...relatedIds])
    if (!project.confirmedDefectIds.some((id) => stale.has(id))) return
    const before = snapshotEditable(project, get().settings)
    const confirmed = project.confirmedDefectIds.filter((id) => !stale.has(id))
    // Removing the confirmation unfreezes the cut. A range the user dragged by
    // hand is not pinned and stays.
    set({
      project: {
        ...project,
        confirmedDefectIds: confirmed,
        cutOverrides: withoutPinnedCuts(project.cutOverrides ?? {}, stale)
      }
    })
    recordProjectChange(set, get, before, label ?? 'Подтверждение снято')
    get().scheduleSave()
  },

  restoreDefect: (defectId, relatedIds = []) => {
    const project = get().project
    if (!project) return
    const before = snapshotEditable(project, get().settings)
    const markIds = markIdsForDefectId(defectId, project.dismissedMarks ?? [])
    const stale = new Set([defectId, ...relatedIds])
    const confirmed = project.confirmedDefectIds.filter((id) => !stale.has(id))
    const dismissedIds = project.dismissedDefectIds.filter((id) => !stale.has(id))

    if (markIds.length > 0) {
      const restoreIds = new Set(markIds)
      const restored = (project.dismissedMarks ?? []).filter((mark) => restoreIds.has(mark.id))
      set({
        project: {
          ...project,
          marks: [...project.marks, ...restored],
          dismissedMarks: (project.dismissedMarks ?? []).filter(
            (mark) => !restoreIds.has(mark.id)
          ),
          confirmedDefectIds: confirmed.filter(
            (id) => !markIds.some((markId) => id === `manual-${markId}`)
          ),
          dismissedDefectIds: dismissedIds,
          // A restored mark is unconfirmed again, so its cut follows padding.
          cutOverrides: withoutPinnedCuts(project.cutOverrides ?? {}, stale)
        },
        activeDefectId: defectId
      })
      recordProjectChange(set, get, before, 'Метка восстановлена')
    } else {
      set({
        project: {
          ...project,
          confirmedDefectIds: confirmed,
          dismissedDefectIds: dismissedIds,
          cutOverrides: withoutPinnedCuts(project.cutOverrides ?? {}, stale)
        },
        activeDefectId: defectId
      })
      recordProjectChange(set, get, before, 'Дефект восстановлен')
    }
    get().scheduleSave()
  },

  addBookmark: (time) => {
    const project = get().project
    if (!project) return
    const at = Math.min(
      Math.max(0, time ?? get().currentTime),
      Math.max(0, project.duration)
    )
    const bookmark: Bookmark = {
      id: crypto.randomUUID(),
      time: at,
      note: '',
      createdAt: new Date().toISOString()
    }
    const bookmarks = [...(project.bookmarks ?? []), bookmark].sort((a, b) => a.time - b.time)
    set({ project: { ...project, bookmarks } })
    get().scheduleSave()
    get().notify(`Закладка ${formatTimecode(at, true)}`, 'success')
  },

  removeBookmark: (id) => {
    const project = get().project
    if (!project) return
    set({
      project: {
        ...project,
        bookmarks: (project.bookmarks ?? []).filter((bookmark) => bookmark.id !== id)
      }
    })
    get().scheduleSave()
  },

  setBookmarkNote: (id, note) => {
    const project = get().project
    if (!project) return
    set({
      project: {
        ...project,
        bookmarks: (project.bookmarks ?? []).map((bookmark) =>
          bookmark.id === id ? { ...bookmark, note } : bookmark
        )
      }
    })
    get().scheduleSave()
  },

  setNote: (defectId, note) => {
    const project = get().project
    if (!project) return
    const before = snapshotEditable(project, get().settings)
    const notes = { ...project.defectNotes }
    if (note.trim()) notes[defectId] = note
    else delete notes[defectId]

    // Manual marks keep their note on the mark itself so exports and reloads
    // stay consistent even if the defect-note map is ever cleared. A logical
    // mark stores the same note on every underlying mark.
    const markIds = markIdsForDefectId(defectId, project.marks)
    const marks =
      markIds.length > 0
        ? project.marks.map((mark) =>
            markIds.includes(mark.id) ? { ...mark, note } : mark
          )
        : project.marks

    set({ project: { ...project, defectNotes: notes, marks } })
    recordProjectChange(set, get, before, 'Заметка', `note:${defectId}`)
    get().scheduleSave()
  },

  addMark: () => {
    const project = get().project
    if (!project) return
    const before = snapshotEditable(project, get().settings)
    const words = project.transcript?.words ?? []
    const timeSelection = get().timeSelection
    const timeRange = markRangeForTimeSelection(words, timeSelection, project.duration)
    if (timeSelection && !timeRange) return
    const range =
      timeRange ??
      markRangeForSelection(words, get().selection, get().currentTime, project.duration)
    const mark: ManualMark = {
      id: crypto.randomUUID(),
      type: 'manual',
      start: range.start,
      end: range.end,
      wordIds: range.wordIds,
      note: '',
      createdAt: new Date().toISOString()
    }
    const marks = mergeMarkNeighbours([...project.marks, mark], [mark.id])
    const activeDefectId = manualDefectIdForMark(marks, mark.id) ?? `manual-${mark.id}`
    // Adding a mark can rebuild a logical group. The group's fill changed, so
    // every nested cut override is dropped and the cut is derived again. A
    // frozen (confirmed) cut is re-pinned by `reconcileManualPins` below.
    const cutOverrides = { ...(project.cutOverrides ?? {}) }
    const affectedMarkIds = markIdsForDefectId(activeDefectId, marks)
    for (const markId of affectedMarkIds) delete cutOverrides[`manual-${markId}`]
    for (const item of marks) {
      if (!affectedMarkIds.includes(item.id)) continue
      const previous = project.marks.find((mark) => mark.id === item.id)
      if (previous?.groupId) {
        delete cutOverrides[`manual-group-${previous.groupId}`]
      }
    }
    const confirmed = reconcileConfirmedIds(
      project.marks,
      marks,
      project.confirmedDefectIds
    )
    set({
      project: {
        ...project,
        marks,
        cutOverrides: reconcileManualPins(
          marks,
          confirmed,
          cutOverrides,
          get().settings.playback,
          project.duration,
          markIdsForDefectId(activeDefectId, marks).map((markId) => `manual-${markId}`).concat(activeDefectId)
        ),
        confirmedDefectIds: confirmed
      },
      activeDefectId,
      filter: 'all',
      selection: null,
      selectedWordId: null,
      timeSelection: null
    })
    recordProjectChange(set, get, before, 'Добавлена метка')
    get().scheduleSave()

    const changed = marks.find((item) => item.id === mark.id)
    const groupSize = changed?.groupId
      ? marks.filter((item) => item.groupId === changed.groupId).length
      : 1
    const count = range.wordIds.length
    if (groupSize > 1) {
      get().notify(`Метки объединены в логическую (${groupSize}) — подтверждается за раз`)
    } else {
      get().notify(
        count > 1
          ? `Метка на ${count} слов — введите заметку в панели справа`
          : 'Метка добавлена — введите заметку в панели справа'
      )
    }
  },

  removeDefect: (defectId, relatedIds = []) => {
    get().removeDefects([{ id: defectId, relatedIds }])
  },

  removeDefects: (items) => {
    const project = get().project
    if (!project || items.length === 0) return
    const before = snapshotEditable(project, get().settings)
    const notes = { ...project.defectNotes }
    const confirmed = new Set(project.confirmedDefectIds)
    const dismissed = new Set(project.dismissedDefectIds)
    const dismissedMarks = [...(project.dismissedMarks ?? [])]
    const archivedIds = new Set(dismissedMarks.map((mark) => mark.id))
    const overrides = { ...(project.cutOverrides ?? {}) }
    const removedMarkIds = new Set<string>()
    let manualCount = 0

    for (const item of items) {
      const markIds = markIdsForDefectId(item.id, project.marks)
      const stale = new Set([item.id, ...(item.relatedIds ?? [])])
      for (const id of stale) {
        delete notes[id]
        delete overrides[id]
        confirmed.delete(id)
        dismissed.delete(id)
      }
      if (markIds.length > 0) {
        manualCount++
        for (const markId of markIds) {
          removedMarkIds.add(markId)
          const mark = project.marks.find((candidate) => candidate.id === markId)
          if (mark && !archivedIds.has(mark.id)) {
            dismissedMarks.push(mark)
            archivedIds.add(mark.id)
          }
          const singleId = `manual-${markId}`
          delete notes[singleId]
          confirmed.delete(singleId)
          dismissed.delete(singleId)
        }
      } else {
        for (const id of stale) dismissed.add(id)
      }
    }

    set({
      project: {
        ...project,
        marks:
          removedMarkIds.size > 0
            ? project.marks.filter((mark) => !removedMarkIds.has(mark.id))
            : project.marks,
        confirmedDefectIds: [...confirmed],
        dismissedDefectIds: [...dismissed],
        dismissedMarks,
        defectNotes: notes,
        cutOverrides: overrides
      },
      activeDefectId: null
    })
    const label =
      items.length === 1
        ? manualCount > 0
          ? 'Удалена метка'
          : 'Удалён дефект'
        : `Удалено: ${items.length}`
    recordProjectChange(set, get, before, label)
    get().scheduleSave()
  },

  splitManualGroup: (defectId) => {
    const project = get().project
    if (!project) return
    const markIds = markIdsForDefectId(defectId, project.marks)
    const groupMarks = project.marks.filter((mark) => markIds.includes(mark.id))
    if (groupMarks.length < 2) return
    const before = snapshotEditable(project, get().settings)
    const notes = { ...project.defectNotes }
    const groupNote = notes[defectId]
    delete notes[defectId]

    const marks = project.marks.map((mark) =>
      markIds.includes(mark.id) ? { ...mark, groupId: undefined } : mark
    )
    const confirmed = reconcileConfirmedIds(
      project.marks,
      marks,
      project.confirmedDefectIds
    )
    for (const mark of groupMarks) {
      const singleId = `manual-${mark.id}`
      if (groupNote) notes[singleId] = groupNote
    }
    const cutOverrides = { ...(project.cutOverrides ?? {}) }
    // A split confirmed group keeps its frozen cuts: each part is still the
    // same reviewed defect, now with its own id. `reconcileManualPins` re-pins
    // the parts after the group override is dropped. Only a pinned group is
    // re-pinned; a group confirmed before pinning existed keeps following the
    // padding.
    const wasPinned = cutOverrides[defectId]?.pinned === true
    delete cutOverrides[defectId]
    set({
      project: {
        ...project,
        marks,
        confirmedDefectIds: confirmed,
        defectNotes: notes,
        cutOverrides: wasPinned
          ? reconcileManualPins(
              marks,
              confirmed,
              cutOverrides,
              get().settings.playback,
              project.duration,
              groupMarks.map((mark) => `manual-${mark.id}`)
            )
          : cutOverrides
      },
      activeDefectId: `manual-${groupMarks[0].id}`
    })
    recordProjectChange(set, get, before, 'Логическая метка разделена')
    get().scheduleSave()
    get().notify(`Метка разделена на ${groupMarks.length} отдельных`)
  },

  setCutBounds: (defectId, start, end, edge) => {
    const project = get().project
    if (!project) return
    const before = snapshotEditable(project, get().settings)
    const duration = Math.max(0.1, project.duration)
    const bounds = clampBounds(start, end, duration)
    const markIds = markIdsForDefectId(defectId, project.marks)
    const overrides = { ...(project.cutOverrides ?? {}) }

    if (markIds.length === 1 && !defectId.startsWith('manual-group-')) {
      // A single manual mark can capture its neighbours when the cut handle
      // reaches them. The mark keeps its original bounds; only the group ids
      // and the cut override change.
      const merged = mergeMarksAtSpan(project.marks, markIds[0], bounds, { edge })
      if (merged.activeDefectId) {
        for (const id of merged.affectedMarkIds) delete overrides[`manual-${id}`]
        for (const id of merged.affectedGroupIds) delete overrides[`manual-group-${id}`]
        overrides[merged.activeDefectId] = bounds
        const confirmed = reconcileConfirmedIds(
          project.marks,
          merged.marks,
          project.confirmedDefectIds
        )
        set({
          project: {
            ...project,
            marks: merged.marks,
            confirmedDefectIds: confirmed,
            cutOverrides: overrides
          },
          activeDefectId: merged.activeDefectId
        })
      } else {
        overrides[defectId] = bounds
        set({ project: { ...project, cutOverrides: overrides } })
      }
    } else {
      // Automatic defects and logical groups only move their own cut. A manual
      // group drops the overrides of its nested marks: the group handle is the
      // only boundary from now on.
      if (markIds.length > 1) {
        for (const markId of markIds) delete overrides[`manual-${markId}`]
        for (const mark of project.marks) {
          if (markIds.includes(mark.id) && mark.groupId) {
            delete overrides[`manual-group-${mark.groupId}`]
          }
        }
      }
      overrides[defectId] = bounds
      set({ project: { ...project, cutOverrides: overrides } })
    }

    recordProjectChange(set, get, before, 'Границы выреза', `cut:${defectId}`)
    get().scheduleSave()
  },

  resetCutBounds: (defect) => {
    const project = get().project
    if (!project) return
    if (!project.cutOverrides?.[defect.id]) return
    const before = snapshotEditable(project, get().settings)
    const overrides = { ...(project.cutOverrides ?? {}) }
    // A confirmed defect stays frozen: resetting the handle pins the freshly
    // derived cut instead of unfreezing it.
    if (project.confirmedDefectIds.includes(defect.id)) {
      const pinned = pinCutFor(
        { ...defect, confirmed: true },
        get().settings.playback,
        project.duration
      )
      if (pinned) overrides[defect.id] = pinned
      else delete overrides[defect.id]
    } else {
      delete overrides[defect.id]
    }
    set({ project: { ...project, cutOverrides: overrides } })
    recordProjectChange(
      set,
      get,
      before,
      'Сброшены границы выреза',
      `cut:${defect.id}`
    )
    get().scheduleSave()
  },

  undo: () => {
    const { project, history, showSettings, settingsSession, jobId } = get()
    if (!project || !canUndo(history)) return
    if (showSettings && jobId) return
    const entry = history.entries[history.index]
    // While settings are open, only roll back settings actions made since it
    // was opened; project edits stay untouched.
    if (showSettings && !isSettingsSessionEntry(entry, settingsSession)) return
    const target = history.index - 1
    const snapshot = stateForHistoryIndex(history, target)
    if (!entry || !snapshot) return
    set({
      project: applyEditable(project, snapshot),
      settings: applySettingsSnapshot(get().settings, snapshot),
      history: withHistoryIndex(history, target)
    })
    get().scheduleSave()
    scheduleSettingsSave(get)
    get().notify(`Отменено: ${entry.label}`)
  },

  redo: () => {
    const { project, history, showSettings, settingsSession, jobId } = get()
    if (!project || !canRedo(history)) return
    if (showSettings && jobId) return
    const entry = history.entries[history.index + 1]
    if (showSettings && !isSettingsSessionEntry(entry, settingsSession)) return
    const target = history.index + 1
    const snapshot = stateForHistoryIndex(history, target)
    if (!entry || !snapshot) return
    set({
      project: applyEditable(project, snapshot),
      settings: applySettingsSnapshot(get().settings, snapshot),
      history: withHistoryIndex(history, target)
    })
    get().scheduleSave()
    scheduleSettingsSave(get)
    get().notify(`Повторено: ${entry.label}`)
  },

  jumpHistory: (index) => {
    const { project, history, showSettings, settingsSession, jobId } = get()
    if (!project) return
    if (showSettings && jobId) return
    if (showSettings) {
      const targetEntry = index >= 0 ? history.entries[index] : undefined
      if (!isSettingsSessionEntry(targetEntry, settingsSession)) return
    }
    const snapshot = stateForHistoryIndex(history, index)
    if (!snapshot) return
    set({
      project: applyEditable(project, snapshot),
      settings: applySettingsSnapshot(get().settings, snapshot),
      history: withHistoryIndex(history, index)
    })
    get().scheduleSave()
    scheduleSettingsSave(get)
  },

  scheduleSave: () => scheduleSave(get),

  setCurrentTime: (time) => set({ currentTime: time }),
  setPlaying: (playing) => set({ playing }),
  setRate: (rate) => set({ rate }),
  setLoop: (loop) => set({ loop }),
  setActiveDefect: (id) => set({ activeDefectId: id }),
  selectWord: (id, extend = false) => {
    if (id === null) {
      set({ selectedWordId: null, selection: null, timeSelection: null })
      return
    }
    const current = get().selection
    if (extend && current) {
      set({
        selectedWordId: id,
        selection: { anchorId: current.anchorId, focusId: id },
        timeSelection: null
      })
    } else {
      set({
        selectedWordId: id,
        selection: { anchorId: id, focusId: id },
        timeSelection: null
      })
    }
  },
  selectRange: (anchorId, focusId) =>
    set({
      selectedWordId: focusId,
      selection: { anchorId, focusId },
      timeSelection: null
    }),
  selectTimeRange: (start, end) => {
    const duration = get().project?.duration ?? 0
    set({
      selectedWordId: null,
      selection: null,
      timeSelection: timeSelectionFor(start, end, duration)
    })
  },
  clearSelection: () =>
    set({ selectedWordId: null, selection: null, timeSelection: null }),
  setFollow: (follow) => set({ follow }),
  setFilter: (filter) => set({ filter }),
  setShowSettings: (show) => {
    const current = get()
    if (show) {
      if (!current.showSettings) {
        set({ showSettings: true, settingsSession: crypto.randomUUID() })
      } else if (!current.settingsSession) {
        set({ settingsSession: crypto.randomUUID() })
      }
      return
    }
    set({ showSettings: false, settingsSession: null })
  },
  setShowHistory: (show) => set({ showHistory: show }),
  setError: (error) => set({ error }),

  notify: (text, kind = 'info') => {
    const id = Date.now()
    set({ toast: { id, text, kind } })
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null })
    }, 3800)
  }
}))

function clampBounds(
  start: number,
  end: number,
  duration: number,
  minLength = 0.05
): { start: number; end: number } {
  const total = Math.max(minLength, duration)
  const safeStart = Math.min(Math.max(0, start), total - minLength)
  const safeEnd = Math.min(Math.max(safeStart + minLength, end), total)
  return { start: safeStart, end: safeEnd }
}

function recordProjectChange(
  set: (partial: Partial<AppStore>) => void,
  get: () => AppStore,
  before: ReturnType<typeof snapshotEditable>,
  label: string,
  mergeKey?: string,
  settingsSession?: string
): void {
  const project = get().project
  if (!project) return
  const after = snapshotEditable(project, get().settings)
  if (editableEquals(before, after)) return
  const entry = makeHistoryEntry(label, before, after, {
    ...(mergeKey ? { mergeKey } : {}),
    ...(settingsSession ? { settingsSession } : {})
  })
  set({ history: recordHistory(get().history, entry) })
}

async function createFromMedia(
  media: Awaited<ReturnType<typeof window.api.openVideo>>,
  set: (partial: Partial<AppStore>) => void,
  get: () => AppStore
): Promise<void> {
  if (!media) return
  await flushSave(get)
  const project = await window.api.createProject(media)
  const registered = await window.api.registerMedia(media.path)
  set({
    project,
    peaks: null,
    mediaUrl: registered.url,
    currentTime: 0,
    playing: false,
    loop: null,
    activeDefectId: null,
    selectedWordId: null,
    filter: 'all',
    progress: null,
    jobId: null,
    follow: true,
    history: createHistoryState()
  })
  await get().refreshProjects()
  if (!get().status?.modelReady) {
    get().setShowSettings(true)
    get().notify('Скачайте модель CrisperWhisper, чтобы начать распознавание')
  }
}

function scheduleSave(get: () => AppStore): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void flushSave(get)
  }, 500)
}

async function flushSave(get: () => AppStore): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  const project = get().project
  if (!project) return
  try {
    await window.api.saveProject(project)
  } catch {
    // The next edit will retry; do not spam the user.
  }
}

function scheduleSettingsSave(get: () => AppStore): void {
  if (settingsTimer) clearTimeout(settingsTimer)
  settingsTimer = setTimeout(() => {
    settingsTimer = null
    void window.api.saveSettings(get().settings).catch(() => undefined)
  }, 450)
}

function attachListeners(
  set: (partial: Partial<AppStore>) => void,
  get: () => AppStore
): void {
  if (listenersAttached) return
  listenersAttached = true

  window.api.onProgress((progress) => {
    const state = get()
    if (!state.project || progress.projectId !== state.project.id) return
    if (!state.jobId) {
      // Reopened a project whose background job is still running.
      set({ progress, jobId: progress.jobId })
      return
    }
    if (progress.jobId !== state.jobId) return
    set({ progress })
  })

  window.api.onPartial((partial) => {
    const state = get()
    if (!state.project || partial.projectId !== state.project.id) return
    if (state.jobId && partial.jobId !== state.jobId) return
    // The first partial resets review state on disk because defect ids change
    // after re-recognition. Later partials keep the user's unsaved edits to
    // the already visible prefix.
    const keepReview = partial.chunk > 1
    set({
      project: {
        ...partial.project,
        marks: state.project.marks,
        bookmarks: state.project.bookmarks ?? partial.project.bookmarks ?? [],
        cutOverrides: keepReview
          ? state.project.cutOverrides
          : partial.project.cutOverrides,
        confirmedDefectIds: keepReview
          ? state.project.confirmedDefectIds
          : partial.project.confirmedDefectIds,
        dismissedDefectIds: keepReview
          ? state.project.dismissedDefectIds
          : partial.project.dismissedDefectIds,
        dismissedMarks: state.project.dismissedMarks,
        defectNotes: keepReview ? state.project.defectNotes : partial.project.defectNotes
      },
      peaks: partial.peaks ?? state.peaks,
      jobId: partial.jobId,
      ...(keepReview ? {} : { history: createHistoryState() })
    })
  })

  window.api.onDone((done) => {
    const state = get()
    const isCurrentJob = state.jobId === done.jobId

    if (state.project && state.project.id === done.projectId) {
      set({
        project: {
          ...done.project,
          marks: state.project.marks,
          bookmarks: state.project.bookmarks ?? done.project.bookmarks ?? [],
          cutOverrides: state.project.cutOverrides,
          confirmedDefectIds: state.project.confirmedDefectIds,
          dismissedDefectIds: state.project.dismissedDefectIds,
          dismissedMarks: state.project.dismissedMarks,
          defectNotes: state.project.defectNotes
        },
        peaks: done.peaks ?? state.peaks,
        ...(isCurrentJob ? { progress: null, jobId: null } : {}),
        activeDefectId: null
      })
      get().notify('Транскрипт готов', 'success')
    } else if (isCurrentJob) {
      // The project was closed while its job was still running.
      set({ progress: null, jobId: null })
    }

    void get().refreshProjects()
  })

  window.api.onError((error) => {
    const state = get()
    if (!state.project || error.projectId !== state.project.id) return
    if (state.jobId && error.jobId !== state.jobId) return
    set({ error: error.message, progress: null, jobId: null })
  })

  window.api.onModelProgress((progress) => {
    set({ modelDownload: progress })
  })
}
