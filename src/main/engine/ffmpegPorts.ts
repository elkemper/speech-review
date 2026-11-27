import { mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseFfmpegOutTime } from '@shared/videoExport'
import { mixAudio } from './audioMix'
import { ExportError } from './exportJob'
import type { ExportPorts } from './exportPipeline'
import { runProcess, tail } from './proc'

/**
 * The real side effects of an export: ffmpeg, the work directory and the
 * output file. Kept apart from `main/videoExport.ts`, which owns the Electron
 * dialog, so the pipeline can be driven from tests with the real ports.
 */
export function ffmpegPorts(ffmpeg: string, workRoot: string): ExportPorts {
  return {
    createWorkDir: () => mkdtemp(join(workRoot, 'video-export-')),
    writeText: (path, text) => writeFile(path, text, 'utf8'),
    remove: (path) => rm(path, { force: true }),
    removeDir: (path) => rm(path, { recursive: true, force: true }),
    decodeAudio: async (input, output, sampleRate, signal) => {
      const result = await runProcess(
        ffmpeg,
        [
          '-hide_banner',
          '-nostdin',
          '-y',
          '-i',
          input,
          '-vn',
          '-map',
          '0:a:0',
          '-ac',
          '2',
          '-ar',
          String(sampleRate),
          '-c:a',
          'pcm_s16le',
          output,
          '-loglevel',
          'error'
        ],
        { signal }
      )
      if (result.code !== 0) {
        throw new ExportError('decodeFailed', tail(result.stderr, 12) || `${result.code}`)
      }
    },
    mixAudio: async (options) => {
      await mixAudio(options)
    },
    render: async (args, signal, onOutTime) => {
      let buffer = ''
      const result = await runProcess(ffmpeg, args, {
        signal,
        onStdout: (chunk) => {
          buffer += chunk
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            const seconds = parseFfmpegOutTime(line)
            if (seconds !== null) onOutTime(seconds)
          }
        }
      })
      if (result.code !== 0) {
        throw new ExportError('renderFailed', tail(result.stderr, 12) || `${result.code}`)
      }
    },
    move: (from, to) => rename(from, to),
    fileSize: async (path) => (await stat(path).catch(() => null))?.size ?? 0
  }
}
