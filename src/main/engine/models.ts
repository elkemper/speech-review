import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { get } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { dirname } from 'node:path'
import { getModelSpec, MODEL_ORDER } from '@shared/models'
import type { ModelId, ModelStateInfo } from '@shared/types'
import { modelPath } from '../paths'

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

export async function modelState(id: ModelId): Promise<ModelState> {
  const path = modelPath(id)
  const spec = getModelSpec(id)
  try {
    const info = await stat(path)
    return { path, ready: info.size === spec.size, bytes: info.size }
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
 * Confirms that the model file matches the published hash. The result is
 * cached in a small marker file so startup does not re-hash 1.7 GB.
 */
export async function ensureModel(id: ModelId): Promise<string> {
  const path = modelPath(id)
  const spec = getModelSpec(id)
  const info = await stat(path).catch(() => null)
  if (!info || info.size !== spec.size) {
    throw new Error(`Модель ${spec.label} не скачана. Откройте настройки и загрузите её.`)
  }

  try {
    const marker = await readFile(markerPath(id), 'utf8')
    if (marker.trim() === spec.sha256) return path
  } catch {
    // No marker yet — verify below.
  }

  const actual = await hashFile(path)
  if (actual !== spec.sha256) {
    throw new Error(
      `Файл модели повреждён (SHA-256 ${actual.slice(0, 12)}…). Скачайте модель заново в настройках.`
    )
  }
  await writeFile(markerPath(id), `${spec.sha256}\n`, 'utf8')
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
    request.setTimeout(60_000, () => request.destroy(new Error('Таймаут загрузки модели')))
  })
}

export async function downloadModel(
  id: ModelId,
  options: ModelDownloadOptions = {}
): Promise<string> {
  const spec = getModelSpec(id)
  const path = modelPath(id)
  const partPath = `${path}.part`

  const current = await modelState(id)
  if (current.ready) {
    options.onProgress?.(100, 'Модель уже скачана')
    return ensureModel(id)
  }

  await mkdir(dirname(path), { recursive: true })

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
      options.onProgress?.(Math.min(99, (offset / spec.size) * 100), 'Проверяю скачанную часть…')
      if (offset === spec.size) {
        const existing = await hashFile(partPath)
        if (existing === spec.sha256) {
          await rename(partPath, path)
          await writeFile(markerPath(id), `${spec.sha256}\n`, 'utf8')
          options.onProgress?.(100, 'Модель скачана')
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
    throw new Error(`Не удалось скачать модель: HTTP ${status}`)
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
        options.onProgress?.(percent, `Скачиваю модель… ${percent}%`)
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
      `Скачанная модель не прошла проверку (${finalSize} Б, SHA-256 ${actual.slice(0, 12)}…). Попробуйте ещё раз.`
    )
  }

  await rename(partPath, path)
  await writeFile(markerPath(id), `${spec.sha256}\n`, 'utf8')
  options.onProgress?.(100, 'Модель скачана')
  return path
}
