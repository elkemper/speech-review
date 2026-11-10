import { create } from 'zustand'
import { DEFAULT_RULES } from '@shared/defects'
import type {
  DefectRules,
  EngineStatus,
  ManualMark,
  ModelDownloadProgress,
  ModelId,
  Peaks,
  Project,
  ProjectSummary,
  Settings,
  TranscribeProgress
} from '@shared/types'
import { clamp } from '@shared/format'

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
  follow: boolean

  jobId: string | null
  progress: TranscribeProgress | null
  modelDownload: ModelDownloadProgress | null
  downloadingModel: boolean

  showSettings: boolean
  filter: DefectFilter
  onlyUnreviewed: boolean

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
  updateSettings: (patch: Partial<Settings>) => void
  setRules: (patch: Partial<DefectRules>) => void
  toggleReviewed: (defectId: string) => void
  setNote: (defectId: string, note: string) => void
  addMark: () => void
  removeMark: (markId: string) => void
  scheduleSave: () => void
  setCurrentTime: (time: number) => void
  setPlaying: (playing: boolean) => void
  setRate: (rate: number) => void
  setLoop: (loop: { start: number; end: number } | null) => void
  setActiveDefect: (id: string | null) => void
  selectWord: (id: number | null) => void
  setFollow: (follow: boolean) => void
  setFilter: (filter: DefectFilter) => void
  setOnlyUnreviewed: (value: boolean) => void
  setShowSettings: (show: boolean) => void
  setError: (error: string | null) => void
  notify: (text: string, kind?: Toast['kind']) => void
}

const FALLBACK_SETTINGS: Settings = {
  language: 'ru',
  modelId: 'q8_0',
  backend: 'metal',
  rules: DEFAULT_RULES
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
  follow: true,

  jobId: null,
  progress: null,
  modelDownload: null,
  downloadingModel: false,

  showSettings: false,
  filter: 'all',
  onlyUnreviewed: false,

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
        filter: 'all',
        onlyUnreviewed: false,
        progress: null,
        jobId: null,
        follow: true
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
      jobId: null,
      progress: null
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
          jobId: null,
          progress: null
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
    const settings: Settings = {
      ...get().settings,
      ...patch,
      rules: patch.rules ?? get().settings.rules
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

  toggleReviewed: (defectId) => {
    const project = get().project
    if (!project) return
    const reviewed = new Set(project.reviewedDefectIds)
    if (reviewed.has(defectId)) reviewed.delete(defectId)
    else reviewed.add(defectId)
    set({ project: { ...project, reviewedDefectIds: [...reviewed] } })
    get().scheduleSave()
  },

  setNote: (defectId, note) => {
    const project = get().project
    if (!project) return
    const notes = { ...project.defectNotes }
    if (note.trim()) notes[defectId] = note
    else delete notes[defectId]

    // Manual marks keep their note on the mark itself so exports and reloads
    // stay consistent even if the defect-note map is ever cleared.
    const marks = defectId.startsWith('manual-')
      ? project.marks.map((mark) =>
          mark.id === defectId.slice('manual-'.length) ? { ...mark, note } : mark
        )
      : project.marks

    set({ project: { ...project, defectNotes: notes, marks } })
    get().scheduleSave()
  },

  addMark: () => {
    const project = get().project
    if (!project) return
    const start = clamp(get().currentTime, 0, Math.max(0, project.duration - 0.2))
    const end = Math.min(project.duration, start + 1.5)
    const mark: ManualMark = {
      id: crypto.randomUUID(),
      type: 'manual',
      start,
      end,
      note: '',
      createdAt: new Date().toISOString()
    }
    set({
      project: { ...project, marks: [...project.marks, mark] },
      activeDefectId: `manual-${mark.id}`,
      filter: 'all'
    })
    get().scheduleSave()
    get().notify('Метка добавлена — введите заметку в панели справа')
  },

  removeMark: (markId) => {
    const project = get().project
    if (!project) return
    const defectId = `manual-${markId}`
    const notes = { ...project.defectNotes }
    delete notes[defectId]
    set({
      project: {
        ...project,
        marks: project.marks.filter((mark) => mark.id !== markId),
        reviewedDefectIds: project.reviewedDefectIds.filter((id) => id !== defectId),
        defectNotes: notes
      }
    })
    get().scheduleSave()
  },

  scheduleSave: () => scheduleSave(get),

  setCurrentTime: (time) => set({ currentTime: time }),
  setPlaying: (playing) => set({ playing }),
  setRate: (rate) => set({ rate }),
  setLoop: (loop) => set({ loop }),
  setActiveDefect: (id) => set({ activeDefectId: id }),
  selectWord: (id) => set({ selectedWordId: id }),
  setFollow: (follow) => set({ follow }),
  setFilter: (filter) => set({ filter }),
  setOnlyUnreviewed: (value) => set({ onlyUnreviewed: value }),
  setShowSettings: (show) => set({ showSettings: show }),
  setError: (error) => set({ error }),

  notify: (text, kind = 'info') => {
    const id = Date.now()
    set({ toast: { id, text, kind } })
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null })
    }, 3800)
  }
}))

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
    follow: true
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

  window.api.onDone((done) => {
    const state = get()
    const isCurrentJob = state.jobId === done.jobId

    if (state.project && state.project.id === done.projectId) {
      set({
        project: done.project,
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
