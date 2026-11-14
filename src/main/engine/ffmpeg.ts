import { runProcess, tail } from './proc'

export interface SilenceInterval {
  start: number
  end: number
  duration: number
}

function parseDurationLine(text: string): number | null {
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text)
  if (!match) return null
  const [, h, m, s] = match
  return Number(h) * 3600 + Number(m) * 60 + Number(s)
}

export interface ProbeResult {
  duration: number
  hasAudio: boolean
  hasVideo: boolean
}

export async function probeMedia(ffmpeg: string, input: string, signal?: AbortSignal): Promise<ProbeResult> {
  const result = await runProcess(ffmpeg, ['-hide_banner', '-nostdin', '-i', input], { signal })
  const duration = parseDurationLine(result.stderr)
  if (duration === null) {
    throw new Error(`Не удалось прочитать файл: ${tail(result.stderr, 6) || 'неизвестный формат'}`)
  }
  const videoLines = result.stderr
    .split('\n')
    .filter((line) => /Stream #\d+:\d+.*: Video:/i.test(line))
  return {
    duration,
    hasAudio: /Stream #\d+:\d+.*: Audio:/i.test(result.stderr),
    // Cover art in an audio file is a video stream with `(attached pic)`.
    hasVideo: videoLines.some((line) => !/\(attached pic\)/i.test(line))
  }
}

export interface ExtractOptions {
  ffmpeg: string
  input: string
  output: string
  duration: number
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}

export async function extractAudio(options: ExtractOptions): Promise<void> {
  const args = [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i',
    options.input,
    '-vn',
    '-map',
    '0:a:0',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    '-progress',
    'pipe:1',
    '-nostats',
    options.output
  ]

  let lastReported = -1
  const result = await runProcess(options.ffmpeg, args, {
    signal: options.signal,
    onStdout: (chunk) => {
      for (const line of chunk.split('\n')) {
        const match = /^out_time_(?:us|ms)=(\d+)$/.exec(line.trim())
        if (!match || options.duration <= 0) continue
        const seconds = Number(match[1]) / 1_000_000
        const fraction = Math.max(0, Math.min(1, seconds / options.duration))
        if (fraction - lastReported >= 0.005) {
          lastReported = fraction
          options.onProgress?.(fraction)
        }
      }
    }
  })

  if (result.code !== 0) {
    throw new Error(`ffmpeg не смог извлечь аудио:\n${tail(result.stderr, 12)}`)
  }
}

export interface SilenceOptions {
  noiseDb?: number
  minSilenceSec?: number
  signal?: AbortSignal
}

export async function detectSilences(
  ffmpeg: string,
  input: string,
  duration: number,
  options: SilenceOptions = {}
): Promise<SilenceInterval[]> {
  const noiseDb = options.noiseDb ?? -38
  const minSilenceSec = options.minSilenceSec ?? 0.45
  const args = [
    '-hide_banner',
    '-nostdin',
    '-i',
    input,
    '-af',
    `silencedetect=noise=${noiseDb}dB:d=${minSilenceSec}`,
    '-f',
    'null',
    '-'
  ]

  const result = await runProcess(ffmpeg, args, { signal: options.signal })
  if (result.code !== 0) {
    throw new Error(`ffmpeg не смог найти паузы:\n${tail(result.stderr, 12)}`)
  }

  const intervals: SilenceInterval[] = []
  let pendingStart: number | null = null

  for (const line of result.stderr.split('\n')) {
    const startMatch = /silence_start:\s*(-?\d+(?:\.\d+)?)/.exec(line)
    if (startMatch) {
      pendingStart = Math.max(0, Number(startMatch[1]))
      continue
    }
    const endMatch = /silence_end:\s*(-?\d+(?:\.\d+)?)/.exec(line)
    if (endMatch && pendingStart !== null) {
      const end = Math.max(pendingStart, Number(endMatch[1]))
      intervals.push({ start: pendingStart, end, duration: end - pendingStart })
      pendingStart = null
    }
  }

  if (pendingStart !== null && duration > pendingStart) {
    intervals.push({ start: pendingStart, end: duration, duration: duration - pendingStart })
  }

  return intervals
}
