import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildExportPlan, type ExportPiece } from '@shared/videoExport'
import { mixAudio } from '../src/main/engine/audioMix'
import { readWavInfo } from '../src/main/engine/wav'

const tempDirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'speech-review-mix-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function wavBytes(samples: Int16Array, channels: number, sampleRate: number): Buffer {
  const dataSize = samples.length * 2
  const blockAlign = channels * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * blockAlign, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataSize, 40)
  for (let index = 0; index < samples.length; index++) {
    buffer.writeInt16LE(samples[index], 44 + index * 2)
  }
  return buffer
}

async function fixture(
  samples: Int16Array,
  channels = 1,
  sampleRate = 1000
): Promise<{ source: string; output: string }> {
  const dir = await tempDir()
  const source = join(dir, 'source.wav')
  await writeFile(source, wavBytes(samples, channels, sampleRate))
  return { source, output: join(dir, 'mixed.wav') }
}

async function readSamples(path: string): Promise<Int16Array> {
  const info = await readWavInfo(path)
  const data = await readFile(path)
  const count = info.frames * info.channels
  const samples = new Int16Array(count)
  for (let index = 0; index < count; index++) {
    samples[index] = data.readInt16LE(info.dataOffset + index * 2)
  }
  return samples
}

function piece(
  audioStart: number,
  audioEnd: number,
  fadeInSamples = 0,
  fadeOutSamples = 0
): ExportPiece {
  return {
    startFrame: 0,
    endFrame: 0,
    dropFrames: 0,
    audioStart,
    audioEnd,
    fadeInSamples,
    fadeOutSamples
  }
}

describe('audio mixer', () => {
  it('copies the kept pieces exactly when there is no crossfade', async () => {
    const source = new Int16Array(1000)
    for (let index = 0; index < source.length; index++) {
      source[index] = index * 10 - 5000
    }
    const files = await fixture(source)
    const pieces = [piece(100, 200), piece(350, 500)]

    const result = await mixAudio({
      wav: files.source,
      output: files.output,
      pieces,
      totalFrames: 250
    })

    expect(result.frames).toBe(250)
    const mixed = await readSamples(files.output)
    expect(mixed.length).toBe(250)
    for (let index = 0; index < 100; index++) {
      expect(mixed[index]).toBe(source[100 + index])
    }
    for (let index = 0; index < 150; index++) {
      expect(mixed[100 + index]).toBe(source[350 + index])
    }
  })

  it('keeps a constant level through every join and matches the plan length', async () => {
    const sampleRate = 16000
    const fps = 25
    const keep = []
    for (let index = 0; index < 40; index++) {
      keep.push({ start: index * 2, end: index * 2 + 1.2 })
    }
    const plan = buildExportPlan(keep, fps, sampleRate, 0.1)

    // Spoken material inside the kept ranges, silence in the cut ranges: any
    // sample leaking from a cut, or a ramp that does not sum to one, shows up
    // as a value other than 12345 in the output.
    const source = new Int16Array(Math.ceil(keep[keep.length - 1].end * sampleRate))
    for (const current of plan.pieces) {
      source.fill(12345, current.audioStart, current.audioEnd)
    }

    const files = await fixture(source, 1, sampleRate)
    const result = await mixAudio({
      wav: files.source,
      output: files.output,
      pieces: plan.pieces,
      totalFrames: plan.audioSamples
    })

    expect(result.frames).toBe(plan.audioSamples)
    const mixed = await readSamples(files.output)
    expect(mixed.length).toBe(plan.audioSamples)
    expect((await readWavInfo(files.output)).frames).toBe(plan.audioSamples)

    let deviations = 0
    for (const value of mixed) {
      if (value !== 12345) deviations++
    }
    expect(deviations).toBe(0)
  })

  it('mixes the two channels independently', async () => {
    const frames = 1000
    const source = new Int16Array(frames * 2)
    for (let frame = 0; frame < frames; frame++) {
      source[frame * 2] = 10000
      source[frame * 2 + 1] = -10000
    }
    const files = await fixture(source, 2, 1000)
    const pieces = [piece(0, 100, 0, 10), piece(200, 300, 10, 0)]

    const result = await mixAudio({
      wav: files.source,
      output: files.output,
      pieces,
      totalFrames: 190
    })

    expect(result.frames).toBe(190)
    const mixed = await readSamples(files.output)
    expect(mixed.length).toBe(190 * 2)
    for (let frame = 0; frame < 190; frame++) {
      expect(mixed[frame * 2]).toBe(10000)
      expect(mixed[frame * 2 + 1]).toBe(-10000)
    }
  })

  it('stops on an aborted signal', async () => {
    const files = await fixture(new Int16Array(200))
    const controller = new AbortController()
    controller.abort()

    await expect(
      mixAudio({
        wav: files.source,
        output: files.output,
        pieces: [piece(0, 100)],
        signal: controller.signal,
        totalFrames: 100
      })
    ).rejects.toThrow(/abort/i)
  })

  it('reports the written frames through onProgress', async () => {
    const files = await fixture(new Int16Array(300))
    const seen: number[] = []

    const result = await mixAudio({
      wav: files.source,
      output: files.output,
      pieces: [piece(0, 100), piece(200, 250)],
      totalFrames: 150,
      onProgress: (frames) => seen.push(frames)
    })

    expect(result.frames).toBe(150)
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[seen.length - 1]).toBe(150)
  })

  it('keeps the extra tail when a fade-out is longer than the next fade-in', async () => {
    // The export plan never produces this, but the mixer must not lose
    // material if it ever does: a 40-sample tail facing a 10-sample head
    // writes the remaining 30 samples back.
    const files = await fixture(new Int16Array(1000))
    const result = await mixAudio({
      wav: files.source,
      output: files.output,
      pieces: [piece(0, 100, 0, 40), piece(200, 300, 10, 0)],
      totalFrames: 190
    })

    expect(result.frames).toBe(190)
    expect((await readSamples(files.output)).length).toBe(190)
  })

  it('blends no more head samples than the pending tail holds', async () => {
    // Mirror case: a short tail facing a long head. Only `pendingFrames` can
    // be blended; the rest of the head must be copied untouched.
    const source = new Int16Array(1000)
    source.fill(1111, 0, 100)
    source.fill(2222, 200, 300)
    const files = await fixture(source)

    const result = await mixAudio({
      wav: files.source,
      output: files.output,
      pieces: [piece(0, 100, 0, 10), piece(200, 300, 40, 0)],
      totalFrames: 190
    })

    expect(result.frames).toBe(190)
    const mixed = await readSamples(files.output)
    // Piece A contributes 90 body samples, then the 10-sample blend, then the
    // rest of B. Only `pendingFrames` can blend; the remainder of the head
    // must stay the next piece's own material.
    for (let index = 0; index < 90; index++) expect(mixed[index]).toBe(1111)
    expect(mixed[90]).toBe(1111)
    // The blend rises across exactly the ten held-back samples: the last one is
    // still mixed, the first sample after it belongs to the body.
    for (let index = 90; index < 99; index++) {
      expect(mixed[index + 1]).toBeGreaterThan(mixed[index])
    }
    expect(mixed[99]).toBeGreaterThan(1111)
    expect(mixed[99]).toBeLessThan(2222)
    for (let index = 100; index < 190; index++) expect(mixed[index]).toBe(2222)
  })
})
