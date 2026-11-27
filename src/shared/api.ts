import type {
  Defect,
  EngineStatus,
  ExportRequest,
  ManualMark,
  MediaInfo,
  MediaRegistration,
  MediaStreamInfo,
  ModelDownloadProgress,
  ModelId,
  ModelStateInfo,
  ModelUpdateCheckResult,
  Peaks,
  Project,
  ProjectSummary,
  Settings,
  StartTranscriptionResult,
  TranscribeDone,
  TranscribeError,
  TranscribePartial,
  TranscribeProgress,
  TranscribeRequest,
  VideoExportProgress,
  VideoExportRequest
} from './types'

export interface AppApi {
  getEngineStatus(): Promise<EngineStatus>
  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<void>

  openVideo(): Promise<MediaInfo | null>
  openVideoPath(path: string): Promise<MediaInfo | null>
  /** Frame rate and sample rate for the export dialog's length preview. */
  probeVideo(path: string): Promise<MediaStreamInfo | null>
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
  getModelStates(): Promise<ModelStateInfo[]>
  deleteModel(modelId: ModelId): Promise<void>
  checkModelUpdates(): Promise<ModelUpdateCheckResult>

  onProgress(callback: (progress: TranscribeProgress) => void): () => void
  onPartial(callback: (partial: TranscribePartial) => void): () => void
  onDone(callback: (done: TranscribeDone) => void): () => void
  onError(callback: (error: TranscribeError) => void): () => void
  onModelProgress(callback: (progress: ModelDownloadProgress) => void): () => void
  onMenuAction(callback: (action: string) => void): () => void

  exportProject(input: ExportRequest): Promise<string | null>
  exportVideo(input: VideoExportRequest): Promise<string | null>
  cancelVideoExport(): Promise<void>
  onVideoExportProgress(callback: (progress: VideoExportProgress) => void): () => void

  showItemInFolder(path: string): Promise<void>
}
