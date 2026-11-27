import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_VIDEO_EXPORT_SETTINGS } from '@shared/settings'
import type { CutRange, VideoExportSettings } from '@shared/types'
import { resolveExportJob } from '../../src/main/engine/exportJob'
import { ffmpegPorts } from '../../src/main/engine/ffmpegPorts'
import { runExport } from '../../src/main/engine/exportPipeline'
import { probeMedia } from '../../src/main/engine/ffmpeg'
import { resolveFfmpeg } from './env'
import {
  bestLag,
  correlation,
  decodePcm,
  frameColors,
  makeSource,
  timeFromColor,
  type SourceSpec
} from './media'
import { buildContentMap, type ContentMap } from './contentMap'

const ffmpeg = resolveFfmpeg()

/**
 * These cuts put a dissolve near both edges of the import and leave the very
 * first and very last source frames uncut, so the test can check the two ends
 * against the original file rather than against its own arithmetic.
 */
const CUTS: CutRange[] = [
  { start: 2.1, end: 2.4 },
  { start: 3.0, end: 3.9 },
  { start: 4.5, end: 4.8 },
  { start: 8.1, end: 8.9 }
]

const SOURCE_SECONDS = 10
const FPS = 25
const FADE_SEC = 0.2

function channelTolerance(): number {
  // The export re-encodes with a lossy H.264 CRF, so the average colour of a
  // frame moves by a couple of units.
  return 10
}

describe.skipIf(!ffmpeg)('content map against a real export', () => {
  let base = ''
  let workRoot = ''
  let media: SourceSpec

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'speech-review-content-'))
    workRoot = join(base, 'work')
    await mkdir(workRoot)
    media = await makeSource(ffmpeg!, { dir: base, seconds: SOURCE_SECONDS })
  }, 120_000)

  afterAll(async () => {
    if (base) await rm(base, { recursive: true, force: true })
  })

  async function exportOnce(
    cuts: CutRange[],
    settings: Partial<VideoExportSettings>,
    name: string
  ): Promise<{ output: string; map: ContentMap }> {
    const probe = await probeMedia(ffmpeg!, media.path)
    const outputPath = join(base, name)
    const resolved = resolveExportJob({
      videoPath: media.path,
      outputPath,
      temporaryPath: `${outputPath}.part-test.mp4`,
      cuts,
      duration: probe.duration,
      media: {
        hasVideo: probe.hasVideo,
        hasAudio: probe.hasAudio,
        fps: probe.fps,
        sampleRate: probe.sampleRate
      },
      settings: { ...DEFAULT_VIDEO_EXPORT_SETTINGS, ...settings }
    })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) throw new Error(resolved.code)

    const output = await runExport({
      job: resolved.job,
      ports: ffmpegPorts(ffmpeg!, workRoot),
      signal: new AbortController().signal,
      onProgress: () => undefined
    })
    if (!output) throw new Error('the export was cancelled')

    const normalized = resolved.job.settings
    const map = buildContentMap({
      cuts,
      duration: probe.duration,
      fps: probe.fps,
      fadeSec: normalized.crossfade ? normalized.crossfadeSec : 0,
      sampleRate: probe.sampleRate
    })
    // The plan and the independent model must agree on the length first.
    expect(resolved.job.plan.videoFrames).toBe(map.frames)
    expect(resolved.job.plan.audioSamples).toBe(map.samples)
    return { output, map }
  }

  /**
   * Full trace: every output frame against the model, both ends against the
   * original frames, and the audio checked by waveform correlation at the
   * start, in the middle of every kept piece and at the very end.
   */
  it('shows the predicted content at every frame and keeps both ends', async () => {
    const { output, map } = await exportOnce(CUTS, { crossfade: true, crossfadeSec: FADE_SEC }, 'fade.mp4')

    const colors = await frameColors(ffmpeg!, output)
    const sourceColors = await frameColors(ffmpeg!, media.path)
    expect(colors.length).toBe(map.frames)

    // 1. Every frame outside a dissolve is exactly the source frame the map
    //    names; inside a dissolve it is a mixture of the two named frames.
    for (let frame = 0; frame < colors.length; frame++) {
      const expected = map.at(frame)
      if (typeof expected === 'number') {
        const measured = timeFromColor(colors[frame])
        expect(
          Math.abs(measured - expected / FPS),
          `output frame ${frame} should show source frame ${expected}`
        ).toBeLessThanOrEqual(0.06)
      } else {
        const outgoing = sourceColors[expected.outgoing]
        const incoming = sourceColors[expected.incoming]
        for (let channel = 0; channel < 3; channel++) {
          const low = Math.min(outgoing[channel], incoming[channel]) - channelTolerance()
          const high = Math.max(outgoing[channel], incoming[channel]) + channelTolerance()
          expect(
            colors[frame][channel],
            `output frame ${frame} channel ${channel} is outside the dissolve`
          ).toBeGreaterThanOrEqual(Math.max(0, low))
          expect(colors[frame][channel]).toBeLessThanOrEqual(Math.min(255, high))
        }
      }
    }

    // 2. Every dissolve really mixes: at least one frame sits strictly
    //    between the two source frames, which a hard cut can never do.
    for (const dissolve of map.dissolves) {
      let mixed = false
      for (let frame = dissolve.outputStart; frame < dissolve.outputEnd; frame++) {
        const expected = map.at(frame)
        if (typeof expected === 'number') continue
        const outgoing = sourceColors[expected.outgoing]
        const incoming = sourceColors[expected.incoming]
        if (colors[frame].some((value, channel) => {
          const low = Math.min(outgoing[channel], incoming[channel])
          const high = Math.max(outgoing[channel], incoming[channel])
          return value > low + 8 && value < high - 8
        })) {
          mixed = true
        }
      }
      expect(mixed, `dissolve at output frame ${dissolve.outputStart} is not a mixture`).toBe(true)
    }

    // 3. The ends are the original ends: first frame is source frame 0, last
    //    frame is the last source frame (the tail is not cut).
    const lastSourceFrame = Math.round(SOURCE_SECONDS * FPS) - 1
    expect(map.at(0)).toBe(0)
    expect(map.at(map.frames - 1)).toBe(lastSourceFrame)
    for (let channel = 0; channel < 3; channel++) {
      expect(
        Math.abs(colors[0][channel] - sourceColors[0][channel]),
        'the first frame must be the original first frame'
      ).toBeLessThanOrEqual(channelTolerance())
      expect(
        Math.abs(colors[colors.length - 1][channel] - sourceColors[lastSourceFrame][channel]),
        'the last frame must be the original last frame'
      ).toBeLessThanOrEqual(channelTolerance())
    }

    // 3b. Negative control: the neighbours are measurably different, so the
    //     end checks cannot pass by accident (a frozen frame, a duplicated
    //     edge, or a check that ignores which frame it got).
    const frameTime = (index: number): number => timeFromColor(colors[index])
    const expectedAt = (index: number): number => {
      const value = map.at(index)
      expect(typeof value).toBe('number')
      return typeof value === 'number' ? value / FPS : Number.NaN
    }
    expect(frameTime(1) - frameTime(0)).toBeGreaterThanOrEqual(0.02)
    expect(frameTime(colors.length - 1) - frameTime(colors.length - 2)).toBeGreaterThanOrEqual(0.02)
    expect(Math.abs(frameTime(1) - expectedAt(1))).toBeLessThanOrEqual(0.06)
    expect(
      Math.abs(frameTime(colors.length - 2) - expectedAt(colors.length - 2))
    ).toBeLessThanOrEqual(0.06)
    const distance = (left: [number, number, number], right: [number, number, number]): number =>
      left.reduce((total, value, channel) => total + Math.abs(value - right[channel]), 0)
    const exportedLast = colors[colors.length - 1]
    expect(distance(colors[0], sourceColors[0])).toBeLessThan(distance(colors[0], sourceColors[1]))
    expect(distance(exportedLast, sourceColors[lastSourceFrame])).toBeLessThan(
      distance(exportedLast, sourceColors[lastSourceFrame - 1])
    )

    // 4. Audio: the same waveform at the same source position, including the
    //    first and last 100 ms. A shift or a lost tail cannot correlate at 0.
    const exported = await decodePcm(ffmpeg!, output)
    const sourcePcm = await decodePcm(ffmpeg!, media.path)
    const window = 4800
    const windows = [0, 48000, 72000, 103000, 122000, 150000, 200000, 260000, 300000]
    for (const start of windows) {
      const expected = map.sampleAt(start)
      expect(typeof expected).toBe('number')
      if (typeof expected !== 'number') continue
      const lag = bestLag(exported, start, sourcePcm, expected, window)
      expect(
        Math.abs(lag),
        `output ${(start / 48000).toFixed(2)}s should be source ${(expected / 48000).toFixed(2)}s`
      ).toBeLessThanOrEqual(96)
    }

    // Last 100 ms of real audio: map.samples excludes the AAC padding the
    // decoder appends, so the window ends where the content ends.
    const endStart = map.samples - window
    const endExpected = map.sampleAt(endStart)
    expect(typeof endExpected).toBe('number')
    if (typeof endExpected === 'number') {
      expect(Math.abs(bestLag(exported, endStart, sourcePcm, endExpected, window))).toBeLessThanOrEqual(96)
    }
    expect(Math.abs(bestLag(exported, 0, sourcePcm, 0, window))).toBeLessThanOrEqual(48)

    // 5. The audio controls: the right moment correlates, the neighbouring
    //    moment does not. Without this the checks above prove only that some
    //    part of the chirp is there.
    if (typeof endExpected === 'number') {
      expect(correlation(exported, endStart, sourcePcm, endExpected, window)).toBeGreaterThanOrEqual(0.8)
      expect(
        correlation(exported, endStart, sourcePcm, endExpected - 2400, window)
      ).toBeLessThanOrEqual(0.5)
    }
    expect(correlation(exported, 0, sourcePcm, 0, window)).toBeGreaterThanOrEqual(0.8)
    expect(correlation(exported, 0, sourcePcm, 2400, window)).toBeLessThanOrEqual(0.5)
  }, 120_000)

  it('merges a kept fragment shorter than two fades into the cut', async () => {
    // 2.4–2.5 s is three frames at 25 fps; two five-frame fades need ten. The
    // fragment becomes part of the cut and the two long neighbours share one
    // full dissolve, so nothing after the join can drift.
    const { output, map } = await exportOnce(
      [
        { start: 2, end: 2.4 },
        { start: 2.5, end: 3 }
      ],
      { crossfade: true, crossfadeSec: FADE_SEC },
      'short-gap.mp4'
    )

    expect(map.pieces.map((piece) => [piece.startFrame, piece.endFrame])).toEqual([
      [0, 50],
      [75, 250]
    ])
    expect(map.frames).toBe(220)
    expect(map.dissolves.map((dissolve) => [dissolve.outputStart, dissolve.outputEnd])).toEqual([
      [45, 50]
    ])

    const colors = await frameColors(ffmpeg!, output)
    const sourceColors = await frameColors(ffmpeg!, media.path)
    expect(colors.length).toBe(map.frames)
    for (let frame = 0; frame < colors.length; frame++) {
      const expected = map.at(frame)
      if (typeof expected === 'number') {
        expect(Math.abs(timeFromColor(colors[frame]) - expected / FPS)).toBeLessThanOrEqual(0.06)
        continue
      }
      const outgoing = sourceColors[expected.outgoing]
      const incoming = sourceColors[expected.incoming]
      for (let channel = 0; channel < 3; channel++) {
        const low = Math.min(outgoing[channel], incoming[channel]) - channelTolerance()
        const high = Math.max(outgoing[channel], incoming[channel]) + channelTolerance()
        expect(colors[frame][channel]).toBeGreaterThanOrEqual(Math.max(0, low))
        expect(colors[frame][channel]).toBeLessThanOrEqual(Math.min(255, high))
      }
    }

    // The first frame after the dissolve is source 3.2 s, not the fragment.
    expect(map.at(50)).toBe(80)

    // The audio keeps the video's clock after the merge. Before the fix the
    // fragment was mixed twice and everything after the join lagged.
    const exported = await decodePcm(ffmpeg!, output)
    const sourcePcm = await decodePcm(ffmpeg!, media.path)
    const starts = [0, 48000, 72000, 100000, 150000, 250000, map.samples - 4800]
    for (const start of starts) {
      const expected = map.sampleAt(start)
      expect(typeof expected).toBe('number')
      if (typeof expected !== 'number') continue
      const lag = bestLag(exported, start, sourcePcm, expected, 4800)
      expect(
        Math.abs(lag),
        `output ${(start / 48000).toFixed(2)}s should be source ${(expected / 48000).toFixed(2)}s`
      ).toBeLessThanOrEqual(96)
    }
  }, 120_000)

  it('without a crossfade the same cut list also keeps both ends', async () => {
    const { output, map } = await exportOnce(CUTS, {}, 'plain.mp4')

    const colors = await frameColors(ffmpeg!, output)
    const sourceColors = await frameColors(ffmpeg!, media.path)
    expect(colors.length).toBe(map.frames)

    for (let frame = 0; frame < colors.length; frame++) {
      const expected = map.at(frame)
      expect(typeof expected).toBe('number')
      if (typeof expected !== 'number') continue
      expect(Math.abs(timeFromColor(colors[frame]) - expected / FPS)).toBeLessThanOrEqual(0.06)
    }
    const lastSourceFrame = Math.round(SOURCE_SECONDS * FPS) - 1
    for (let channel = 0; channel < 3; channel++) {
      expect(Math.abs(colors[0][channel] - sourceColors[0][channel])).toBeLessThanOrEqual(
        channelTolerance()
      )
      expect(
        Math.abs(colors[colors.length - 1][channel] - sourceColors[lastSourceFrame][channel])
      ).toBeLessThanOrEqual(channelTolerance())
    }

    // Negative control for the plain path as well.
    expect(timeFromColor(colors[1]) - timeFromColor(colors[0])).toBeGreaterThanOrEqual(0.02)
    expect(
      timeFromColor(colors[colors.length - 1]) - timeFromColor(colors[colors.length - 2])
    ).toBeGreaterThanOrEqual(0.02)

    const exported = await decodePcm(ffmpeg!, output)
    const sourcePcm = await decodePcm(ffmpeg!, media.path)
    expect(Math.abs(bestLag(exported, 0, sourcePcm, 0, 4800))).toBeLessThanOrEqual(48)
    expect(correlation(exported, 0, sourcePcm, 0, 4800)).toBeGreaterThanOrEqual(0.8)
    expect(correlation(exported, 0, sourcePcm, 2400, 4800)).toBeLessThanOrEqual(0.5)
    const endStart = map.samples - 4800
    const endExpected = map.sampleAt(endStart)
    expect(typeof endExpected).toBe('number')
    if (typeof endExpected === 'number') {
      expect(
        Math.abs(bestLag(exported, endStart, sourcePcm, endExpected, 4800))
      ).toBeLessThanOrEqual(96)
    }
  }, 120_000)
})
