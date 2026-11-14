import { app, BrowserWindow, dialog } from 'electron'
import { constants } from 'node:fs'
import { access, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { extname, join, resolve } from 'node:path'
import { normalizeVideoExportSettings } from '@shared/settings'
import type { VideoExportProgress, VideoExportRequest } from '@shared/types'
import {
  buildConcatList,
  buildCopyArgs,
  buildReencodeArgs,
  buildVideoFilterGraph,
  exportDuration,
  parseFfmpegOutTime,
  videoKeepRanges
} from '@shared/videoExport'
import { probeMedia } from './engine/ffmpeg'
import { runProcess, tail } from './engine/proc'
import { ffmpegBinary, tempDir } from './paths'

let active: AbortController | null = null
let busy = false

export function cancelVideoExport(): void {
  active?.abort()
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

/** Keep a stream-copy output in a container that matches the source codecs. */
function copyExtension(input: string): string {
  const extension = extname(input).toLowerCase()
  if (extension === '.m4v') return '.mp4'
  if (['.mp4', '.mov', '.mkv', '.webm'].includes(extension)) return extension
  return '.mkv'
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
    throw new Error('ffmpeg не найден. Запустите npm run fetch:engine и перезапустите приложение.')
  }

  const settings = normalizeVideoExportSettings(request.settings)
  const keep = videoKeepRanges(request.cuts, request.duration)
  if (keep.length === 0) {
    throw new Error('Все отмеченные места вырезаны — экспортировать нечего')
  }
  const totalSec = exportDuration(keep)

  onProgress({
    projectId: request.projectId,
    phase: 'prepare',
    percent: 0,
    processedSec: 0,
    totalSec,
    message: 'Проверяю исходный файл…'
  })

  const probe = await probeMedia(ffmpeg, request.videoPath)
  if (!probe.hasVideo) {
    throw new Error(
      'В исходном файле нет видеодорожки. Экспорт аудиофайлов пока не поддерживается.'
    )
  }
  if (!settings.copyMode && !probe.hasAudio) {
    throw new Error('В исходном файле нет аудиодорожки')
  }

  const extension = settings.copyMode ? copyExtension(request.videoPath) : '.mp4'
  const filters = settings.copyMode
    ? [{ name: 'Видео', extensions: [extension.slice(1)] }]
    : [
        { name: 'MP4', extensions: ['mp4'] },
        { name: 'MOV', extensions: ['mov'] }
      ]
  const saveOptions = {
    title: 'Экспорт видео',
    defaultPath: join(
      app.getPath('downloads'),
      `${safeName(request.projectName)}-clean${extension}`
    ),
    filters
  }
  const result = window
    ? await dialog.showSaveDialog(window, saveOptions)
    : await dialog.showSaveDialog(saveOptions)
  if (result.canceled || !result.filePath) return null

  const output = ensureExtension(result.filePath, extension)
  if (resolve(output) === resolve(request.videoPath)) {
    throw new Error('Нельзя перезаписать исходный видеофайл')
  }
  if (
    !settings.copyMode &&
    !['.mp4', '.m4v', '.mov'].includes(extname(output).toLowerCase())
  ) {
    throw new Error('Перекодированное видео можно сохранить только в MP4 или MOV')
  }

  const workDir = await mkdtemp(join(tempDir(), 'video-export-'))
  const temporary = temporaryOutputPath(output)
  const controller = new AbortController()
  active = controller

  try {
    let args: string[]
    if (settings.copyMode) {
      const concatList = join(workDir, 'concat.txt')
      await writeFile(concatList, buildConcatList(request.videoPath, keep), 'utf8')
      args = buildCopyArgs({ output: temporary, concatListPath: concatList })
    } else {
      const filterScript = join(workDir, 'filter.txt')
      await writeFile(
        filterScript,
        buildVideoFilterGraph(keep, settings.resolution),
        'utf8'
      )
      args = buildReencodeArgs({
        input: request.videoPath,
        output: temporary,
        filterScriptPath: filterScript,
        settings
      })
    }

    const message = settings.copyMode ? 'Копирую фрагменты…' : 'Кодирую видео…'
    onProgress({
      projectId: request.projectId,
      phase: 'render',
      percent: 0,
      processedSec: 0,
      totalSec,
      message
    })

    let buffer = ''
    let lastPercent = -1
    const finished = await runProcess(ffmpeg, args, {
      signal: controller.signal,
      onStdout: (chunk) => {
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const processedSec = parseFfmpegOutTime(line)
          if (processedSec === null) continue
          const percent =
            totalSec > 0
              ? Math.max(0, Math.min(99, Math.floor((processedSec / totalSec) * 100)))
              : 0
          if (percent === lastPercent) continue
          lastPercent = percent
          onProgress({
            projectId: request.projectId,
            phase: 'render',
            percent,
            processedSec,
            totalSec,
            message
          })
        }
      }
    })

    if (finished.code !== 0) {
      throw new Error(
        `ffmpeg не смог экспортировать видео:\n${
          tail(finished.stderr, 12) || `код ${finished.code}`
        }`
      )
    }
    if (controller.signal.aborted) {
      await rm(temporary, { force: true }).catch(() => undefined)
      return null
    }

    const info = await stat(temporary).catch(() => null)
    if (!info || info.size <= 0) {
      throw new Error('ffmpeg завершился без файла результата')
    }
    await rename(temporary, output)

    onProgress({
      projectId: request.projectId,
      phase: 'finalize',
      percent: 100,
      processedSec: totalSec,
      totalSec,
      message: 'Готово'
    })
    return output
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    if (controller.signal.aborted) return null
    throw error
  } finally {
    if (active === controller) active = null
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function exportVideo(
  window: BrowserWindow | null,
  request: VideoExportRequest,
  onProgress: (value: VideoExportProgress) => void
): Promise<string | null> {
  if (busy) throw new Error('Видеоэкспорт уже идёт')
  busy = true
  try {
    return await runVideoExport(window, request, onProgress)
  } finally {
    busy = false
  }
}
