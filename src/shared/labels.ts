import { translate, type MessageKey, type UiLanguage } from './i18n'
import type {
  DefectType,
  ExportField,
  ModelId,
  Severity,
  TranscribePhase,
  VideoExportEncoder,
  VideoExportQuality,
  VideoExportResolution
} from './types'

const DEFECT_KEYS: Record<DefectType, MessageKey> = {
  filler: 'defect.filler',
  pause: 'defect.pause',
  repetition: 'defect.repetition',
  elongation: 'defect.elongation',
  false_start: 'defect.false_start',
  vocal_sound: 'defect.vocal_sound',
  unclear: 'defect.unclear',
  manual: 'defect.manual'
}

const SEVERITY_KEYS: Record<Severity, MessageKey> = {
  low: 'severity.low',
  medium: 'severity.medium',
  high: 'severity.high'
}

const EXPORT_FIELD_KEYS: Record<ExportField, MessageKey> = {
  start_tc: 'export.field.start_tc',
  end_tc: 'export.field.end_tc',
  start_sec: 'export.field.start_sec',
  end_sec: 'export.field.end_sec',
  duration_sec: 'export.field.duration_sec',
  type: 'export.field.type',
  severity: 'export.field.severity',
  source: 'export.field.source',
  confirmed: 'export.field.confirmed',
  text: 'export.field.text',
  note: 'export.field.note',
  cut: 'export.field.cut',
  defect_start_tc: 'export.field.defect_start_tc',
  defect_end_tc: 'export.field.defect_end_tc',
  defect_start_sec: 'export.field.defect_start_sec',
  defect_end_sec: 'export.field.defect_end_sec',
  defect_duration_sec: 'export.field.defect_duration_sec'
}

const QUALITY_KEYS: Record<VideoExportQuality, MessageKey> = {
  high: 'video.quality.high',
  balanced: 'video.quality.balanced',
  compact: 'video.quality.compact'
}

const ENCODER_KEYS: Record<VideoExportEncoder, MessageKey> = {
  h264: 'video.encoder.h264',
  hevc: 'video.encoder.hevc',
  h264_videotoolbox: 'video.encoder.h264_videotoolbox',
  hevc_videotoolbox: 'video.encoder.hevc_videotoolbox'
}

const PHASE_KEYS: Record<TranscribePhase, MessageKey> = {
  prepare: 'phase.prepare',
  audio: 'phase.audio',
  silence: 'phase.silence',
  peaks: 'phase.peaks',
  transcribe: 'phase.transcribe',
  merge: 'phase.merge',
  done: 'phase.done'
}

const MODEL_NOTE_KEYS: Record<ModelId, MessageKey> = {
  q8_0: 'model.q8_0.note',
  bf16: 'model.bf16.note',
  q4_k: 'model.q4_k.note'
}

export function defectTypeLabel(lang: UiLanguage, type: DefectType): string {
  return translate(lang, DEFECT_KEYS[type])
}

export function severityLabel(lang: UiLanguage, severity: Severity): string {
  return translate(lang, SEVERITY_KEYS[severity])
}

export function exportFieldLabel(lang: UiLanguage, field: ExportField): string {
  return translate(lang, EXPORT_FIELD_KEYS[field])
}

export function videoResolutionLabel(
  lang: UiLanguage,
  resolution: VideoExportResolution
): string {
  if (resolution === 'source') return translate(lang, 'video.resolution.source')
  return `${resolution}p`
}

export function videoQualityNameLabel(lang: UiLanguage, quality: VideoExportQuality): string {
  return translate(lang, QUALITY_KEYS[quality])
}

export function videoEncoderLabel(lang: UiLanguage, encoder: VideoExportEncoder): string {
  return translate(lang, ENCODER_KEYS[encoder])
}

export function transcribePhaseLabel(lang: UiLanguage, phase: TranscribePhase): string {
  return translate(lang, PHASE_KEYS[phase])
}

export function yesNo(lang: UiLanguage, value: boolean): string {
  return translate(lang, value ? 'common.yes' : 'common.no')
}

/** Model card description shown in Settings. */
export function modelNote(lang: UiLanguage, modelId: ModelId): string {
  return translate(lang, MODEL_NOTE_KEYS[modelId])
}
