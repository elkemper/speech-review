export type Backend = 'metal' | 'cpu'
export type ModelId = 'q8_0' | 'bf16' | 'q4_k'

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
  reviewed: boolean
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
}

export interface DefectRules {
  fillerWords: string[]
  multiWordFillers: string[][]
  pauseThresholdSec: number
  pauseHighSec: number
  excludePauseAfterSentenceEnd: boolean
  repetitionWindowSec: number
  elongationMinRepeats: number
  detectLexicalFillers: boolean
  lowConfidenceThreshold: number
  /** Minimum duration for each automatically detected defect type. */
  minDurationByType: Record<DefectType, number>
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
  /** User-adjusted boundaries for automatically detected defects, keyed by defect id. */
  defectOverrides: Record<string, DefectBoundsOverride>
  reviewedDefectIds: string[]
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
  | 'reviewed'
  | 'text'
  | 'note'

export interface ExportSettings {
  fields: ExportField[]
  delimiter: ';' | ','
  includeHeader: boolean
}

export type SkipScope = 'marks' | 'all'

export interface SkipPadding {
  before: number
  after: number
}

export interface PlaybackSettings {
  skipEnabled: boolean
  skipScope: SkipScope
  /** Global fallback padding used when a type has no explicit entry. */
  skipBeforeSec: number
  skipAfterSec: number
  /** Per-type padding. A missing entry falls back to the global values. */
  paddingByType?: Partial<Record<DefectType, SkipPadding>>
  /** Padding for a logical group (manual marks or automatically grouped defects). */
  groupPadding?: SkipPadding
}

export interface Settings {
  language: string
  modelId: ModelId
  backend: Backend
  rules: DefectRules
  chunkTargetSec: number
  export: ExportSettings
  playback: PlaybackSettings
  /** Context shown on each side of the selected defect in the mini timeline. */
  miniTimelinePadSec: number
  /** Hide reviewed defects from the defect list completely. */
  hideReviewed: boolean
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
  defects: Defect[]
  marks: ManualMark[]
  format: 'csv' | 'json'
  exportSettings: ExportSettings
}
