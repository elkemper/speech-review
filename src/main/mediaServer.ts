import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import type { MediaRegistration } from '@shared/types'

const files = new Map<string, string>()

function tokenFor(path: string): string {
  return createHash('sha1').update(path).digest('hex').slice(0, 24)
}

export function registerMedia(path: string): MediaRegistration {
  const token = tokenFor(path)
  files.set(token, path)
  return { id: token, url: `app-media://media/${token}` }
}

function mimeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.mp4':
    case '.m4v':
    case '.mov':
      return 'video/mp4'
    case '.webm':
      return 'video/webm'
    case '.mkv':
      return 'video/x-matroska'
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    case '.m4a':
      return 'audio/mp4'
    case '.ogg':
    case '.opus':
      return 'audio/ogg'
    case '.aac':
      return 'audio/aac'
    default:
      return 'application/octet-stream'
  }
}

function headersFor(path: string, size: number): Record<string, string> {
  return {
    'Content-Type': mimeFor(path),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=0, must-revalidate'
  }
}

function notFound(): Response {
  return new Response('Not found', { status: 404 })
}

export function registerMediaProtocol(): void {
  protocol.handle('app-media', async (request) => {
    const url = new URL(request.url)
    const token = url.pathname.replace(/^\/+/, '')
    const path = files.get(token)
    if (!path) return notFound()

    const info = await stat(path).catch(() => null)
    if (!info || !info.isFile()) return notFound()

    const baseHeaders = headersFor(path, info.size)
    if (request.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: { ...baseHeaders, 'Content-Length': String(info.size) }
      })
    }

    const rangeHeader = request.headers.get('Range')
    if (!rangeHeader) {
      const stream = createReadStream(path)
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 200,
        headers: { ...baseHeaders, 'Content-Length': String(info.size) }
      })
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
    if (!match) {
      return new Response('Range not satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${info.size}` }
      })
    }

    let start: number
    let end: number
    if (match[1] === '') {
      const suffix = Number(match[2])
      if (!Number.isFinite(suffix) || suffix <= 0) {
        return new Response('Range not satisfiable', {
          status: 416,
          headers: { 'Content-Range': `bytes */${info.size}` }
        })
      }
      start = Math.max(0, info.size - suffix)
      end = info.size - 1
    } else {
      start = Number(match[1])
      end = match[2] === '' ? info.size - 1 : Number(match[2])
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= info.size) {
      return new Response('Range not satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${info.size}` }
      })
    }

    end = Math.min(end, info.size - 1)
    const stream = createReadStream(path, { start, end })

    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        ...baseHeaders,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${info.size}`
      }
    })
  })
}
