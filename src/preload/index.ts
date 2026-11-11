import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppApi } from '@shared/api'
import type {
  EngineStatus,
  ExportRequest,
  MediaInfo,
  MediaRegistration,
  ModelDownloadProgress,
  ModelId,
  Peaks,
  Project,
  ProjectSummary,
  Settings,
  StartTranscriptionResult,
  TranscribeDone,
  TranscribeError,
  TranscribePartial,
  TranscribeProgress,
  TranscribeRequest
} from '@shared/types'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: AppApi = {
  getEngineStatus: (): Promise<EngineStatus> => ipcRenderer.invoke(IPC.engineStatus),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.settingsGet),
  saveSettings: (settings: Settings): Promise<void> =>
    ipcRenderer.invoke(IPC.settingsSave, settings),

  openVideo: (): Promise<MediaInfo | null> => ipcRenderer.invoke(IPC.mediaOpen),
  openVideoPath: (path: string): Promise<MediaInfo | null> =>
    ipcRenderer.invoke(IPC.mediaOpenPath, path),
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  registerMedia: (path: string): Promise<MediaRegistration> =>
    ipcRenderer.invoke(IPC.mediaRegister, path),

  listProjects: (): Promise<ProjectSummary[]> => ipcRenderer.invoke(IPC.projectsList),
  createProject: (media: MediaInfo): Promise<Project> =>
    ipcRenderer.invoke(IPC.projectsCreate, media),
  loadProject: (id: string): Promise<{ project: Project; peaks: Peaks | null }> =>
    ipcRenderer.invoke(IPC.projectsLoad, id),
  saveProject: (project: Project): Promise<void> => ipcRenderer.invoke(IPC.projectsSave, project),
  deleteProject: (id: string): Promise<void> => ipcRenderer.invoke(IPC.projectsDelete, id),

  startTranscription: (request: TranscribeRequest): Promise<StartTranscriptionResult> =>
    ipcRenderer.invoke(IPC.transcribeStart, request),
  cancelTranscription: (jobId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.transcribeCancel, jobId),

  downloadModel: (modelId: ModelId): Promise<{ path: string }> =>
    ipcRenderer.invoke(IPC.modelsDownload, modelId),

  onProgress: (callback: (progress: TranscribeProgress) => void): (() => void) =>
    subscribe(IPC.transcribeProgress, callback),
  onPartial: (callback: (partial: TranscribePartial) => void): (() => void) =>
    subscribe(IPC.transcribePartial, callback),
  onDone: (callback: (done: TranscribeDone) => void): (() => void) =>
    subscribe(IPC.transcribeDone, callback),
  onError: (callback: (error: TranscribeError) => void): (() => void) =>
    subscribe(IPC.transcribeError, callback),
  onModelProgress: (callback: (progress: ModelDownloadProgress) => void): (() => void) =>
    subscribe(IPC.modelProgress, callback),
  onMenuAction: (callback: (action: string) => void): (() => void) =>
    subscribe('menu:action', callback),

  exportProject: (input: ExportRequest): Promise<string | null> =>
    ipcRenderer.invoke(IPC.exportProject, input),

  showItemInFolder: (path: string): Promise<void> =>
    ipcRenderer.invoke(IPC.shellShowItem, path)
}

contextBridge.exposeInMainWorld('api', api)
