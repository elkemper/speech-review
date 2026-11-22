export type Backend = 'metal' | 'cpu'
export type ModelId = 'q8_0' | 'bf16' | 'q4_k'
/** Interface language. `Settings.language` is the recognition language. */
export type UiLanguage = 'ru' | 'en'

export type WordKind = 'word' | 'filler' | 'vocal_sound' | 'event'

export type DefectType =
  | 'filler'
  | 'pause'
  | 'repetition'
  | 'elongation'
  | 'false_start'
  | 'vocal_sound'
  | 'unclear'
  | 'manual'

export type Severity = 'low' | 'medium' | 'high'

export interface RawWord {
  start_sample: number
  end_sample: number
  word: string
  confidence?: number
}

export interface Word {
  id: number
  index: number
  text: string
  normalized: string
  start: number
  end: number
  duration: number
  kind: WordKind
  confidence: number | null
}

export interface Segment {
  id: number
  start: number
  end: number
  wordIds: number[]
  text: string
}

export interface Transcript {
  version: 1
  language: string
  sampleRate: number
  duration: number
  words: Word[]
  segments: Segment[]
  text: string
}

export interface Defect {
  id: string
  type: DefectType
  start: number
  end: number
  wordIds: number[]
  /** Manual logical marks: ids of the underlying marks. */
  markIds?: string[]
  /** Automatically grouped defects: ids of the underlying defects. */
  groupIds?: string[]
  /** Automatically grouped defects: every type inside the group. */
  groupTypes?: DefectType[]
  text: string
  severity: Severity
  source: 'auto' | 'manual'
  /** Confirmed as a real defect. Does not affect skip mode. */
  confirmed: boolean
  /** Deleted as a false positive. Excluded from skip mode and export. */
  dismissed: boolean
  /** Computed only: a suppressed detection revealed for preview. Never persisted. */
  candidate?: boolean
  note: string
}

export interface ManualMark {
  id: string
  type: DefectType
  start: number
  end: number
  /** Exact selected words. Older marks do not have this field. */
  wordIds?: number[]
  /** Adjacent marks with the same id form one logical mark. */
  groupId?: string
  note: string
  createdAt: string
}

export interface DefectBoundsOverride {
  start: number
  end: number
  /**
   * Written when the defect was confirmed: the cut is frozen at the padding in
   * effect at that moment. Removing the confirmation drops pinned ranges only;
   * a range dragged by hand is never pinned and survives.
   */
  pinned?: boolean
}

export interface CutRange {
  start: number
  end: number
}

export interface DefectRules {
  fillerWords: string[]
  multiWordFillers: string[][]
  excludePauseAfterSentenceEnd: boolean
  repetitionWindowSec: number
  elongationMinRepeats: number
  detectLexicalFillers: boolean
  lowConfidenceThreshold: number
  /** Minimum duration for each automatically detected defect type. */
  minDurationByType: Record<DefectType, number>
  /** Automatic defect types that are detected at all. Missing entries mean on. */
  enabledTypes: Record<DefectType, boolean>
  /** Whether neighbouring automatic defects are merged into groups. */
  autoGroupEnabled: boolean
  /** Group neighbouring automatic defects when the gap is at most this value. 0 disables grouping. */
  autoGroupGapSec: number
}

export interface Bookmark {
  id: string
  time: number
  note: string
  createdAt: string
}

export interface MediaInfo {
  path: string
  name: string
  size: number
  mtimeMs: number
}

export interface Peaks {
  peaksPerSecond: number
  duration: number
  min: number[]
  max: number[]
}

export interface Project {
  id: string
  name: string
  video: MediaInfo
  duration: number
  language: string
  modelId: ModelId
  backend: Backend
  createdAt: string
  updatedAt: string
  marks: ManualMark[]
  rules: DefectRules
  /**
   * User-adjusted final cut ranges keyed by defect id. The defect itself keeps
   * its detected/marked bounds; these are the handles that decide what is cut.
   */
  cutOverrides: Record<string, DefectBoundsOverride>
  /** Defects and marks the user confirmed as real. */
  confirmedDefectIds: string[]
  /** Automatically detected defects the user deleted as false positives. */
  dismissedDefectIds: string[]
  /** Manual marks the user deleted. Kept so the card can be restored. */
  dismissedMarks: ManualMark[]
  defectNotes: Record<string, string>
  /** Explicit navigation markers. Not part of undo/redo history. */
  bookmarks: Bookmark[]
  transcriptComplete: boolean
  transcript?: Transcript
}

export interface ProjectSummary {
  id: string
  name: string
  videoName: string
  duration: number
  updatedAt: string
  hasTranscript: boolean
  transcriptComplete: boolean
}

export interface EngineStatus {
  enginePath: string | null
  engineReady: boolean
  ffmpegPath: string | null
  ffmpegReady: boolean
  modelPath: string | null
  modelReady: boolean
  modelId: ModelId
  modelBytes: number
  backend: Backend
  platform: string
  appVersion: string
}

export interface ModelStateInfo {
  modelId: ModelId
  path: string
  ready: boolean
  bytes: number
}

export type ExportField =
  | 'start_tc'
  | 'end_tc'
  | 'start_sec'
  | 'end_sec'
  | 'duration_sec'
  | 'type'
  | 'severity'
  | 'source'
  | 'confirmed'
  | 'text'
  | 'note'
  | 'cut'
  | 'defect_start_tc'
  | 'defect_end_tc'
  | 'defect_start_sec'
  | 'defect_end_sec'
  | 'defect_duration_sec'

export interface ExportSettings {
  fields: ExportField[]
  delimiter: ';' | ','
  includeHeader: boolean
}

export type VideoExportResolution = 'source' | '1080' | '720' | '480'
export type VideoExportQuality = 'high' | 'balanced' | 'compact'
export type VideoExportEncoder =
  | 'h264'
  | 'hevc'
  | 'h264_videotoolbox'
  | 'hevc_videotoolbox'

export interface VideoExportSettings {
  resolution: VideoExportResolution
  quality: VideoExportQuality
  encoder: VideoExportEncoder
}

/**
 * A defect prepared for export. `start`/`end` are the original detected or
 * marked span; `cutStart`/`cutEnd` are the final cut bounds. A `null` cut means
 * the defect is not removed at all (for example a pause shorter than the kept
 * room tone).
 */
export interface ExportDefect extends Defect {
  cutStart: number | null
  cutEnd: number | null
}

export interface SkipPadding {
  before: number
  after: number
}

export interface PlaybackSettings {
  skipEnabled: boolean
  /** Global fallback padding used when a type has no explicit entry. */
  skipBeforeSec: number
  skipAfterSec: number
  /**
   * Room tone kept inside a pause defect, split evenly between its two edges.
   * A pause is shortened, not glued: the cut never removes this much silence.
   */
  pauseKeepSec: number
  /** Per-type padding. A missing entry falls back to the global values. */
  paddingByType?: Partial<Record<DefectType, SkipPadding>>
  /** Padding for a logical group (manual marks or automatically grouped defects). */
  groupPadding?: SkipPadding
}

export interface Settings {
  /** Recognition (ASR) language passed to the engine. */
  language: string
  /** Interface language for the renderer, menu and native dialogs. */
  uiLanguage: UiLanguage
  modelId: ModelId
  backend: Backend
  rules: DefectRules
  chunkTargetSec: number
  export: ExportSettings
  videoExport: VideoExportSettings
  playback: PlaybackSettings
  /** Context shown on each side of the selected defect in the mini timeline. */
  miniTimelinePadSec: number
  /** Display-only waveform contrast (0 = linear, 100 = strongest). */
  waveformContrast: number
  /** Show deleted defects as thin cards so they can be restored. */
  showDismissed: boolean
  /** Installed version per model id, written after a successful download. */
  modelVersions?: Partial<Record<ModelId, string>>
}

export type TranscribePhase =
  | 'prepare'
  | 'audio'
  | 'silence'
  | 'peaks'
  | 'transcribe'
  | 'merge'
  | 'done'

export interface TranscribeProgress {
  jobId: string
  projectId: string
  phase: TranscribePhase
  percent: number
  message: string
  chunk?: number
  chunks?: number
  /** Only the `transcribe` phase has a meaningful percentage. */
  indeterminate?: boolean
  processedSec?: number
  totalSec?: number
  etaSec?: number
}

export interface TranscribePartial {
  jobId: string
  projectId: string
  project: Project
  peaks: Peaks | null
  chunk: number
  chunks: number
}

export interface TranscribeDone {
  jobId: string
  projectId: string
  project: Project
  peaks: Peaks | null
}

export interface TranscribeError {
  jobId: string
  projectId: string
  message: string
}

export interface ModelDownloadProgress {
  modelId: ModelId
  percent: number
  message: string
}

/** One model with a newer build in the manifest than the installed one. */
export interface ModelUpdate {
  modelId: ModelId
  /** Null when the installed build predates version tracking. */
  installedVersion: string | null
  availableVersion: string
  size: number
}

export interface ModelUpdateCheckResult {
  checkedAt: string
  /** False when the manifest could not be fetched; `updates` is empty then. */
  reachable: boolean
  /** ISO timestamp of the manifest generation, informational. */
  manifestGeneratedAt: string
  updates: ModelUpdate[]
}

export interface TranscribeRequest {
  projectId: string
  videoPath: string
  language: string
  modelId: ModelId
  backend: Backend
  rules: DefectRules
  chunkTargetSec?: number
  force?: boolean
}

export interface StartTranscriptionResult {
  jobId: string
}

export interface MediaRegistration {
  id: string
  url: string
}

export interface ExportRequest {
  project: Project
  defects: ExportDefect[]
  marks: ManualMark[]
  /** Merged final cuts, in playback order. Empty when nothing is cut. */
  cuts: CutRange[]
  format: 'csv' | 'json'
  exportSettings: ExportSettings
}

export interface VideoExportRequest {
  projectId: string
  projectName: string
  videoPath: string
  duration: number
  /** Merged final cuts. The main process derives the kept ranges from them. */
  cuts: CutRange[]
  settings: VideoExportSettings
}

export interface VideoExportProgress {
  projectId: string
  phase: 'prepare' | 'render' | 'finalize'
  /** 0–100. Stays below 100 until ffmpeg exits successfully. */
  percent: number
  processedSec: number
  totalSec: number
  message: string
}
