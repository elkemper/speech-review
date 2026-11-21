import type { ModelId } from './types'

export interface ModelSpec {
  id: ModelId
  label: string
  shortLabel: string
  file: string
  size: number
  sha256: string
  url: string
  note: string
}

const BASE = 'https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/main/CrisperWhisper2.0-GGUF'

export const MODEL_SPECS: Record<ModelId, ModelSpec> = {
  q8_0: {
    id: 'q8_0',
    label: 'CrisperWhisper 2.0 Large · Q8_0',
    shortLabel: 'Q8_0',
    file: 'crisperwhisper-2-large-q8_0.gguf',
    size: 1716306528,
    sha256: '392e636876d6d5ae8716f0f98b78480b61bb8c199d63f20523e95308b3425c2e',
    url: `${BASE}/crisperwhisper-2-large-q8_0.gguf`,
    note: 'Рекомендуемый баланс качества и скорости'
  },
  bf16: {
    id: 'bf16',
    label: 'CrisperWhisper 2.0 Large · BF16',
    shortLabel: 'BF16',
    file: 'crisperwhisper-2-large-bf16.gguf',
    size: 3092563712,
    sha256: '7f2ddc0fc5a419441fcf2be713696cc5d6bcd8a8db65b4acbea4879534e47c1b',
    url: `${BASE}/crisperwhisper-2-large-bf16.gguf`,
    note: 'Максимальное качество, больше памяти и места'
  },
  q4_k: {
    id: 'q4_k',
    label: 'CrisperWhisper 2.0 Large · Q4_K',
    shortLabel: 'Q4_K',
    file: 'crisperwhisper-2-large-q4_k.gguf',
    size: 982302624,
    sha256: '13399e818dfe966e613dc0ba3db73d27bf9dd23ff63d7d946c77c75dd0ee1913',
    url: `${BASE}/crisperwhisper-2-large-q4_k.gguf`,
    note: 'Самый лёгкий вариант, качество ниже'
  }
}

export const MODEL_ORDER: ModelId[] = ['q8_0', 'bf16', 'q4_k']

export function getModelSpec(id: ModelId): ModelSpec {
  return MODEL_SPECS[id]
}

/**
 * A model manifest is a small JSON file kept in the app repository and served
 * through raw.githubusercontent.com. It lets the app discover newer model
 * builds without shipping an app update. The git history of the manifest file
 * is the version history.
 */
export interface ModelManifestEntry {
  id: ModelId
  /** Calendar version of the model build, e.g. '2026.11.1'. */
  version: string
  /** ISO date of the model release, informational. */
  releasedAt: string
  file: string
  size: number
  sha256: string
  url: string
}

export interface ModelManifest {
  formatVersion: number
  /** ISO timestamp written by the manifest update script. */
  generatedAt: string
  models: ModelManifestEntry[]
}

export interface VersionedModelSpec extends ModelSpec {
  version: string
  releasedAt: string
}

export const MANIFEST_FORMAT_VERSION = 1

const SHA256_PATTERN = /^[0-9a-f]{64}$/i
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/

/**
 * Validates an untrusted parsed value as a manifest. Entries without a valid
 * sha256 or size are dropped so a broken manifest can never replace the
 * built-in specs with something the engine cannot verify.
 */
export function parseManifest(value: unknown): ModelManifest | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Partial<ModelManifest>
  if (raw.formatVersion !== MANIFEST_FORMAT_VERSION) return null
  if (!Array.isArray(raw.models)) return null
  const models: ModelManifestEntry[] = []
  for (const item of raw.models) {
    if (typeof item !== 'object' || item === null) continue
    const entry = item as Partial<ModelManifestEntry>
    if (
      typeof entry.id !== 'string' ||
      !Object.prototype.hasOwnProperty.call(MODEL_SPECS, entry.id) ||
      typeof entry.version !== 'string' ||
      entry.version.length === 0 ||
      typeof entry.releasedAt !== 'string' ||
      !ISO_DATE_PATTERN.test(entry.releasedAt) ||
      typeof entry.file !== 'string' ||
      entry.file.length === 0 ||
      typeof entry.size !== 'number' ||
      !Number.isFinite(entry.size) ||
      entry.size <= 0 ||
      typeof entry.sha256 !== 'string' ||
      !SHA256_PATTERN.test(entry.sha256) ||
      typeof entry.url !== 'string' ||
      !entry.url.startsWith('https://')
    ) {
      continue
    }
    models.push({
      id: entry.id as ModelId,
      version: entry.version,
      releasedAt: entry.releasedAt,
      file: entry.file,
      size: entry.size,
      sha256: entry.sha256,
      url: entry.url
    })
  }
  if (models.length === 0) return null
  return {
    formatVersion: MANIFEST_FORMAT_VERSION,
    generatedAt:
      typeof raw.generatedAt === 'string' && raw.generatedAt.length > 0
        ? raw.generatedAt
        : new Date(0).toISOString(),
    models
  }
}

function compareVersionParts(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value.split(/[.-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : -1))
  const left = parse(a)
  const right = parse(b)
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? -1) - (right[i] ?? -1)
    if (diff !== 0) return diff
  }
  return 0
}

/** Positive when `a` is newer than `b`, negative when older, 0 when equal. */
export function compareVersions(a: string, b: string): number {
  if (a === b) return 0
  if (a === 'unknown') return -1
  if (b === 'unknown') return 1
  return compareVersionParts(a, b)
}

/**
 * Overlays a manifest on top of the built-in specs. Offline (manifest is
 * null) or per-id fallback returns the built-in spec unchanged. A manifest
 * entry wins only when its sha256 differs from the built-in one — the
 * built-in spec already describes the current known-good build.
 */
export function resolveSpecs(
  manifest: ModelManifest | null
): Record<ModelId, VersionedModelSpec> {
  const resolved = {} as Record<ModelId, VersionedModelSpec>
  const byId = new Map(manifest?.models.map((entry) => [entry.id, entry]) ?? [])
  for (const id of MODEL_ORDER) {
    const base = MODEL_SPECS[id]
    const entry = byId.get(id)
    if (entry && entry.sha256 !== base.sha256) {
      resolved[id] = {
        ...base,
        file: entry.file,
        size: entry.size,
        sha256: entry.sha256,
        url: entry.url,
        version: entry.version,
        releasedAt: entry.releasedAt
      }
    } else {
      resolved[id] = {
        ...base,
        version: entry?.version ?? BUILTIN_VERSION,
        releasedAt: entry?.releasedAt ?? BUILTIN_RELEASED_AT
      }
    }
  }
  return resolved
}

/**
 * Version label for the built-in specs themselves. Bumped only when
 * MODEL_SPECS content changes in code.
 */
export const BUILTIN_VERSION = '2026.11.1'
export const BUILTIN_RELEASED_AT = '2026-11-10'
