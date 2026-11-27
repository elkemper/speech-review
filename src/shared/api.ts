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
import type { DefectTableCommand, DefectTableState } from './defectTable'

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

  /** Open or focus the defect table window for the current project. */
  openDefectTable(): Promise<void>
  closeDefectTable(): Promise<void>
  /** Main window → main process → table window. */
  sendDefectTableState(state: DefectTableState): void
  /** Table window: asks the main window for a fresh snapshot. */
  requestDefectTableState(): void
  /** Table window → main process → main window. */
  sendDefectTableCommand(command: DefectTableCommand): void
  onDefectTableState(callback: (state: DefectTableState) => void): () => void
  /** The table window is ready or wants a fresh snapshot. */
  onDefectTableReady(callback: () => void): () => void
  onDefectTableCommand(callback: (command: DefectTableCommand) => void): () => void

  showItemInFolder(path: string): Promise<void>
}
