import { app } from 'electron'
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
  normalizeUiLanguageSetting,
  normalizeVideoExportSettings,
  normalizeWaveformContrast
} from '@shared/settings'
import { uiLanguageFromLocale, type UiLanguage } from '@shared/i18n'
import { setCurrentUiLanguage } from './uiLanguage'
import type {
  Backend,
  ExportField,
  ExportSettings,
  ModelId,
  Settings
} from '@shared/types'
import { userDataDir } from './paths'

const DEFAULTS: Settings = {
  ...DEFAULT_SETTINGS,
  rules: normalizeRules(DEFAULT_SETTINGS.rules),
  export: { ...DEFAULT_SETTINGS.export, fields: [...DEFAULT_SETTINGS.export.fields] },
  videoExport: { ...DEFAULT_SETTINGS.videoExport },
  playback: normalizePlaybackSettings(DEFAULT_SETTINGS.playback)
}

const BACKENDS: Backend[] = ['metal', 'cpu']

/** The language a brand-new install starts with. */
export function systemUiLanguage(): UiLanguage {
  try {
    return uiLanguageFromLocale(app.getLocale())
  } catch {
    return 'ru'
  }
}

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
  // Older settings stored the confirmation column as `reviewed`.
  const rawFields = Array.isArray(raw.fields) ? (raw.fields as string[]) : []
  const migrated = rawFields.map((field) => (field === 'reviewed' ? 'confirmed' : field))
  const fields = Array.isArray(raw.fields)
    ? [
        ...new Set(
          migrated.filter((field): field is ExportField =>
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
  let uiLanguage: UiLanguage
  try {
    const parsed = JSON.parse(await readFile(settingsFile(), 'utf8')) as Partial<Settings>
    // An existing file without `uiLanguage` migrates to the default `ru`.
    uiLanguage = normalizeUiLanguageSetting(parsed.uiLanguage)
    const settings: Settings = {
      language: typeof parsed.language === 'string' ? parsed.language : DEFAULTS.language,
      uiLanguage,
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
    setCurrentUiLanguage(uiLanguage)
    return settings
  } catch {
    // No settings file yet: a fresh install follows the system locale.
    uiLanguage = systemUiLanguage()
    setCurrentUiLanguage(uiLanguage)
    return {
      ...DEFAULTS,
      uiLanguage,
      rules: normalizeRules(DEFAULT_SETTINGS.rules),
      export: { ...DEFAULT_EXPORT_SETTINGS, fields: [...DEFAULT_EXPORT_SETTINGS.fields] },
      videoExport: { ...DEFAULT_SETTINGS.videoExport },
      playback: normalizePlaybackSettings(DEFAULT_PLAYBACK_SETTINGS)
    }
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  setCurrentUiLanguage(normalizeUiLanguageSetting(settings.uiLanguage))
  await mkdir(userDataDir(), { recursive: true })
  const path = settingsFile()
  const temporary = `${path}.tmp`
  await writeFile(temporary, JSON.stringify(settings, null, 2), 'utf8')
  await rename(temporary, path)
}
