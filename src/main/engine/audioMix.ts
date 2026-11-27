import { open } from 'node:fs/promises'
import type { ExportPiece } from '@shared/videoExport'
import { readWavInfo } from './wav'

/**
 * Build the cut audio track in the main process.
 *
 * ffmpeg decodes the source audio once to 16-bit PCM; the kept pieces are
 * copied here, sample-exact, with a raised-cosine crossfade at each join.
 * Cutting the audio inside the ffmpeg filter graph needs one `atrim` branch
 * per cut, and every branch receives the whole decoded stream — a few hundred
 * cuts of a 90-minute recording cost minutes of pure copying. A sequential
 * copy costs seconds.
 *
 * Join semantics (the same as the video `xfade`): the previous piece's last
 * `f` frames and the next piece's first `f` frames occupy the same `f` output
 * frames, summed with complementary ramps. The output is shorter than the sum
 * of the pieces by one fade per join, which is exactly what the video plan
 * drops and the video graph dissolves over.
 *
 * The plan guarantees `fadeInSamples + fadeOutSamples <= length` for every
 * middle piece (a shorter fragment is merged into the cut), so a piece's head
 * and tail never cover the same samples and every sample is written once.
 */
export interface MixOptions {
  /** Decoded PCM WAV of the whole source (16-bit). */
  wav: string
  /** Destination WAV. */
  output: string
  pieces: ExportPiece[]
  signal?: AbortSignal
  /** Mixed frames the output will contain (from the export plan). */
  totalFrames: number
  onProgress?: (frames: number) => void
}

const BLOCK_FRAMES = 1 << 16

function buildHeader(channels: number, sampleRate: number, dataSize: number): Buffer {
  const header = Buffer.alloc(44)
  const blockAlign = channels * 2
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataSize, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * blockAlign, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataSize, 40)
  return header
}

/** Raised-cosine ramp: 0 at index 0, 1 at the end. Complements sum to 1. */
function ramp(index: number, length: number): number {
  if (length <= 0) return 1
  return 0.5 - 0.5 * Math.cos((Math.PI * index) / length)
}

export async function mixAudio(options: MixOptions): Promise<{ frames: number }> {
  const info = await readWavInfo(options.wav)
  const channels = info.channels
  const bytesPerFrame = channels * 2
  const blockBytes = BLOCK_FRAMES * bytesPerFrame
  const totalFrames = options.totalFrames

  const source = await open(options.wav, 'r')
  const target = await open(options.output, 'w')

  try {
    await target.write(buildHeader(channels, info.sampleRate, totalFrames * bytesPerFrame))

    const buffer = Buffer.allocUnsafe(blockBytes)
    let written = 0
    const write = async (frames: number): Promise<void> => {
      if (frames <= 0) return
      await target.write(buffer, 0, frames * bytesPerFrame)
      written += frames
      options.onProgress?.(written)
    }

    const readFrames = async (fromFrame: number, frames: number): Promise<void> => {
      await source.read(
        buffer,
        0,
        frames * bytesPerFrame,
        info.dataOffset + fromFrame * bytesPerFrame
      )
    }

    // Tail of the previous piece, waiting to be mixed into the next head.
    let pending = Buffer.alloc(0)
    let pendingFrames = 0

    for (let index = 0; index < options.pieces.length; index++) {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const piece = options.pieces[index]
      const start = Math.max(0, piece.audioStart)
      const end = Math.min(info.frames, piece.audioEnd)
      const length = end - start
      if (length <= 0) continue

      const fadeIn = Math.min(piece.fadeInSamples, length)
      const fadeOut = Math.min(piece.fadeOutSamples, length)
      const bodyEnd = length - fadeOut

      // Head: overlap with the pending tail. Both sides were clamped to the
      // same count by the export plan, so `overlap` is normally the whole
      // head; the shorter side wins if an edge of the source clipped one.
      const overlap = Math.min(pendingFrames, fadeIn)
      let position = 0

      if (overlap > 0) {
        await readFrames(start, overlap)
        const head = new Int16Array(buffer.buffer, buffer.byteOffset, overlap * channels)
        const tail = new Int16Array(pending.buffer, pending.byteOffset, pendingFrames * channels)
        for (let frame = 0; frame < overlap; frame++) {
          const gain = ramp(frame, overlap)
          for (let channel = 0; channel < channels; channel++) {
            const at = frame * channels + channel
            const mixed = tail[at] * (1 - gain) + head[at] * gain
            head[at] = Math.max(-32768, Math.min(32767, Math.round(mixed)))
          }
        }
        await write(overlap)
        position = overlap

        // A pending tail longer than the next head has nowhere to blend; it is
        // kept as part of the previous piece's material. This cannot happen
        // with the current plan, but writing it back is cheaper than losing it.
        if (pendingFrames > overlap) {
          const rest = pending.subarray(overlap * bytesPerFrame)
          await target.write(rest, 0, rest.length)
          written += pendingFrames - overlap
        }
      }
      pending = Buffer.alloc(0)
      pendingFrames = 0

      // Body: straight copy.
      while (position < bodyEnd) {
        const frames = Math.min(BLOCK_FRAMES, bodyEnd - position)
        await readFrames(start + position, frames)
        await write(frames)
        position += frames
      }

      // Tail: hold it back for the next join.
      if (fadeOut > 0) {
        pending = Buffer.allocUnsafe(fadeOut * bytesPerFrame)
        await source.read(
          pending,
          0,
          pending.length,
          info.dataOffset + (start + bodyEnd) * bytesPerFrame
        )
        pendingFrames = fadeOut
      }
    }

    // The last piece has no successor to fade into.
    if (pendingFrames > 0) {
      await target.write(pending, 0, pending.length)
      written += pendingFrames
    }

    return { frames: written }
  } finally {
    await source.close()
    await target.close()
  }
}
