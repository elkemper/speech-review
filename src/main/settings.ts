import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeRules } from '@shared/defects'
import { MODEL_SPECS } from '@shared/models'
import {
  DEFAULT_EXPORT_SETTINGS,
  DEFAULT_PLAYBACK_SETTINGS,
  DEFAULT_SETTINGS,
  EXPORT_FIELDS,
  normalizeChunkTarget,
  normalizeMiniTimelinePad,
  normalizeModelVersions,
  normalizePlaybackSettings,
  normalizeVideoExportSettings,
  normalizeWaveformContrast
} from '@shared/settings'
import type {
  Backend,
  ExportField,
  ExportSettings,
  ModelId,
  Settings
} from '@shared/types'
import {
  CURRENT_SETTINGS_VERSION,
  migrateSettings,
  type RawSettings
} from '@shared/settingsMigrations'
import { userDataDir } from './paths'

const DEFAULTS: Settings = {
  ...DEFAULT_SETTINGS,
  rules: normalizeRules(DEFAULT_SETTINGS.rules),
  export: { ...DEFAULT_SETTINGS.export, fields: [...DEFAULT_SETTINGS.export.fields] },
  videoExport: { ...DEFAULT_SETTINGS.videoExport },
  playback: normalizePlaybackSettings(DEFAULT_SETTINGS.playback)
}

const BACKENDS: Backend[] = ['metal', 'cpu']

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
  // Field renames (for example the old `reviewed` column) are handled once by
  // `settingsMigrations`; this only filters and fills defaults.
  const fields = Array.isArray(raw.fields)
    ? [
        ...new Set(
          (raw.fields as unknown[]).filter((field): field is ExportField =>
            EXPORT_FIELDS.includes(field as ExportField)
          )
        )
      ]
    : []
  return {
    fields: fields.length > 0 ? fields : [...DEFAULT_EXPORT_SETTINGS.fields],
    delimiter: raw.delimiter === ',' ? ',' : ';',
    includeHeader: raw.includeHeader !== false
  }
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = JSON.parse(await readFile(settingsFile(), 'utf8')) as RawSettings
    const migrated = migrateSettings(raw)
    const parsed = migrated.settings as Partial<Settings>
    const settings: Settings = {
      language: typeof parsed.language === 'string' ? parsed.language : DEFAULTS.language,
      modelId: validModelId(parsed.modelId) ? parsed.modelId : DEFAULTS.modelId,
      backend: validBackend(parsed.backend) ? parsed.backend : DEFAULTS.backend,
      rules: normalizeRules(parsed.rules),
      chunkTargetSec: normalizeChunkTarget(parsed.chunkTargetSec),
      export: normalizeExport(parsed.export),
      videoExport: normalizeVideoExportSettings(parsed.videoExport),
      playback: normalizePlaybackSettings(parsed.playback),
      miniTimelinePadSec: normalizeMiniTimelinePad(parsed.miniTimelinePadSec),
      waveformContrast: normalizeWaveformContrast(parsed.waveformContrast),
      showDismissed: parsed.showDismissed !== false,
      modelVersions: normalizeModelVersions(parsed.modelVersions)
    }
    // Write the upgraded shape once so a renamed field is not converted again.
    if (migrated.migrated) {
      await writeSettingsFile(settings).catch(() => undefined)
    }
    return settings
  } catch {
    return {
      ...DEFAULTS,
      rules: normalizeRules(DEFAULT_SETTINGS.rules),
      export: { ...DEFAULT_EXPORT_SETTINGS, fields: [...DEFAULT_EXPORT_SETTINGS.fields] },
      videoExport: { ...DEFAULT_SETTINGS.videoExport },
      playback: normalizePlaybackSettings(DEFAULT_PLAYBACK_SETTINGS)
    }
  }
}

async function writeSettingsFile(settings: Settings): Promise<void> {
  await mkdir(userDataDir(), { recursive: true })
  const path = settingsFile()
  const temporary = `${path}.tmp`
  const payload = { ...settings, schemaVersion: CURRENT_SETTINGS_VERSION }
  await writeFile(temporary, JSON.stringify(payload, null, 2), 'utf8')
  await rename(temporary, path)
}

export async function saveSettings(settings: Settings): Promise<void> {
  await writeSettingsFile(settings)
}
