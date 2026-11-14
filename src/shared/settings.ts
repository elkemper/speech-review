import { DEFAULT_RULES } from './defects'
import type {
  DefectType,
  ExportField,
  ExportSettings,
  PlaybackSettings,
  Settings,
  SkipPadding,
  VideoExportEncoder,
  VideoExportQuality,
  VideoExportResolution,
  VideoExportSettings
} from './types'

export const DEFAULT_EXPORT_FIELDS: ExportField[] = [
  'start_tc',
  'end_tc',
  'start_sec',
  'end_sec',
  'duration_sec',
  'type',
  'severity',
  'source',
  'confirmed',
  'text',
  'note'
]

export const EXPORT_FIELDS: ExportField[] = [
  ...DEFAULT_EXPORT_FIELDS,
  'cut',
  'defect_start_tc',
  'defect_end_tc',
  'defect_start_sec',
  'defect_end_sec',
  'defect_duration_sec'
]

export const EXPORT_FIELD_LABELS: Record<ExportField, string> = {
  start_tc: 'Начало выреза (таймкод)',
  end_tc: 'Конец выреза (таймкод)',
  start_sec: 'Начало выреза (секунды)',
  end_sec: 'Конец выреза (секунды)',
  duration_sec: 'Длительность выреза',
  type: 'Тип',
  severity: 'Важность',
  source: 'Источник',
  confirmed: 'Подтверждено',
  text: 'Текст',
  note: 'Заметка',
  cut: 'Режется',
  defect_start_tc: 'Начало дефекта (таймкод)',
  defect_end_tc: 'Конец дефекта (таймкод)',
  defect_start_sec: 'Начало дефекта (секунды)',
  defect_end_sec: 'Конец дефекта (секунды)',
  defect_duration_sec: 'Длительность дефекта'
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  fields: [...DEFAULT_EXPORT_FIELDS],
  delimiter: ';',
  includeHeader: true
}

export const VIDEO_EXPORT_RESOLUTIONS: VideoExportResolution[] = [
  'source',
  '1080',
  '720',
  '480'
]

export const VIDEO_EXPORT_QUALITIES: VideoExportQuality[] = [
  'high',
  'balanced',
  'compact'
]

export const VIDEO_EXPORT_ENCODERS: VideoExportEncoder[] = [
  'h264',
  'hevc',
  'h264_videotoolbox',
  'hevc_videotoolbox'
]

export const VIDEO_EXPORT_RESOLUTION_LABELS: Record<VideoExportResolution, string> = {
  source: 'Как в источнике',
  '1080': '1080p',
  '720': '720p',
  '480': '480p'
}

export const VIDEO_EXPORT_QUALITY_LABELS: Record<VideoExportQuality, string> = {
  high: 'Высокое',
  balanced: 'Сбалансированное',
  compact: 'Компактное'
}

export const VIDEO_EXPORT_ENCODER_LABELS: Record<VideoExportEncoder, string> = {
  h264: 'H.264 · программный',
  hevc: 'HEVC · программный',
  h264_videotoolbox: 'H.264 · аппаратный',
  hevc_videotoolbox: 'HEVC · аппаратный'
}

export const DEFAULT_VIDEO_EXPORT_SETTINGS: VideoExportSettings = {
  copyMode: false,
  resolution: 'source',
  quality: 'balanced',
  encoder: 'h264'
}

export function normalizeVideoExportSettings(value: unknown): VideoExportSettings {
  const raw = (value ?? {}) as Partial<VideoExportSettings>
  return {
    copyMode: raw.copyMode === true,
    resolution: VIDEO_EXPORT_RESOLUTIONS.includes(raw.resolution as VideoExportResolution)
      ? (raw.resolution as VideoExportResolution)
      : DEFAULT_VIDEO_EXPORT_SETTINGS.resolution,
    quality: VIDEO_EXPORT_QUALITIES.includes(raw.quality as VideoExportQuality)
      ? (raw.quality as VideoExportQuality)
      : DEFAULT_VIDEO_EXPORT_SETTINGS.quality,
    encoder: VIDEO_EXPORT_ENCODERS.includes(raw.encoder as VideoExportEncoder)
      ? (raw.encoder as VideoExportEncoder)
      : DEFAULT_VIDEO_EXPORT_SETTINGS.encoder
  }
}

/**
 * Per-type defaults. A pause does not need extra room on either side, while a
 * filler benefits from a little pre-roll so the cut does not start mid-word.
 */
export const DEFAULT_SKIP_PADDING_BY_TYPE: Record<DefectType, SkipPadding> = {
  filler: { before: 0.1, after: 0.2 },
  pause: { before: 0, after: 0 },
  repetition: { before: 0.1, after: 0.2 },
  elongation: { before: 0.1, after: 0.2 },
  false_start: { before: 0.1, after: 0.2 },
  vocal_sound: { before: 0.1, after: 0.3 },
  unclear: { before: 0.15, after: 0.35 },
  manual: { before: 0.15, after: 0.35 }
}

export const DEFAULT_GROUP_PADDING: SkipPadding = { before: 0.15, after: 0.35 }

/**
 * A pause is shortened rather than removed: this much silence is kept and
 * split evenly between the word before and the word after the cut. 0 restores
 * the old behaviour of removing the whole silence.
 */
export const DEFAULT_PAUSE_KEEP_SEC = 0.4
export const MIN_PAUSE_KEEP_SEC = 0
export const MAX_PAUSE_KEEP_SEC = 3

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  skipEnabled: false,
  skipBeforeSec: 0.15,
  skipAfterSec: 0.35,
  pauseKeepSec: DEFAULT_PAUSE_KEEP_SEC,
  paddingByType: Object.fromEntries(
    Object.entries(DEFAULT_SKIP_PADDING_BY_TYPE).map(([type, padding]) => [
      type,
      { ...padding }
    ])
  ) as Record<DefectType, SkipPadding>,
  groupPadding: { ...DEFAULT_GROUP_PADDING }
}

export const DEFAULT_MINI_TIMELINE_PAD_SEC = 3
export const MIN_MINI_TIMELINE_PAD_SEC = 0
export const MAX_MINI_TIMELINE_PAD_SEC = 15

export const DEFAULT_WAVEFORM_CONTRAST = 55
export const MIN_WAVEFORM_CONTRAST = 0
export const MAX_WAVEFORM_CONTRAST = 100

export const DEFAULT_CHUNK_TARGET_SEC = 600
export const MIN_CHUNK_TARGET_SEC = 120
export const MAX_CHUNK_TARGET_SEC = 900

export const DEFAULT_SETTINGS: Settings = {
  language: 'ru',
  modelId: 'q8_0',
  backend: 'metal',
  rules: DEFAULT_RULES,
  chunkTargetSec: DEFAULT_CHUNK_TARGET_SEC,
  export: DEFAULT_EXPORT_SETTINGS,
  videoExport: DEFAULT_VIDEO_EXPORT_SETTINGS,
  playback: DEFAULT_PLAYBACK_SETTINGS,
  miniTimelinePadSec: DEFAULT_MINI_TIMELINE_PAD_SEC,
  waveformContrast: DEFAULT_WAVEFORM_CONTRAST,
  showDismissed: true
}

export function normalizeMiniTimelinePad(value: unknown): number {
  return clampNumber(
    value,
    MIN_MINI_TIMELINE_PAD_SEC,
    MAX_MINI_TIMELINE_PAD_SEC,
    DEFAULT_MINI_TIMELINE_PAD_SEC
  )
}

export function normalizeWaveformContrast(value: unknown): number {
  return Math.round(
    clampNumber(
      value,
      MIN_WAVEFORM_CONTRAST,
      MAX_WAVEFORM_CONTRAST,
      DEFAULT_WAVEFORM_CONTRAST
    )
  )
}

export function normalizeChunkTarget(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_CHUNK_TARGET_SEC
  return Math.round(Math.min(MAX_CHUNK_TARGET_SEC, Math.max(MIN_CHUNK_TARGET_SEC, value)))
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export function normalizeSkipPadding(
  value: unknown,
  fallback: SkipPadding
): SkipPadding {
  const raw = (value ?? {}) as Partial<SkipPadding>
  return {
    before: clampNumber(raw.before, 0, 5, fallback.before),
    after: clampNumber(raw.after, 0, 5, fallback.after)
  }
}

/** Settings files from older builds miss per-type padding, so fill every entry. */
export function normalizePlaybackSettings(value: unknown): PlaybackSettings {
  const raw = (value ?? {}) as Partial<PlaybackSettings>
  const rawPadding = (raw.paddingByType ?? {}) as Partial<Record<DefectType, SkipPadding>>
  const paddingByType = {} as Record<DefectType, SkipPadding>
  for (const type of Object.keys(DEFAULT_SKIP_PADDING_BY_TYPE) as DefectType[]) {
    paddingByType[type] = normalizeSkipPadding(
      rawPadding[type],
      DEFAULT_SKIP_PADDING_BY_TYPE[type]
    )
  }
  return {
    skipEnabled: raw.skipEnabled === true,
    skipBeforeSec: clampNumber(raw.skipBeforeSec, 0, 5, DEFAULT_PLAYBACK_SETTINGS.skipBeforeSec),
    skipAfterSec: clampNumber(raw.skipAfterSec, 0, 5, DEFAULT_PLAYBACK_SETTINGS.skipAfterSec),
    pauseKeepSec: clampNumber(
      raw.pauseKeepSec,
      MIN_PAUSE_KEEP_SEC,
      MAX_PAUSE_KEEP_SEC,
      DEFAULT_PAUSE_KEEP_SEC
    ),
    paddingByType,
    groupPadding: normalizeSkipPadding(raw.groupPadding, DEFAULT_GROUP_PADDING)
  }
}
