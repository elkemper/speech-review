import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planChunks } from '../src/main/engine/chunks'
import { computePeaks, readWavInfo, sliceWav } from '../src/main/engine/wav'
import type { SilenceInterval } from '../src/main/engine/ffmpeg'

const tempDirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'speech-review-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function makeWav(seconds: number, sampleRate = 16000): Buffer {
  const frames = Math.round(seconds * sampleRate)
  const dataSize = frames * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < frames; i++) {
    const value = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5 * 32767)
    buffer.writeInt16LE(value, 44 + i * 2)
  }
  return buffer
}

function silence(start: number, end: number): SilenceInterval {
  return { start, end, duration: end - start }
}

describe('chunk planner', () => {
  it('keeps a short recording in one chunk', () => {
    const chunks = planChunks(41.3, [])
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ index: 0, start: 0, end: 41.3 })
  })

  it('cuts inside detected silence near the target length', () => {
    const chunks = planChunks(2500, [
      silence(601, 603),
      silence(1201, 1204),
      silence(1801, 1803)
    ])
    expect(chunks).toHaveLength(4)
    expect(chunks[0].end).toBeCloseTo(602, 3)
    expect(chunks[1].end).toBeCloseTo(1202.5, 3)
    expect(chunks[3].end).toBeCloseTo(2500, 3)
  })

  it('respects the maximum chunk size without silences', () => {
    const chunks = planChunks(2500, [])
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.duration).toBeLessThanOrEqual(900.0001)
      expect(chunk.duration).toBeGreaterThan(0)
    }
    expect(chunks[0].start).toBe(0)
    expect(chunks[chunks.length - 1].end).toBe(2500)
  })
})

describe('wav helpers', () => {
  it('reads PCM info and slices by seconds', async () => {
    const dir = await tempDir()
    const input = join(dir, 'input.wav')
    const output = join(dir, 'slice.wav')
    await writeFile(input, makeWav(2))

    const info = await readWavInfo(input)
    expect(info.sampleRate).toBe(16000)
    expect(info.channels).toBe(1)
    expect(info.bitsPerSample).toBe(16)
    expect(info.duration).toBeCloseTo(2, 5)

    const slice = await sliceWav(info, 0.5, 1.5, output)
    expect(slice.start).toBeCloseTo(0.5, 3)
    expect(slice.duration).toBeCloseTo(1, 3)

    const sliced = await readWavInfo(output)
    expect(sliced.duration).toBeCloseTo(1, 5)
  })

  it('computes a waveform envelope', async () => {
    const dir = await tempDir()
    const input = join(dir, 'input.wav')
    await writeFile(input, makeWav(2))

    const info = await readWavInfo(input)
    const peaks = await computePeaks(info, { peaksPerSecond: 20 })
    expect(peaks.peaksPerSecond).toBe(20)
    expect(peaks.min).toHaveLength(40)
    expect(peaks.max).toHaveLength(40)
    expect(Math.max(...peaks.max)).toBeGreaterThan(0.4)
    expect(Math.min(...peaks.min)).toBeLessThan(-0.4)
  })
})
