import { spawn } from 'node:child_process'
import { join } from 'node:path'

export interface SourceOptions {
  dir: string
  seconds?: number
  fps?: number
  width?: number
  height?: number
  sampleRate?: number
  /**
   * Irregular frame timestamps: every third frame is pushed back 20 ms while
   * the frame count stays the same. A real-world capture with a variable
   * frame rate behaves like this, and frame index no longer maps to time.
   */
  vfr?: boolean
}

export interface SourceSpec {
  path: string
  duration: number
  fps: number
  width: number
  height: number
  seconds: number
}

export interface RunOutput {
  code: number
  stdout: Buffer
  stderr: string
}

/** Raw stdout matters: frame samples and PCM are binary. */
export function capture(
  command: string,
  args: string[],
  timeoutMs = 120_000
): Promise<RunOutput> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`ffmpeg timed out: ${args.join(' ')}`))
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ code: code ?? -1, stdout: Buffer.concat(stdout), stderr })
    })
  })
}

/**
 * The source is a continuous timecode, not one value per second.
 *
 * Video: the red channel carries the whole second (`25 * (second + 1)`), the
 * green channel the fraction of the second (`0…240`). A frame therefore says
 * where in the source it belongs to about 4 ms.
 *
 * Audio: a linear chirp from 300 Hz rising by `CHIRP_SLOPE` Hz per second, so
 * the measured frequency also gives an absolute source time. A drift of a few
 * tenths of a second cannot hide inside a one-second bucket.
 */
export const CHIRP_START = 300
export const CHIRP_SLOPE = 270

/** Exact rational for the standard NTSC-family rates, decimal otherwise. */
export function rateString(fps: number): string {
  const ratios: Array<[string, number]> = [
    ['24000/1001', 24000 / 1001],
    ['30000/1001', 30000 / 1001],
    ['48000/1001', 48000 / 1001],
    ['60000/1001', 60000 / 1001],
    ['120000/1001', 120000 / 1001]
  ]
  for (const [text, value] of ratios) {
    if (Math.abs(fps - value) < 1e-6) return text
  }
  return Number.isInteger(fps) ? String(fps) : `${Math.round(fps * 1000)}/1000`
}

export function timeFromColor(rgb: [number, number, number]): number {
  const second = Math.round(rgb[0] / 25) - 1
  const fraction = Math.min(1, Math.max(0, rgb[1] / 240))
  return second + fraction
}

export function timeFromFrequency(frequency: number): number {
  return (frequency - CHIRP_START) / CHIRP_SLOPE
}

/**
 * Builds a deterministic 10-second source: the video colour and the audio
 * frequency both encode the source second, so a sampled output position can be
 * traced back to the source time independently of the export code.
 */
export async function makeSource(ffmpeg: string, options: SourceOptions): Promise<SourceSpec> {
  const seconds = options.seconds ?? 10
  const fps = options.fps ?? 25
  const width = options.width ?? 320
  const height = options.height ?? 180
  const sampleRate = options.sampleRate ?? 48000
  const rate = rateString(fps)

  // R: whole second, G: fraction of the second, B: unused.
  const colour = `geq=r='25*(floor(T)+1)':g='(T-floor(T))*240':b='0'`
  // Drop every seventh frame: irregular gaps in the timestamps while the
  // duration and the audio stay the same.
  const timestamps = options.vfr ? `,select='not(eq(mod(n,7),3))'` : ''
  // Phase of a linear chirp: f(t) = 300 + 270 t, so phase = 2π(300 t + 135 t²).
  const chirp = 'aevalsrc=sin(2*PI*(300*t+135*t*t)):s=' + sampleRate

  const path = join(
    options.dir,
    `source-${seconds}s-${Math.round(fps)}fps${options.vfr ? '-vfr' : ''}.mp4`
  )
  const result = await capture(ffmpeg, [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=${width}x${height}:r=${rate}:d=${seconds}`,
    '-f',
    'lavfi',
    '-i',
    `${chirp}:d=${seconds}`,
    '-filter_complex',
    `[0:v]format=rgb24,${colour}${timestamps}[v];[1:a]anull[a]`,
    '-map',
    '[v]',
    '-map',
    '[a]',
    ...(options.vfr ? ['-fps_mode:v', 'vfr'] : []),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '16',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    path
  ])
  if (result.code !== 0) {
    throw new Error(`cannot build the test source: ${result.stderr.slice(-800)}`)
  }

  return { path, duration: seconds, fps, width, height, seconds }
}

/** Exact decoded video frame count. */
export async function countFrames(ffmpeg: string, path: string): Promise<number> {
  const result = await capture(ffmpeg, [
    '-hide_banner',
    '-nostdin',
    '-progress',
    'pipe:1',
    '-nostats',
    '-i',
    path,
    '-map',
    '0:v:0',
    '-f',
    'null',
    '-'
  ])
  const matches = [...result.stdout.toString('utf8').matchAll(/^frame=(\d+)$/gm)]
  return matches.length > 0 ? Number(matches[matches.length - 1][1]) : -1
}

/** Average colour of the frame shown at `seconds`. */
export async function sampleColor(
  ffmpeg: string,
  path: string,
  seconds: number
): Promise<[number, number, number]> {
  const result = await capture(ffmpeg, [
    '-v',
    'error',
    '-ss',
    seconds.toFixed(3),
    '-i',
    path,
    '-frames:v',
    '1',
    '-vf',
    'scale=1:1:flags=area',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-'
  ])
  return [result.stdout[0] ?? -1, result.stdout[1] ?? -1, result.stdout[2] ?? -1]
}

/** Rough fundamental of a 0.3 s window, from zero crossings. */
export async function sampleFrequency(
  ffmpeg: string,
  path: string,
  seconds: number,
  window = 0.3
): Promise<number> {
  const start = Math.max(0, seconds - window / 2)
  const result = await capture(ffmpeg, [
    '-v',
    'error',
    '-ss',
    start.toFixed(3),
    '-i',
    path,
    '-t',
    String(window),
    '-map',
    '0:a:0',
    '-ac',
    '1',
    '-ar',
    '8000',
    '-f',
    's16le',
    '-'
  ])
  let crossings = 0
  let previous = 0
  for (let offset = 0; offset + 1 < result.stdout.length; offset += 2) {
    const value = result.stdout.readInt16LE(offset)
    if (previous !== 0 && Math.sign(value) !== Math.sign(previous)) crossings++
    previous = value
  }
  return crossings / (2 * window)
}

/** Decoded audio length, which is what the player and the muxer see. */
export async function audioDuration(ffmpeg: string, path: string): Promise<number> {
  const result = await capture(ffmpeg, [
    '-v',
    'error',
    '-i',
    path,
    '-map',
    '0:a:0',
    '-ac',
    '1',
    '-ar',
    '48000',
    '-f',
    's16le',
    '-'
  ])
  return result.stdout.length / 2 / 48000
}

/** Mono 48 kHz PCM of the whole file. */
export async function decodePcm(ffmpeg: string, path: string): Promise<Int16Array> {
  const result = await capture(ffmpeg, [
    '-v',
    'error',
    '-i',
    path,
    '-map',
    '0:a:0',
    '-ac',
    '1',
    '-ar',
    '48000',
    '-f',
    's16le',
    '-'
  ])
  const samples = new Int16Array(result.stdout.length >> 1)
  for (let index = 0; index < samples.length; index++) {
    samples[index] = result.stdout.readInt16LE(index * 2)
  }
  return samples
}

/**
 * Average colour of every decoded frame. One 1×1 scale per frame in a single
 * ffmpeg call, so a full export can be traced frame by frame cheaply.
 */
export async function frameColors(
  ffmpeg: string,
  path: string
): Promise<Array<[number, number, number]>> {
  const result = await capture(ffmpeg, [
    '-v',
    'error',
    '-i',
    path,
    '-map',
    '0:v:0',
    '-vf',
    'scale=1:1:flags=area',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-'
  ])
  const colors: Array<[number, number, number]> = []
  for (let offset = 0; offset + 2 < result.stdout.length; offset += 3) {
    colors.push([result.stdout[offset], result.stdout[offset + 1], result.stdout[offset + 2]])
  }
  return colors
}

/**
 * Normalised correlation of a window of `a` against a window of `b`. 1 is the
 * same waveform, 0 is unrelated. Used to prove that the right moment matches
 * and a neighbouring moment does not.
 */
export function correlation(
  a: Int16Array,
  aStart: number,
  b: Int16Array,
  bStart: number,
  length: number
): number {
  let dot = 0
  let left = 0
  let right = 0
  for (let index = 0; index < length; index += 2) {
    const x = a[aStart + index] ?? 0
    const y = b[bStart + index] ?? 0
    dot += x * y
    left += x * x
    right += y * y
  }
  if (left === 0 || right === 0) return 0
  return dot / Math.sqrt(left * right)
}

/**
 * Lag, in samples, at which `window` of `a` best matches `b` around the
 * expected position. A correct export matches at 0; a tail taken from the
 * wrong moment or a fade that eats the end cannot reach 0.
 */
export function bestLag(
  a: Int16Array,
  aStart: number,
  b: Int16Array,
  bStart: number,
  length: number,
  maxLag = 960
): number {
  let best = 0
  let bestScore = -Infinity
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let score = 0
    for (let index = 0; index < length; index += 4) {
      const left = a[aStart + index]
      const right = b[bStart + index + lag]
      if (left === undefined || right === undefined) continue
      score += left * right
    }
    if (score > bestScore) {
      bestScore = score
      best = lag
    }
  }
  return best
}

/** Coded size parsed from the `ffmpeg -i` banner. */
export async function videoSize(
  ffmpeg: string,
  path: string
): Promise<{ width: number; height: number }> {
  const result = await capture(ffmpeg, ['-hide_banner', '-nostdin', '-i', path])
  const match = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(result.stderr)
  return match
    ? { width: Number(match[1]), height: Number(match[2]) }
    : { width: 0, height: 0 }
}

export async function hasEncoder(ffmpeg: string, name: string): Promise<boolean> {
  const result = await capture(ffmpeg, ['-hide_banner', '-encoders'])
  return result.stdout.toString('utf8').includes(` ${name} `)
}
