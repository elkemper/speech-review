import { open } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import type { Peaks } from '@shared/types'

export interface WavInfo {
  path: string
  format: number
  channels: number
  sampleRate: number
  bitsPerSample: number
  blockAlign: number
  dataOffset: number
  dataSize: number
  frames: number
  duration: number
}

function readAscii(buffer: Buffer, offset: number, length: number): string {
  return buffer.subarray(offset, offset + length).toString('ascii')
}

async function readAt(handle: FileHandle, length: number, position: number): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(length)
  let read = 0
  while (read < length) {
    const result = await handle.read(buffer, read, length - read, position + read)
    if (result.bytesRead === 0) break
    read += result.bytesRead
  }
  return read === length ? buffer : buffer.subarray(0, read)
}

export async function readWavInfo(path: string): Promise<WavInfo> {
  const handle = await open(path, 'r')
  try {
    const stat = await handle.stat()
    const headerSize = Math.min(stat.size, 1024 * 1024)
    const buffer = await readAt(handle, headerSize, 0)

    if (buffer.length < 44) throw new Error('WAV: файл слишком короткий')
    if (readAscii(buffer, 0, 4) !== 'RIFF' || readAscii(buffer, 8, 4) !== 'WAVE') {
      throw new Error('WAV: не найден RIFF/WAVE заголовок')
    }

    let format = 0
    let channels = 0
    let sampleRate = 0
    let bitsPerSample = 0
    let blockAlign = 0
    let dataOffset = -1
    let dataSize = 0

    let offset = 12
    while (offset + 8 <= buffer.length) {
      const id = readAscii(buffer, offset, 4)
      const declared = buffer.readUInt32LE(offset + 4)
      const body = offset + 8
      const available = Math.min(declared, buffer.length - body)

      if (id === 'fmt ' && available >= 16) {
        format = buffer.readUInt16LE(body)
        channels = buffer.readUInt16LE(body + 2)
        sampleRate = buffer.readUInt32LE(body + 4)
        blockAlign = buffer.readUInt16LE(body + 12)
        bitsPerSample = buffer.readUInt16LE(body + 14)

        if (format === 0xfffe && available >= 40) {
          format = buffer.readUInt16LE(body + 24)
        }
      } else if (id === 'data') {
        dataOffset = body
        const remaining = stat.size - body
        dataSize = declared === 0xffffffff ? remaining : Math.min(declared, remaining)
        break
      }

      offset = body + declared + (declared % 2)
      if (declared === 0xffffffff) break
    }

    if (!sampleRate || !channels || !bitsPerSample) {
      throw new Error('WAV: не найден fmt-чанк')
    }
    if (dataOffset < 0) throw new Error('WAV: не найден data-чанк')
    if (format !== 1 && format !== 3) {
      throw new Error(`WAV: неподдерживаемый формат ${format}`)
    }

    const bytesPerSample = Math.ceil(bitsPerSample / 8)
    const bytesPerFrame = blockAlign || channels * bytesPerSample
    const frames = Math.floor(dataSize / bytesPerFrame)

    return {
      path,
      format,
      channels,
      sampleRate,
      bitsPerSample,
      blockAlign: bytesPerFrame,
      dataOffset,
      dataSize: frames * bytesPerFrame,
      frames,
      duration: frames / sampleRate
    }
  } finally {
    await handle.close()
  }
}

function buildHeader(info: WavInfo, dataSize: number): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataSize, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(info.channels, 22)
  header.writeUInt32LE(info.sampleRate, 24)
  header.writeUInt32LE(info.sampleRate * info.blockAlign, 28)
  header.writeUInt16LE(info.blockAlign, 32)
  header.writeUInt16LE(info.bitsPerSample, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataSize, 40)
  return header
}

export async function sliceWav(
  info: WavInfo,
  startSec: number,
  endSec: number,
  outputPath: string,
  signal?: AbortSignal
): Promise<{ start: number; end: number; duration: number }> {
  const startFrame = Math.max(0, Math.min(info.frames, Math.floor(startSec * info.sampleRate)))
  const endFrame = Math.max(startFrame, Math.min(info.frames, Math.ceil(endSec * info.sampleRate)))
  const dataSize = (endFrame - startFrame) * info.blockAlign

  const source = await open(info.path, 'r')
  const target = await open(outputPath, 'w')
  try {
    await target.write(buildHeader(info, dataSize))

    const blockBytes = Math.max(info.blockAlign, Math.floor((4 * 1024 * 1024) / info.blockAlign) * info.blockAlign)
    const buffer = Buffer.allocUnsafe(blockBytes)
    let sourcePosition = info.dataOffset + startFrame * info.blockAlign
    let remaining = dataSize

    while (remaining > 0) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const length = Math.min(buffer.length, remaining)
      const { bytesRead } = await source.read(buffer, 0, length, sourcePosition)
      if (bytesRead === 0) break
      await target.write(buffer, 0, bytesRead)
      sourcePosition += bytesRead
      remaining -= bytesRead
    }
  } finally {
    await source.close()
    await target.close()
  }

  return {
    start: startFrame / info.sampleRate,
    end: endFrame / info.sampleRate,
    duration: (endFrame - startFrame) / info.sampleRate
  }
}

export interface PeaksOptions {
  peaksPerSecond?: number
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}

export async function computePeaks(info: WavInfo, options: PeaksOptions = {}): Promise<Peaks> {
  if (info.bitsPerSample !== 16) {
    throw new Error('Пики: поддерживается только 16-битный WAV')
  }

  const peaksPerSecond = options.peaksPerSecond ?? 50
  const bucketFrames = info.sampleRate / peaksPerSecond
  const bucketCount = Math.max(1, Math.ceil(info.frames / bucketFrames))
  const min = new Float32Array(bucketCount)
  const max = new Float32Array(bucketCount)
  min.fill(32767)
  max.fill(-32768)

  const handle = await open(info.path, 'r')
  try {
    const blockBytes =
      Math.max(info.blockAlign, Math.floor((8 * 1024 * 1024) / info.blockAlign) * info.blockAlign)
    const buffer = Buffer.allocUnsafe(blockBytes)
    let position = info.dataOffset
    let frame = 0
    let bucket = 0
    let bucketEnd = bucketFrames

    while (frame < info.frames) {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) break

      const sampleCount = Math.floor(bytesRead / 2)
      const view = new Int16Array(buffer.buffer, buffer.byteOffset, sampleCount)
      const framesInBlock = Math.floor(sampleCount / info.channels)

      for (let i = 0; i < framesInBlock; i++) {
        let low = 32767
        let high = -32768
        const base = i * info.channels
        for (let c = 0; c < info.channels; c++) {
          const value = view[base + c]
          if (value < low) low = value
          if (value > high) high = value
        }
        while (frame >= bucketEnd && bucket < bucketCount - 1) {
          bucket++
          bucketEnd += bucketFrames
        }
        if (low < min[bucket]) min[bucket] = low
        if (high > max[bucket]) max[bucket] = high
        frame++
      }

      position += bytesRead
      if (options.onProgress && frame < info.frames) {
        options.onProgress(frame / info.frames)
      }
    }

    const minOut: number[] = new Array(bucketCount)
    const maxOut: number[] = new Array(bucketCount)
    for (let i = 0; i < bucketCount; i++) {
      if (min[i] > max[i]) {
        minOut[i] = 0
        maxOut[i] = 0
      } else {
        minOut[i] = min[i] / 32768
        maxOut[i] = max[i] / 32768
      }
    }

    return {
      peaksPerSecond,
      duration: info.duration,
      min: minOut,
      max: maxOut
    }
  } finally {
    await handle.close()
  }
}
