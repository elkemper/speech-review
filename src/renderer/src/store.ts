import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { findWordIdsInRange } from '@shared/defects'
import {
  markIdsForDefectId,
  manualDefectIdForMark,
  mergeMarkNeighbours,
  reconcileReviewedIds
} from '@shared/marks'
import type {
  DefectRules,
  EngineStatus,
  ExportSettings,
  ManualMark,
  ModelDownloadProgress,
  ModelId,
  Peaks,
  PlaybackSettings,
  Project,
  ProjectSummary,
  Settings,
  TranscribeProgress
} from '@shared/types'
import { markRangeForSelection, type WordSelection } from './selection'
import {
  applyEditable,
  canRedo,
  canUndo,
  createHistoryState,
  editableEquals,
  makeHistoryEntry,
  recordHistory,
  snapshotEditable,
  stateForHistoryIndex,
  withHistoryIndex,
  type HistoryState
} from './history'

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
export type SettingsPatch = Partial<Omit<Settings, 'rules' | 'export' | 'playback'>> & {
  rules?: Partial<DefectRules>
  export?: Partial<ExportSettings>
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
  follow: boolean

  jobId: string | null
  progress: TranscribeProgress | null
  modelDownload: ModelDownloadProgress | null
  downloadingModel: boolean

  showSettings: boolean
  showHistory: boolean
  filter: DefectFilter
  onlyUnreviewed: boolean
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
  updateSettings: (patch: SettingsPatch) => void
  setRules: (patch: Partial<DefectRules>) => void
  toggleReviewed: (defectId: string, label?: string) => void
  setNote: (defectId: string, note: string) => void
  addMark: () => void
  removeDefect: (defectId: string) => void
  splitManualGroup: (defectId: string) => void
  setDefectBounds: (defectId: string, start: number, end: number) => void
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
  clearSelection: () => void
  setFollow: (follow: boolean) => void
  setFilter: (filter: DefectFilter) => void
  setOnlyUnreviewed: (value: boolean) => void
  setShowSettings: (show: boolean) => void
  setShowHistory: (show: boolean) => void
  setError: (error: string | null) => void
  notify: (text: string, kind?: Toast['kind']) => void
}

const FALLBACK_SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  rules: { ...DEFAULT_SETTINGS.rules },
  export: { ...DEFAULT_SETTINGS.export, fields: [...DEFAULT_SETTINGS.export.fields] },
  playback: { ...DEFAULT_SETTINGS.playback }
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
  follow: true,

  jobId: null,
  progress: null,
  modelDownload: null,
  downloadingModel: false,

  showSettings: false,
  showHistory: false,
  filter: 'all',
  onlyUnreviewed: false,
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
        filter: 'all',
        onlyUnreviewed: false,
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
      await get().refreshStatus()
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

  updateSettings: (patch) => {
    const current = get().settings
    const settings: Settings = {
      ...current,
      ...patch,
      rules: { ...current.rules, ...patch.rules },
      export: { ...current.export, ...patch.export },
      playback: { ...current.playback, ...patch.playback }
    }
    set({ settings })

    const project = get().project
    if (project) {
      set({
        project: {
          ...project,
          language: settings.language,
          modelId: settings.modelId,
          backend: settings.backend,
          rules: settings.rules
        }
      })
      get().scheduleSave()
    }

    if (patch.modelId || patch.language || patch.backend) {
      void window.api
        .saveSettings(settings)
        .then(() => get().refreshStatus())
        .catch((error) => set({ error: cleanError(error) }))
    } else {
      scheduleSettingsSave(get)
    }
  },

  setRules: (patch) => {
    get().updateSettings({ rules: { ...get().settings.rules, ...patch } })
  },

  toggleReviewed: (defectId, label) => {
    const project = get().project
    if (!project) return
    const before = snapshotEditable(project)
    const reviewed = new Set(project.reviewedDefectIds)
    const nextReviewed = !reviewed.has(defectId)
    if (nextReviewed) reviewed.add(defectId)
    else reviewed.delete(defectId)
    set({ project: { ...project, reviewedDefectIds: [...reviewed] } })
    recordProjectChange(
      set,
      get,
      before,
      label ?? (nextReviewed ? 'Отмечено проверенным' : 'Снята отметка')
    )
    get().scheduleSave()
  },

  setNote: (defectId, note) => {
    const project = get().project
    if (!project) return
    const before = snapshotEditable(project)
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
    const before = snapshotEditable(project)
    const words = project.transcript?.words ?? []
    const range = markRangeForSelection(
      words,
      get().selection,
      get().currentTime,
      project.duration
    )
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
    set({
      project: {
        ...project,
        marks,
        reviewedDefectIds: reconcileReviewedIds(
          project.marks,
          marks,
          project.reviewedDefectIds
        )
      },
      activeDefectId,
      filter: 'all',
      selection: null,
      selectedWordId: null
    })
    recordProjectChange(set, get, before, 'Добавлена метка')
    get().scheduleSave()

    const changed = marks.find((item) => item.id === mark.id)
    const groupSize = changed?.groupId
      ? marks.filter((item) => item.groupId === changed.groupId).length
      : 1
    const count = range.wordIds.length
    if (groupSize > 1) {
      get().notify(`Метки объединены в логическую (${groupSize}) — проверяется за раз`)
    } else {
      get().notify(
        count > 1
          ? `Метка на ${count} слов — введите заметку в панели справа`
          : 'Метка добавлена — введите заметку в панели справа'
      )
    }
  },

  removeDefect: (defectId) => {
    const project = get().project
    if (!project) return
    const markIds = markIdsForDefectId(defectId, project.marks)
    if (markIds.length === 0) return
    const before = snapshotEditable(project)
    const notes = { ...project.defectNotes }
    delete notes[defectId]
    for (const markId of markIds) delete notes[`manual-${markId}`]
    const reviewed = project.reviewedDefectIds.filter(
      (id) =>
        id !== defectId && !markIds.some((markId) => id === `manual-${markId}`)
    )
    set({
      project: {
        ...project,
        marks: project.marks.filter((mark) => !markIds.includes(mark.id)),
        reviewedDefectIds: reviewed,
        defectNotes: notes
      },
      activeDefectId: null
    })
    recordProjectChange(set, get, before, 'Удалена метка')
    get().scheduleSave()
  },

  splitManualGroup: (defectId) => {
    const project = get().project
    if (!project) return
    const markIds = markIdsForDefectId(defectId, project.marks)
    const groupMarks = project.marks.filter((mark) => markIds.includes(mark.id))
    if (groupMarks.length < 2) return
    const before = snapshotEditable(project)
    const notes = { ...project.defectNotes }
    const groupNote = notes[defectId]
    delete notes[defectId]

    const marks = project.marks.map((mark) =>
      markIds.includes(mark.id) ? { ...mark, groupId: undefined } : mark
    )
    const reviewed = reconcileReviewedIds(
      project.marks,
      marks,
      project.reviewedDefectIds
    )
    for (const mark of groupMarks) {
      const singleId = `manual-${mark.id}`
      if (groupNote) notes[singleId] = groupNote
    }
    set({
      project: {
        ...project,
        marks,
        reviewedDefectIds: reviewed,
        defectNotes: notes
      },
      activeDefectId: `manual-${groupMarks[0].id}`
    })
    recordProjectChange(set, get, before, 'Логическая метка разделена')
    get().scheduleSave()
    get().notify(`Метка разделена на ${groupMarks.length} отдельных`)
  },

  setDefectBounds: (defectId, start, end) => {
    const project = get().project
    if (!project) return
    const before = snapshotEditable(project)
    const duration = Math.max(0.1, project.duration)
    const bounds = clampBounds(start, end, duration)
    const markIds = markIdsForDefectId(defectId, project.marks)

    if (markIds.length > 0) {
      const groupMarks = project.marks.filter((mark) => markIds.includes(mark.id))
      const groupStart = Math.min(...groupMarks.map((mark) => mark.start))
      const groupEnd = Math.max(...groupMarks.map((mark) => mark.end))
      const startChanged = Math.abs(bounds.start - groupStart) > 1e-6
      const endChanged = Math.abs(bounds.end - groupEnd) > 1e-6
      const firstMark = groupMarks.reduce((a, b) => (a.start <= b.start ? a : b))
      const lastMark = groupMarks.reduce((a, b) => (a.end >= b.end ? a : b))
      const changedIds: string[] = []
      const words = project.transcript?.words ?? []

      let marks = project.marks.map((mark) => {
        if (startChanged && mark.id === firstMark.id) {
          changedIds.push(mark.id)
          const start = bounds.start
          return {
            ...mark,
            start,
            wordIds: findWordIdsInRange(words, start, Math.max(start, mark.end))
          }
        }
        if (endChanged && mark.id === lastMark.id) {
          changedIds.push(mark.id)
          const end = bounds.end
          return {
            ...mark,
            end,
            wordIds: findWordIdsInRange(words, Math.min(mark.start, end), end)
          }
        }
        return mark
      })
      if (changedIds.length === 0) return

      marks = mergeMarkNeighbours(marks, changedIds)
      const changedId = changedIds[0]
      const activeId = manualDefectIdForMark(marks, changedId) ?? defectId
      const reviewed = reconcileReviewedIds(
        project.marks,
        marks,
        project.reviewedDefectIds
      )
      set({
        project: { ...project, marks, reviewedDefectIds: reviewed },
        activeDefectId: activeId
      })
    } else {
      set({
        project: {
          ...project,
          defectOverrides: {
            ...project.defectOverrides,
            [defectId]: { start: bounds.start, end: bounds.end }
          }
        }
      })
    }

    recordProjectChange(set, get, before, 'Границы дефекта', `bounds:${defectId}`)
    get().scheduleSave()
  },

  undo: () => {
    const { project, history } = get()
    if (!project || !canUndo(history)) return
    const entry = history.entries[history.index]
    const target = history.index - 1
    const snapshot = stateForHistoryIndex(history, target)
    if (!entry || !snapshot) return
    set({
      project: applyEditable(project, snapshot),
      history: withHistoryIndex(history, target)
    })
    get().scheduleSave()
    get().notify(`Отменено: ${entry.label}`)
  },

  redo: () => {
    const { project, history } = get()
    if (!project || !canRedo(history)) return
    const entry = history.entries[history.index + 1]
    const target = history.index + 1
    const snapshot = stateForHistoryIndex(history, target)
    if (!entry || !snapshot) return
    set({
      project: applyEditable(project, snapshot),
      history: withHistoryIndex(history, target)
    })
    get().scheduleSave()
    get().notify(`Повторено: ${entry.label}`)
  },

  jumpHistory: (index) => {
    const { project, history } = get()
    if (!project) return
    const snapshot = stateForHistoryIndex(history, index)
    if (!snapshot) return
    set({
      project: applyEditable(project, snapshot),
      history: withHistoryIndex(history, index)
    })
    get().scheduleSave()
  },

  scheduleSave: () => scheduleSave(get),

  setCurrentTime: (time) => set({ currentTime: time }),
  setPlaying: (playing) => set({ playing }),
  setRate: (rate) => set({ rate }),
  setLoop: (loop) => set({ loop }),
  setActiveDefect: (id) => set({ activeDefectId: id }),
  selectWord: (id, extend = false) => {
    if (id === null) {
      set({ selectedWordId: null, selection: null })
      return
    }
    const current = get().selection
    if (extend && current) {
      set({ selectedWordId: id, selection: { anchorId: current.anchorId, focusId: id } })
    } else {
      set({ selectedWordId: id, selection: { anchorId: id, focusId: id } })
    }
  },
  selectRange: (anchorId, focusId) =>
    set({ selectedWordId: focusId, selection: { anchorId, focusId } }),
  clearSelection: () => set({ selectedWordId: null, selection: null }),
  setFollow: (follow) => set({ follow }),
  setFilter: (filter) => set({ filter }),
  setOnlyUnreviewed: (value) => set({ onlyUnreviewed: value }),
  setShowSettings: (show) => set({ showSettings: show }),
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
  mergeKey?: string
): void {
  const project = get().project
  if (!project) return
  const after = snapshotEditable(project)
  if (editableEquals(before, after)) return
  const entry = makeHistoryEntry(label, before, after, mergeKey ? { mergeKey } : {})
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
    onlyUnreviewed: false,
    progress: null,
    jobId: null,
    follow: true,
    history: createHistoryState()
  })
  await get().refreshProjects()
  if (!get().status?.modelReady) {
    set({ showSettings: true })
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
        defectOverrides: keepReview
          ? state.project.defectOverrides
          : partial.project.defectOverrides,
        reviewedDefectIds: keepReview
          ? state.project.reviewedDefectIds
          : partial.project.reviewedDefectIds,
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
          defectOverrides: state.project.defectOverrides,
          reviewedDefectIds: state.project.reviewedDefectIds,
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
