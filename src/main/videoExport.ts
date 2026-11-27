import { app, BrowserWindow, dialog } from 'electron'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { extname, join } from 'node:path'
import { translate } from '@shared/i18n'
import type { VideoExportProgress, VideoExportRequest } from '@shared/types'
import { videoKeepRanges } from '@shared/videoExport'
import { ffmpegPorts } from './engine/ffmpegPorts'
import {
  ExportError,
  resolveExportJob,
  validateExportSource,
  type ExportErrorCode,
  type ExportMedia
} from './engine/exportJob'
import { runExport, type ExportProgressEvent } from './engine/exportPipeline'
import { probeMedia } from './engine/ffmpeg'
import { ffmpegBinary, tempDir } from './paths'
import { currentUiLanguage } from './uiLanguage'

let active: AbortController | null = null
let busy = false

function t(key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]): string {
  return translate(currentUiLanguage(), key, params)
}

/** Codes that carry ffmpeg's stderr into the message. */
const DETAILED_ERRORS: ReadonlySet<ExportErrorCode> = new Set([
  'decodeFailed',
  'renderFailed',
  'mediaFailed'
])

const ERROR_KEYS: Record<ExportErrorCode, Parameters<typeof translate>[1]> = {
  noFragments: 'error.videoNoFragments',
  noVideoTrack: 'error.noVideoTrack',
  noAudioTrack: 'error.noAudioTrack',
  fpsUnknown: 'error.videoFpsUnknown',
  videoFormat: 'error.videoFormat',
  overwriteSource: 'error.overwriteSource',
  decodeFailed: 'error.videoExportFailed',
  renderFailed: 'error.videoExportFailed',
  mediaFailed: 'error.videoExportFailed',
  noOutput: 'error.videoNoOutput'
}

/** The only place an export failure becomes user-facing text. */
function errorMessage(code: ExportErrorCode, details?: string): string {
  const key = ERROR_KEYS[code]
  return DETAILED_ERRORS.has(code) ? t(key, { details: details ?? '' }) : t(key)
}

const STEP_KEYS = {
  decode: 'progress.videoPrepare',
  mix: 'progress.videoAudio'
} as const

function progressMessage(event: ExportProgressEvent): string {
  if (event.phase === 'render') return t('progress.videoRender')
  if (event.phase === 'finalize') return t('progress.videoDone')
  return t(STEP_KEYS[event.step ?? 'decode'])
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'webinar'
}

async function executable(path: string): Promise<boolean> {
  if (!path) return false
  return access(path, constants.X_OK)
    .then(() => true)
    .catch(() => false)
}

function ensureExtension(path: string, extension: string): string {
  const current = extname(path)
  return current && current !== '.' ? path : `${path}${extension}`
}

function temporaryOutputPath(output: string): string {
  const extension = extname(output)
  const base = extension ? output.slice(0, -extension.length) : output
  return `${base}.part-${randomUUID()}${extension}`
}


async function runVideoExport(
  window: BrowserWindow | null,
  request: VideoExportRequest,
  onProgress: (value: VideoExportProgress) => void
): Promise<string | null> {
  const ffmpeg = ffmpegBinary()
  if (!(await executable(ffmpeg))) {
    throw new Error(t('error.ffmpegMissing'))
  }

  // Validate the source before asking for a destination: a file with no video
  // track should fail without opening a save dialog.
  const keep = videoKeepRanges(request.cuts, request.duration)
  if (keep.length === 0) throw new Error(errorMessage('noFragments'))
  const probe = await probeMedia(ffmpeg, request.videoPath)
  const media: ExportMedia = {
    hasVideo: probe.hasVideo,
    hasAudio: probe.hasAudio,
    fps: probe.fps,
    sampleRate: probe.sampleRate
  }
  const invalid = validateExportSource(keep, media)
  if (invalid) throw new Error(errorMessage(invalid))

  const settings = request.settings
  const extension = '.mp4'
  const saveOptions = {
    title: t('dialog.exportVideo'),
    defaultPath: join(
      app.getPath('downloads'),
      `${safeName(request.projectName)}-clean${extension}`
    ),
    filters: [
      { name: 'MP4', extensions: ['mp4'] },
      { name: 'MOV', extensions: ['mov'] }
    ]
  }
  const result = window
    ? await dialog.showSaveDialog(window, saveOptions)
    : await dialog.showSaveDialog(saveOptions)
  if (result.canceled || !result.filePath) return null

  const output = ensureExtension(result.filePath, extension)
  const resolved = resolveExportJob({
    videoPath: request.videoPath,
    outputPath: output,
    temporaryPath: temporaryOutputPath(output),
    cuts: request.cuts,
    duration: request.duration,
    media,
    settings
  })
  if (!resolved.ok) throw new Error(errorMessage(resolved.code))

  const controller = new AbortController()
  active = controller
  try {
    return await runExport({
      job: resolved.job,
      ports: ffmpegPorts(ffmpeg, tempDir()),
      signal: controller.signal,
      onProgress: (event) =>
        onProgress({
          projectId: request.projectId,
          phase: event.phase,
          percent: event.percent,
          processedSec: event.processedSec,
          totalSec: event.totalSec,
          message: progressMessage(event)
        })
    })
  } catch (error) {
    if (error instanceof ExportError) {
      throw new Error(errorMessage(error.code, error.details))
    }
    throw error
  } finally {
    if (active === controller) active = null
  }
}

export function cancelVideoExport(): void {
  active?.abort()
}

export async function exportVideo(
  window: BrowserWindow | null,
  request: VideoExportRequest,
  onProgress: (value: VideoExportProgress) => void
): Promise<string | null> {
  if (busy) throw new Error(t('error.videoExportRunning'))
  busy = true
  try {
    return await runVideoExport(window, request, onProgress)
  } finally {
    busy = false
  }
}
