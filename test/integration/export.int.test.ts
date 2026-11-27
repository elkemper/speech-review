import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_VIDEO_EXPORT_SETTINGS } from '@shared/settings'
import type { CutRange, VideoExportSettings } from '@shared/types'
import { resolveExportJob } from '../../src/main/engine/exportJob'
import { ffmpegPorts } from '../../src/main/engine/ffmpegPorts'
import {
  runExport,
  type ExportProgressEvent
} from '../../src/main/engine/exportPipeline'
import { probeMedia } from '../../src/main/engine/ffmpeg'
import { resolveFfmpeg } from './env'
import {
  audioDuration,
  countFrames,
  hasEncoder,
  makeSource,
  sampleColor,
  sampleFrequency,
  timeFromColor,
  timeFromFrequency,
  videoSize,
  type SourceSpec
} from './media'

const ffmpeg = resolveFfmpeg()

/** Kept ranges, computed here so the expectation does not reuse the app code. */
function keepRanges(cuts: CutRange[], duration: number): CutRange[] {
  const sorted = [...cuts].sort((left, right) => left.start - right.start)
  const keep: CutRange[] = []
  let cursor = 0
  for (const cut of sorted) {
    if (cut.start > cursor) keep.push({ start: cursor, end: Math.min(cut.start, duration) })
    cursor = Math.max(cursor, cut.end)
  }
  if (cursor < duration) keep.push({ start: cursor, end: duration })
  return keep.filter((range) => range.end > range.start)
}

function expectedFrames(keep: CutRange[], fps: number, fadeSec = 0): number {
  const fadeFrames = fadeSec > 0 ? Math.round(fadeSec * fps) : 0
  const total = keep.reduce(
    (sum, range) => sum + Math.round(range.end * fps) - Math.round(range.start * fps),
    0
  )
  return total - Math.max(0, keep.length - 1) * fadeFrames
}

/** Output position of a source time when pieces are joined without a fade. */
function outputTimeFor(keep: CutRange[], sourceTime: number): number {
  let output = 0
  for (const range of keep) {
    if (sourceTime >= range.start && sourceTime <= range.end) {
      return output + (sourceTime - range.start)
    }
    output += range.end - range.start
  }
  throw new Error(`source time ${sourceTime} is not kept`)
}

describe.skipIf(!ffmpeg)('video export integration', () => {
  let baseDir = ''
  let outDir = ''
  let workRoot = ''
  let source: SourceSpec
  let ntsc: SourceSpec
  let ntsc24: SourceSpec
  let vfr: SourceSpec
  let stress: SourceSpec

  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'speech-review-int-'))
    outDir = join(baseDir, 'out')
    workRoot = join(baseDir, 'work')
    await mkdir(outDir)
    await mkdir(workRoot)
    source = await makeSource(ffmpeg!, { dir: baseDir })
    ntsc = await makeSource(ffmpeg!, { dir: baseDir, fps: 30000 / 1001 })
    ntsc24 = await makeSource(ffmpeg!, { dir: baseDir, fps: 24000 / 1001 })
    vfr = await makeSource(ffmpeg!, { dir: baseDir, vfr: true })
    stress = await makeSource(ffmpeg!, { dir: baseDir, seconds: 50 })
  }, 180_000)

  afterAll(async () => {
    if (baseDir) await rm(baseDir, { recursive: true, force: true })
  })

  interface ExportOptions {
    cuts: CutRange[]
    settings?: Partial<VideoExportSettings>
    name?: string
    signal?: AbortSignal
    media?: SourceSpec
    onProgress?: (event: ExportProgressEvent) => void
  }

  async function exportOnce(options: ExportOptions) {
    const media = options.media ?? source
    const probe = await probeMedia(ffmpeg!, media.path)
    const outputPath = join(outDir, options.name ?? `out-${randomUUID().slice(0, 8)}.mp4`)
    const resolved = resolveExportJob({
      videoPath: media.path,
      outputPath,
      temporaryPath: `${outputPath}.part-test.mp4`,
      cuts: options.cuts,
      duration: probe.duration,
      media: {
        hasVideo: probe.hasVideo,
        hasAudio: probe.hasAudio,
        fps: probe.fps,
        sampleRate: probe.sampleRate
      },
      settings: { ...DEFAULT_VIDEO_EXPORT_SETTINGS, ...options.settings }
    })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) throw new Error(resolved.code)

    const progress: ExportProgressEvent[] = []
    const output = await runExport({
      job: resolved.job,
      ports: ffmpegPorts(ffmpeg!, workRoot),
      signal: options.signal ?? new AbortController().signal,
      onProgress: (event) => {
        progress.push(event)
        options.onProgress?.(event)
      }
    })
    return { output, outputPath, plan: resolved.job.plan, progress, probe }
  }

  /**
   * The source carries a continuous timecode in both tracks, so this compares
   * times, not buckets: an offset of a few tenths of a second fails here.
   */
  async function expectContentAt(
    output: string,
    outputTime: number,
    sourceTime: number
  ): Promise<void> {
    const rgb = await sampleColor(ffmpeg!, output, outputTime)
    // Measured estimation noise is 4 ms for video and 11 ms for audio; the
    // tolerance leaves room for other encoders while still failing a 0.1 s
    // drift.
    const videoTime = timeFromColor(rgb)
    expect(Math.abs(videoTime - sourceTime)).toBeLessThanOrEqual(0.06)

    const frequency = await sampleFrequency(ffmpeg!, output, outputTime)
    const audioTime = timeFromFrequency(frequency)
    expect(Math.abs(audioTime - sourceTime)).toBeLessThanOrEqual(0.08)
  }

  function expectClose(actual: number, expected: number, tolerance: number): void {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)
  }

  it('re-encodes the whole source when nothing is cut', async () => {
    const { output, plan } = await exportOnce({ cuts: [], name: 'identity.mp4' })
    expect(output).toBe(join(outDir, 'identity.mp4'))
    expect(await countFrames(ffmpeg!, output!)).toBe(250)
    expectClose(await audioDuration(ffmpeg!, output!), 10, 0.1)
    expect(plan.videoFrames).toBe(250)

    await expectContentAt(output!, 2.5, 2.5)
    await expectContentAt(output!, 6.5, 6.5)
  })

  it('removes a middle cut and keeps the surviving seconds in order', async () => {
    const cuts = [{ start: 4, end: 5 }]
    const { output } = await exportOnce({ cuts, name: 'middle.mp4' })
    expect(await countFrames(ffmpeg!, output!)).toBe(expectedFrames(keepRanges(cuts, 10), 25))
    expectClose(await audioDuration(ffmpeg!, output!), 9, 0.1)

    await expectContentAt(output!, outputTimeFor(keepRanges(cuts, 10), 2.5), 2.5)
    await expectContentAt(output!, outputTimeFor(keepRanges(cuts, 10), 7.5), 7.5)
  })

  it('removes a head cut and a tail cut', async () => {
    const cuts = [
      { start: 0, end: 1 },
      { start: 9, end: 10 }
    ]
    const keep = keepRanges(cuts, 10)
    const { output } = await exportOnce({ cuts, name: 'edges.mp4' })
    expect(await countFrames(ffmpeg!, output!)).toBe(expectedFrames(keep, 25))

    await expectContentAt(output!, outputTimeFor(keep, 3.5), 3.5)
    await expectContentAt(output!, outputTimeFor(keep, 8.5), 8.5)
  })

  it('keeps a piece shorter than the crossfade in sync', async () => {
    // 0.2 s is five frames at 25 fps: exactly one fade, the clamped case.
    const cuts = [
      { start: 2, end: 3 },
      { start: 3.2, end: 10 }
    ]
    const keep = keepRanges(cuts, 10)
    const { output, plan } = await exportOnce({
      cuts,
      name: 'short-piece.mp4',
      settings: { crossfade: true, crossfadeSec: 0.2 }
    })
    expect(plan.videoFrames).toBe(expectedFrames(keep, 25, 0.2))
    expect(plan.videoFrames).toBe(50)
    expect(await countFrames(ffmpeg!, output!)).toBe(50)
    expectClose(await audioDuration(ffmpeg!, output!), 2, 0.1)
  })

  it('rounds non-integer cut boundaries to whole frames and stays in sync', async () => {
    const cuts = [{ start: 1.34, end: 2.66 }]
    const { output, plan } = await exportOnce({ cuts, name: 'rounding.mp4' })
    expect(await countFrames(ffmpeg!, output!)).toBe(plan.videoFrames)
    expectClose(await audioDuration(ffmpeg!, output!), plan.videoFrames / 25, 0.1)
  })

  it('keeps a 29.97 fps source in sync', async () => {
    const cuts = [{ start: 4, end: 5 }]
    const { output, plan } = await exportOnce({
      cuts,
      name: 'ntsc.mp4',
      media: ntsc
    })
    const frames = await countFrames(ffmpeg!, output!)
    expect(frames).toBe(plan.videoFrames)
    expectClose(await audioDuration(ffmpeg!, output!), frames / 29.97, 0.1)
  })

  it('recovers the exact frame rate from the rounded ffmpeg banner', async () => {
    // The banner says 23.98 for a 24000/1001 stream. Retiming with the rounded
    // value makes the video run ahead of the audio by about 0.9 s per 90 min.
    const probe = await probeMedia(ffmpeg!, ntsc24.path)
    expect(probe.fps).toBeCloseTo(24000 / 1001, 6)
  })

  it('crossfades without shifting the tracks', async () => {
    const cuts = [
      { start: 3, end: 4 },
      { start: 7, end: 8 }
    ]
    const { output, plan } = await exportOnce({
      cuts,
      name: 'crossfade.mp4',
      settings: { crossfade: true, crossfadeSec: 0.2 }
    })
    // 3 + 3 + 2 s of material minus two five-frame fades.
    expect(await countFrames(ffmpeg!, output!)).toBe(190)
    expect(plan.videoFrames).toBe(190)
    expectClose(await audioDuration(ffmpeg!, output!), 7.6, 0.1)

    // Hand-computed output times: piece 3 starts at 2.8 s, piece 3 at 5.6 s.
    await expectContentAt(output!, 1.5, 1.5)
    await expectContentAt(output!, 4.3, 5.5)
    await expectContentAt(output!, 6.2, 8.6)
  })

  /**
   * The audio mixture at a join contains both pieces; the picture must too.
   * Each frame is a timecode, so a 50/50 dissolve at the middle of the fade
   * reports the midpoint of the two source times, while a hard cut would report
   * the incoming piece only — 0.7 s away here.
   */
  it('dissolves the picture over the join instead of jumping to the next piece', async () => {
    const cuts = [{ start: 4, end: 5 }]
    const { output, plan } = await exportOnce({
      cuts,
      name: 'dissolve.mp4',
      settings: { crossfade: true, crossfadeSec: 0.4 }
    })

    // 100 + 125 frames, minus the 10-frame dissolve.
    expect(plan.videoFrames).toBe(215)
    expect(await countFrames(ffmpeg!, output!)).toBe(215)

    // The fade covers output 3.6–4.0 s, blending source 3.6–4.0 with 5.0–5.4.
    const middle = timeFromColor(await sampleColor(ffmpeg!, output!, 3.8))
    expect(Math.abs(middle - (3.8 + 5.2) / 2)).toBeLessThanOrEqual(0.12)

    // Outside the fade the film is the incoming material, as in a plain cut.
    await expectContentAt(output!, 4.2, 5.6)
    await expectContentAt(output!, 2.5, 2.5)
  })

  /**
   * Lip sync: at the same output position, the video and the audio must point
   * at the same source time. Points are chosen clear of the 0.4 s fades, where
   * both tracks deliberately blend the same pair of source moments.
   */
  it('keeps video and audio on the same source time across four 0.4 s joins', async () => {
    const cuts = [
      { start: 1.5, end: 2 },
      { start: 4, end: 4.5 },
      { start: 6, end: 7 },
      { start: 8.5, end: 9 }
    ]
    const { output, plan } = await exportOnce({
      cuts,
      name: 'lipsync.mp4',
      settings: { crossfade: true, crossfadeSec: 0.4 }
    })

    expect(await countFrames(ffmpeg!, output!)).toBe(plan.videoFrames)
    expectClose(await audioDuration(ffmpeg!, output!), plan.videoFrames / 25, 0.1)

    // Joins land at 1.12, 2.72, 3.8 and 4.92 s; sample every piece away from
    // them, where both tracks must report the same single source time.
    for (const at of [0.2, 0.6, 1.6, 2.1, 3.2, 3.55, 4.3, 4.6, 5.6]) {
      const videoTime = timeFromColor(await sampleColor(ffmpeg!, output!, at))
      const audioTime = timeFromFrequency(await sampleFrequency(ffmpeg!, output!, at))
      expect(Math.abs(videoTime - audioTime)).toBeLessThanOrEqual(0.1)
    }

    // Inside the first fade the picture must be a mixture of the outgoing and
    // incoming material, the same pair the audio mixes: output 1.2 s blends
    // source 1.2 s with 2.08 s. A hard cut would show 2.08 s and read as a
    // lip-sync jump.
    const inFade = timeFromColor(await sampleColor(ffmpeg!, output!, 1.2))
    expect(inFade).toBeGreaterThan(1.1)
    expect(inFade).toBeLessThan(1.75)
  })

  it('keeps a variable-frame-rate source on the audio timeline', async () => {
    const cuts = [
      { start: 1.5, end: 2 },
      { start: 4, end: 4.5 },
      { start: 6, end: 7 },
      { start: 8.5, end: 9 }
    ]
    const { output, plan } = await exportOnce({
      cuts,
      media: vfr,
      name: 'vfr.mp4',
      settings: { crossfade: true, crossfadeSec: 0.4 }
    })

    // Frame-index arithmetic used to lose a frame here.
    expect(await countFrames(ffmpeg!, output!)).toBe(plan.videoFrames)
    for (const at of [0.2, 0.8, 2.0, 3.2, 4.4]) {
      const videoTime = timeFromColor(await sampleColor(ffmpeg!, output!, at))
      const audioTime = timeFromFrequency(await sampleFrequency(ffmpeg!, output!, at))
      expect(Math.abs(videoTime - audioTime)).toBeLessThanOrEqual(0.12)
    }
  })

  it('holds the invariants across randomised cut lists', async () => {
    let seed = 20261125
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }

    for (let round = 0; round < 3; round++) {
      const cuts: CutRange[] = []
      while (cuts.length < 6) {
        const start = 1 + Math.floor(random() * 8)
        if (!cuts.some((cut) => cut.start === start)) {
          cuts.push({ start, end: start + 1 })
        }
      }
      const keep = keepRanges(cuts, 10)
      const { output } = await exportOnce({ cuts, name: `random-${round}.mp4` })
      const frames = await countFrames(ffmpeg!, output!)
      expect(frames).toBe(expectedFrames(keep, 25))
      expectClose(await audioDuration(ffmpeg!, output!), frames / 25, 0.1)

      // First and last kept piece: an offset that accumulates at every join
      // shows up at the end even when the first join is clean.
      const eligible = keep.filter((range) => range.end - range.start >= 1)
      const samples = [eligible[0], eligible[eligible.length - 1]].map(
        (range) => range.start + 0.5
      )
      expect(samples.length).toBeGreaterThan(0)
      for (const sourceTime of samples) {
        await expectContentAt(output!, outputTimeFor(keep, sourceTime), sourceTime)
      }
    }
  }, 120_000)

  it('cancels a running export without leaving output or a work directory', async () => {
    const controller = new AbortController()
    let aborted = false
    const { output } = await exportOnce({
      cuts: [{ start: 4, end: 5 }],
      name: 'cancel.mp4',
      signal: controller.signal,
      onProgress: (event) => {
        if (event.phase === 'render' && !aborted) {
          aborted = true
          controller.abort()
        }
      }
    })

    expect(aborted).toBe(true)
    expect(output).toBeNull()
    expect(await readdir(outDir)).not.toContain('cancel.mp4')
    expect((await readdir(outDir)).filter((name) => name.includes('.part-'))).toEqual([])
    expect(await readdir(workRoot)).toEqual([])
  })

  it('scales to the requested height', async () => {
    const { output } = await exportOnce({
      cuts: [{ start: 4, end: 5 }],
      name: 'scaled.mp4',
      settings: { resolution: '720' }
    })
    expect(await videoSize(ffmpeg!, output!)).toEqual({ width: 1280, height: 720 })
    expect(await countFrames(ffmpeg!, output!)).toBe(225)
  })

  /**
   * Every join adds one `xfade`, and ffmpeg hands each filter a slice of the
   * graph thread pool. At the default pool size a few hundred joins exhaust the
   * process thread limit and the graph fails before the first frame
   * (`Resource temporarily unavailable`, reproduced at 350 joins on a 6-thread
   * host). Four hundred joins must still configure and finish.
   */
  it('handles hundreds of crossfade joins', async () => {
    const cuts: CutRange[] = []
    // Keep two frames, drop one, through the whole 50 s source.
    for (let frame = 2; frame + 1 <= 1250; frame += 3) {
      cuts.push({ start: frame / 25, end: (frame + 1) / 25 })
    }
    const keep = keepRanges(cuts, 50)
    expect(keep.length).toBeGreaterThan(400)

    const { output, plan } = await exportOnce({
      cuts,
      media: stress,
      name: 'stress.mp4',
      settings: { crossfade: true, crossfadeSec: 0.04 }
    })
    expect(plan.videoFrames).toBe(expectedFrames(keep, 25, 0.04))
    expect(await countFrames(ffmpeg!, output!)).toBe(plan.videoFrames)
    expectClose(await audioDuration(ffmpeg!, output!), plan.videoFrames / 25, 0.1)
  }, 120_000)

  it('uses the hardware encoder when the host provides one', async (context) => {
    if (process.platform !== 'darwin' || !(await hasEncoder(ffmpeg!, 'h264_videotoolbox'))) {
      context.skip()
      return
    }
    const cuts = [{ start: 4, end: 5 }]
    const { output } = await exportOnce({
      cuts,
      name: 'hardware.mp4',
      settings: { encoder: 'h264_videotoolbox' }
    })
    expect(await countFrames(ffmpeg!, output!)).toBe(expectedFrames(keepRanges(cuts, 10), 25))
    await expectContentAt(output!, 2.5, 2.5)
  })
})
