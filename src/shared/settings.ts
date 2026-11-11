import { DEFAULT_RULES } from './defects'
import type { ExportField, ExportSettings, PlaybackSettings, Settings } from './types'

export const EXPORT_FIELDS: ExportField[] = [
  'start_tc',
  'end_tc',
  'start_sec',
  'end_sec',
  'duration_sec',
  'type',
  'severity',
  'source',
  'reviewed',
  'text',
  'note'
]

export const EXPORT_FIELD_LABELS: Record<ExportField, string> = {
  start_tc: 'Начало (таймкод)',
  end_tc: 'Конец (таймкод)',
  start_sec: 'Начало (секунды)',
  end_sec: 'Конец (секунды)',
  duration_sec: 'Длительность',
  type: 'Тип',
  severity: 'Важность',
  source: 'Источник',
  reviewed: 'Проверено',
  text: 'Текст',
  note: 'Заметка'
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  fields: [...EXPORT_FIELDS],
  delimiter: ';',
  includeHeader: true
}

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  skipEnabled: false,
  skipScope: 'all',
  skipBeforeSec: 0.15,
  skipAfterSec: 0.35
}

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
  playback: DEFAULT_PLAYBACK_SETTINGS
}

export function normalizeChunkTarget(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_CHUNK_TARGET_SEC
  return Math.round(Math.min(MAX_CHUNK_TARGET_SEC, Math.max(MIN_CHUNK_TARGET_SEC, value)))
}
