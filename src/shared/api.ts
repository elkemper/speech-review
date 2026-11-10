import type {
  Defect,
  EngineStatus,
  ExportRequest,
  ManualMark,
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
  TranscribeProgress,
  TranscribeRequest
} from './types'

export interface AppApi {
  getEngineStatus(): Promise<EngineStatus>
  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<void>

  openVideo(): Promise<MediaInfo | null>
  openVideoPath(path: string): Promise<MediaInfo | null>
  pathForFile(file: File): string
  registerMedia(path: string): Promise<MediaRegistration>

  listProjects(): Promise<ProjectSummary[]>
  createProject(media: MediaInfo): Promise<Project>
  loadProject(id: string): Promise<{ project: Project; peaks: Peaks | null }>
  saveProject(project: Project): Promise<void>
  deleteProject(id: string): Promise<void>

  startTranscription(request: TranscribeRequest): Promise<StartTranscriptionResult>
  cancelTranscription(jobId: string): Promise<void>

  downloadModel(modelId: ModelId): Promise<{ path: string }>

  onProgress(callback: (progress: TranscribeProgress) => void): () => void
  onDone(callback: (done: TranscribeDone) => void): () => void
  onError(callback: (error: TranscribeError) => void): () => void
  onModelProgress(callback: (progress: ModelDownloadProgress) => void): () => void
  onMenuAction(callback: (action: string) => void): () => void

  exportProject(input: ExportRequest): Promise<string | null>

  showItemInFolder(path: string): Promise<void>
}
