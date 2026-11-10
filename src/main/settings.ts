import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_RULES } from '@shared/defects'
import { MODEL_SPECS } from '@shared/models'
import type { Backend, ModelId, Settings } from '@shared/types'
import { userDataDir } from './paths'

const DEFAULTS: Settings = {
  language: 'ru',
  modelId: 'q8_0',
  backend: 'metal',
  rules: DEFAULT_RULES
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

export async function loadSettings(): Promise<Settings> {
  try {
    const parsed = JSON.parse(await readFile(settingsFile(), 'utf8')) as Partial<Settings>
    return {
      language: typeof parsed.language === 'string' ? parsed.language : DEFAULTS.language,
      modelId: validModelId(parsed.modelId) ? parsed.modelId : DEFAULTS.modelId,
      backend: validBackend(parsed.backend) ? parsed.backend : DEFAULTS.backend,
      rules: { ...DEFAULT_RULES, ...(parsed.rules ?? {}) }
    }
  } catch {
    return { ...DEFAULTS, rules: { ...DEFAULT_RULES } }
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await mkdir(userDataDir(), { recursive: true })
  const path = settingsFile()
  const temporary = `${path}.tmp`
  await writeFile(temporary, JSON.stringify(settings, null, 2), 'utf8')
  await rename(temporary, path)
}
