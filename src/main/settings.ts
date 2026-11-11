import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_RULES } from '@shared/defects'
import { MODEL_SPECS } from '@shared/models'
import {
  DEFAULT_EXPORT_SETTINGS,
  DEFAULT_PLAYBACK_SETTINGS,
  DEFAULT_SETTINGS,
  EXPORT_FIELDS,
  normalizeChunkTarget
} from '@shared/settings'
import type {
  Backend,
  ExportField,
  ExportSettings,
  ModelId,
  PlaybackSettings,
  Settings,
  SkipScope
} from '@shared/types'
import { userDataDir } from './paths'

const DEFAULTS: Settings = {
  ...DEFAULT_SETTINGS,
  rules: { ...DEFAULT_SETTINGS.rules },
  export: { ...DEFAULT_SETTINGS.export, fields: [...DEFAULT_SETTINGS.export.fields] },
  playback: { ...DEFAULT_SETTINGS.playback }
}

const BACKENDS: Backend[] = ['metal', 'cpu']
const SKIP_SCOPES: SkipScope[] = ['marks', 'all']

function settingsFile(): string {
  return join(userDataDir(), 'settings.json')
}

function validModelId(value: unknown): value is ModelId {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(MODEL_SPECS, value)
  )
}

function validBackend(value: unknown): value is Backend {
  return typeof value === 'string' && BACKENDS.includes(value as Backend)
}

function normalizeExport(value: unknown): ExportSettings {
  const raw = (value ?? {}) as Partial<ExportSettings>
  const fields = Array.isArray(raw.fields)
    ? [...new Set(raw.fields.filter((field): field is ExportField => EXPORT_FIELDS.includes(field)))]
    : []
  return {
    fields: fields.length > 0 ? fields : [...DEFAULT_EXPORT_SETTINGS.fields],
    delimiter: raw.delimiter === ',' ? ',' : ';',
    includeHeader: raw.includeHeader !== false
  }
}

function normalizePlayback(value: unknown): PlaybackSettings {
  const raw = (value ?? {}) as Partial<PlaybackSettings>
  return {
    skipEnabled: raw.skipEnabled === true,
    skipScope: SKIP_SCOPES.includes(raw.skipScope as SkipScope)
      ? (raw.skipScope as SkipScope)
      : DEFAULT_PLAYBACK_SETTINGS.skipScope,
    skipBeforeSec: clampNumber(raw.skipBeforeSec, 0, 5, DEFAULT_PLAYBACK_SETTINGS.skipBeforeSec),
    skipAfterSec: clampNumber(raw.skipAfterSec, 0, 5, DEFAULT_PLAYBACK_SETTINGS.skipAfterSec)
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export async function loadSettings(): Promise<Settings> {
  try {
    const parsed = JSON.parse(await readFile(settingsFile(), 'utf8')) as Partial<Settings>
    return {
      language: typeof parsed.language === 'string' ? parsed.language : DEFAULTS.language,
      modelId: validModelId(parsed.modelId) ? parsed.modelId : DEFAULTS.modelId,
      backend: validBackend(parsed.backend) ? parsed.backend : DEFAULTS.backend,
      rules: { ...DEFAULT_RULES, ...(parsed.rules ?? {}) },
      chunkTargetSec: normalizeChunkTarget(parsed.chunkTargetSec),
      export: normalizeExport(parsed.export),
      playback: normalizePlayback(parsed.playback)
    }
  } catch {
    return {
      ...DEFAULTS,
      rules: { ...DEFAULT_RULES },
      export: { ...DEFAULT_EXPORT_SETTINGS, fields: [...DEFAULT_EXPORT_SETTINGS.fields] },
      playback: { ...DEFAULT_PLAYBACK_SETTINGS }
    }
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await mkdir(userDataDir(), { recursive: true })
  const path = settingsFile()
  const temporary = `${path}.tmp`
  await writeFile(temporary, JSON.stringify(settings, null, 2), 'utf8')
  await rename(temporary, path)
}
