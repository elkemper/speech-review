import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { get } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { dirname } from 'node:path'
import { translate } from '@shared/i18n'
import {
  BUILTIN_VERSION,
  compareVersions,
  getModelSpec,
  MODEL_ORDER,
  parseManifest,
  resolveSpecs
} from '@shared/models'
import type { ModelManifest } from '@shared/models'
import type {
  ModelId,
  ModelUpdate,
  ModelUpdateCheckResult,
  ModelStateInfo
} from '@shared/types'
import { modelPath } from '../paths'
import { loadSettings, saveSettings } from '../settings'
import { currentUiLanguage } from '../uiLanguage'

function t(key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]): string {
  return translate(currentUiLanguage(), key, params)
}

export interface ModelDownloadOptions {
  signal?: AbortSignal
  onProgress?: (percent: number, message: string) => void
}

export interface ModelState {
  path: string
  ready: boolean
  bytes: number
}

function markerPath(id: ModelId): string {
  return `${modelPath(id)}.sha256`
}

/**
 * The marker records which build is on disk: the sha256 plus, when known,
 * the version and exact size. Older builds wrote the bare hex digest, which
 * is still accepted on read.
 */
interface MarkerData {
  sha256: string
  version: string | null
  size: number | null
}

const HEX64 = /^[0-9a-f]{64}$/i

async function readMarker(id: ModelId): Promise<MarkerData | null> {
  let raw: string
  try {
    raw = (await readFile(markerPath(id), 'utf8')).trim()
  } catch {
    return null
  }
  if (HEX64.test(raw)) return { sha256: raw, version: null, size: null }
  try {
    const parsed = JSON.parse(raw) as Partial<MarkerData>
    if (typeof parsed.sha256 !== 'string' || !HEX64.test(parsed.sha256)) return null
    return {
      sha256: parsed.sha256,
      version: typeof parsed.version === 'string' && parsed.version.length > 0 ? parsed.version : null,
      size: typeof parsed.size === 'number' && Number.isFinite(parsed.size) ? parsed.size : null
    }
  } catch {
    return null
  }
}

async function writeMarker(
  id: ModelId,
  sha256: string,
  version: string,
  size: number
): Promise<void> {
  await writeFile(
    markerPath(id),
    `${JSON.stringify({ sha256, version, size })}\n`,
    'utf8'
  )
}

/**
 * Manifest fetched by the last update check. Never fetched implicitly: all
 * network access happens when the user asks for a check or an update.
 */
let cachedManifest: ModelManifest | null = null

/**
 * Spec that should be used for downloads and verification. A manifest entry
 * overrides the built-in spec when it describes a different build. Falls
 * back to the built-in spec offline or before any manifest was fetched.
 */
function currentSpec(id: ModelId, manifest: ModelManifest | null) {
  return resolveSpecs(manifest)[id]
}

/**
 * Spec whose sha256 matches the marker, so a model downloaded from a newer
 * manifest build still verifies after an app restart (when the manifest
 * cache is empty). Falls back to the built-in spec.
 */
function specForMarker(
  id: ModelId,
  marker: MarkerData,
  manifest: ModelManifest | null
): { size: number; sha256: string; version: string } | null {
  const builtIn = getModelSpec(id)
  if (marker.sha256 === builtIn.sha256) {
    return { size: builtIn.size, sha256: builtIn.sha256, version: marker.version ?? BUILTIN_VERSION }
  }
  const entry = manifest?.models.find((item) => item.id === id && item.sha256 === marker.sha256)
  if (entry) {
    return { size: entry.size, sha256: entry.sha256, version: entry.version }
  }
  if (marker.size !== null && marker.version) {
    // Downloaded from a manifest this app has not seen; trust the recorded
    // values so the file is not flagged as broken.
    return { size: marker.size, sha256: marker.sha256, version: marker.version }
  }
  return null
}

/**
 * Installed version for a model. Settings carry the version recorded at
 * download time; for installs that predate version tracking the hash marker
 * is matched against the manifest to recover it.
 */
async function installedVersionFor(
  id: ModelId,
  manifest: ModelManifest | null,
  recorded: string | undefined
): Promise<string | null> {
  if (recorded) return recorded
  const state = await modelState(id)
  if (!state.ready) return null
  const marker = await readMarker(id)
  if (!marker) return null
  if (marker.version) return marker.version
  if (marker.sha256 === getModelSpec(id).sha256) return BUILTIN_VERSION
  if (!manifest) return null
  const entry = manifest.models.find((item) => item.id === id && item.sha256 === marker.sha256)
  return entry ? entry.version : null
}

/**
 * Manifest URL. Lives in the app repository; the git history of the file is
 * the version history. Overridable for tests through the env var.
 */
function manifestUrl(): string {
  return process.env.SPEECH_REVIEW_MODEL_MANIFEST_URL
    ? process.env.SPEECH_REVIEW_MODEL_MANIFEST_URL
    : 'https://raw.githubusercontent.com/elkemper/speech-review/main/model-manifest.json'
}

function requestBuffer(url: string, redirects = 0): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = get(url, { headers: { 'User-Agent': 'webinar-speech-review/0.1' } }, (response) => {
      const status = response.statusCode ?? 0
      const location = response.headers.location
      if (status >= 300 && status < 400 && location && redirects < 8) {
        response.resume()
        resolve(requestBuffer(new URL(location, url).toString(), redirects + 1))
        return
      }
      if (status !== 200) {
        response.resume()
        reject(new Error(t('error.manifestHttp', { status })))
        return
      }
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('error', reject)
      response.on('end', () => resolve(Buffer.concat(chunks)))
    })
    request.on('error', reject)
    request.setTimeout(30_000, () => request.destroy(new Error(t('error.manifestTimeout'))))
  })
}

/**
 * Fetches and validates the model manifest. Returns null when unavailable
 * (offline, 404, invalid JSON) — the built-in specs keep working.
 */
export async function fetchModelManifest(): Promise<ModelManifest | null> {
  try {
    const body = await requestBuffer(manifestUrl())
    return parseManifest(JSON.parse(body.toString('utf8')))
  } catch {
    return null
  }
}

export async function checkModelUpdates(): Promise<ModelUpdateCheckResult> {
  const manifest = await fetchModelManifest()
  cachedManifest = manifest
  const updates: ModelUpdate[] = []
  if (manifest) {
    const specs = resolveSpecs(manifest)
    const settings = await loadSettings()
    for (const id of MODEL_ORDER) {
      const spec = specs[id]
      // Nothing installed — nothing to update.
      if (!(await modelState(id)).ready) continue
      const installed = await installedVersionFor(id, manifest, settings.modelVersions?.[id])
      if (installed && compareVersions(spec.version, installed) > 0) {
        updates.push({
          modelId: id,
          installedVersion: installed,
          availableVersion: spec.version,
          size: spec.size
        })
      } else if (!installed) {
        const state = await modelState(id)
        if (state.ready) {
          // Downloaded before version tracking, or its hash no longer matches
          // anything published — either way the manifest build is newer.
          updates.push({
            modelId: id,
            installedVersion: null,
            availableVersion: spec.version,
            size: spec.size
          })
        }
      }
    }
  }
  return {
    checkedAt: new Date().toISOString(),
    reachable: manifest !== null,
    manifestGeneratedAt: manifest?.generatedAt ?? new Date(0).toISOString(),
    updates
  }
}

/** Records the installed version after a successful download. */
async function recordModelVersion(
  id: ModelId,
  version: string
): Promise<void> {
  const settings = await loadSettings()
  await saveSettings({
    ...settings,
    modelVersions: { ...(settings.modelVersions ?? {}), [id]: version }
  })
}

export async function modelState(id: ModelId): Promise<ModelState> {
  const path = modelPath(id)
  const builtIn = getModelSpec(id)
  try {
    const info = await stat(path)
    if (info.size === builtIn.size) return { path, ready: true, bytes: info.size }
    // A model from a manifest build may differ in size from the built-in
    // spec; trust the marker when it recorded that exact size.
    const marker = await readMarker(id)
    if (marker && marker.size === info.size) return { path, ready: true, bytes: info.size }
    return { path, ready: false, bytes: info.size }
  } catch {
    return { path, ready: false, bytes: 0 }
  }
}

export async function modelStates(): Promise<ModelStateInfo[]> {
  return Promise.all(
    MODEL_ORDER.map(async (modelId) => {
      const state = await modelState(modelId)
      return { modelId, ...state }
    })
  )
}

export async function deleteModel(id: ModelId): Promise<void> {
  const path = modelPath(id)
  await Promise.all([
    unlink(path).catch(() => undefined),
    unlink(markerPath(id)).catch(() => undefined),
    unlink(`${path}.part`).catch(() => undefined)
  ])
  // Forget the recorded version so Settings does not show a stale one.
  const settings = await loadSettings()
  if (settings.modelVersions?.[id]) {
    const rest = { ...settings.modelVersions }
    delete rest[id]
    await saveSettings({ ...settings, modelVersions: rest })
  }
}

async function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/**
 * Confirms that the model file matches a published hash. The result is
 * cached in a small marker file so startup does not re-hash 1.7 GB.
 */
export async function ensureModel(id: ModelId): Promise<string> {
  const path = modelPath(id)
  const builtIn = getModelSpec(id)
  const info = await stat(path).catch(() => null)
  if (!info) {
    throw new Error(t('error.modelNotDownloaded', { model: builtIn.label }))
  }

  const marker = await readMarker(id)
  const expected = marker ? specForMarker(id, marker, cachedManifest) : null
  if (expected && expected.size === info.size) {
    // The marker hash was verified on a previous launch; the file size is
    // unchanged, so the cached verdict still holds.
    return path
  }

  const spec = expected ?? { ...builtIn, version: BUILTIN_VERSION }
  if (info.size !== spec.size) {
    throw new Error(t('error.modelNotDownloaded', { model: builtIn.label }))
  }

  const actual = await hashFile(path)
  if (actual !== spec.sha256) {
    throw new Error(
      t('error.modelCorrupt', { hash: actual.slice(0, 12) })
    )
  }
  await writeMarker(id, spec.sha256, spec.version, spec.size)
  return path
}

function requestStream(
  url: string,
  headers: Record<string, string>,
  redirects = 0
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = get(url, { headers }, (response) => {
      const status = response.statusCode ?? 0
      const location = response.headers.location
      if (status >= 300 && status < 400 && location && redirects < 8) {
        response.resume()
        resolve(requestStream(new URL(location, url).toString(), headers, redirects + 1))
        return
      }
      resolve(response)
    })
    request.on('error', reject)
    request.setTimeout(60_000, () => request.destroy(new Error(t('error.modelTimeout'))))
  })
}

export async function downloadModel(
  id: ModelId,
  options: ModelDownloadOptions = {}
): Promise<string> {
  const spec = currentSpec(id, cachedManifest)
  const path = modelPath(id)
  const partPath = `${path}.part`

  // An update check may have replaced an older build with a different size or
  // the same size but a new hash. Only skip the download when the marker
  // confirms the exact published build; otherwise the new build is fetched.
  const current = await modelState(id)
  const existingMarker = await readMarker(id)
  if (current.ready && current.bytes === spec.size) {
    if (existingMarker?.sha256 === spec.sha256) {
      options.onProgress?.(100, t('progress.modelAlreadyDownloaded'))
      await recordModelVersion(id, existingMarker.version ?? spec.version)
      return ensureModel(id)
    }
    if (!existingMarker) {
      // A file without a marker (e.g. copied in by hand) is verified by hash
      // against the target build instead of being downloaded again.
      const actual = await hashFile(path)
      if (actual === spec.sha256) {
        await writeMarker(id, spec.sha256, spec.version, spec.size)
        await recordModelVersion(id, spec.version)
        options.onProgress?.(100, t('progress.modelAlreadyDownloaded'))
        return path
      }
    }
  }

  await mkdir(dirname(path), { recursive: true })

  // A partial file may belong to the previous build; resuming across builds
  // would produce a hash mismatch, so it is discarded. The final file stays
  // in place until the new download is verified and renamed over it.
  if (existingMarker?.sha256 !== spec.sha256) {
    await unlink(`${path}.part`).catch(() => undefined)
  }

  let offset = 0
  let hash = createHash('sha256')

  try {
    const partInfo = await stat(partPath)
    offset = partInfo.size
    if (offset > spec.size) {
      await unlink(partPath).catch(() => undefined)
      offset = 0
    }
    if (offset > 0) {
      options.onProgress?.(Math.min(99, (offset / spec.size) * 100), t('progress.modelVerifying'))
      if (offset === spec.size) {
        const existing = await hashFile(partPath)
        if (existing === spec.sha256) {
          await rename(partPath, path)
          await writeMarker(id, spec.sha256, spec.version, spec.size)
          await recordModelVersion(id, spec.version)
          options.onProgress?.(100, t('progress.modelDownloaded'))
          return path
        }
        await unlink(partPath).catch(() => undefined)
        offset = 0
      } else {
        await new Promise<void>((resolve, reject) => {
          const existingStream = createReadStream(partPath)
          existingStream.on('data', (chunk) => hash.update(chunk))
          existingStream.on('error', reject)
          existingStream.on('end', () => resolve())
        })
      }
    }
  } catch {
    offset = 0
    hash = createHash('sha256')
  }

  const headers: Record<string, string> = {
    'User-Agent': 'webinar-speech-review/0.1',
    Accept: 'application/octet-stream'
  }
  if (offset > 0) headers.Range = `bytes=${offset}-`

  const response = await requestStream(spec.url, headers)
  const status = response.statusCode ?? 0
  if (status !== 200 && status !== 206) {
    response.resume()
    throw new Error(t('error.modelDownloadHttp', { status }))
  }

  const append = status === 206 && offset > 0
  if (!append) {
    offset = 0
    hash = createHash('sha256')
  }

  const totalHeader = response.headers['content-length']
  const total = append ? spec.size : Number(totalHeader ?? spec.size) || spec.size
  let received = offset
  let lastPercent = -1

  const output = createWriteStream(partPath, { flags: append ? 'a' : 'w' })

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      response.destroy()
      output.destroy()
      reject(error)
    }
    const abort = (): void => fail(new DOMException('Aborted', 'AbortError'))
    if (options.signal) {
      if (options.signal.aborted) {
        abort()
        return
      }
      options.signal.addEventListener('abort', abort, { once: true })
    }

    response.on('data', (chunk: Buffer) => {
      received += chunk.length
      hash.update(chunk)
      const percent = Math.min(99, Math.round((received / total) * 100))
      if (percent !== lastPercent) {
        lastPercent = percent
        options.onProgress?.(percent, t('progress.modelDownloading', { percent }))
      }
    })
    response.on('error', (error) => fail(error))
    output.on('error', (error) => fail(error))
    output.on('finish', () => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', abort)
      resolve()
    })
    response.pipe(output)
  })

  const actual = hash.digest('hex')
  const finalSize = (await stat(partPath)).size
  if (finalSize !== spec.size || actual !== spec.sha256) {
    await unlink(partPath).catch(() => undefined)
    throw new Error(
      t('error.modelVerifyFailed', { size: finalSize, hash: actual.slice(0, 12) })
    )
  }

  await rename(partPath, path)
  await writeMarker(id, spec.sha256, spec.version, spec.size)
  await recordModelVersion(id, spec.version)
  options.onProgress?.(100, t('progress.modelDownloaded'))
  return path
}
