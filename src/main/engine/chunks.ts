import type { SilenceInterval } from './ffmpeg'

export interface ChunkPlan {
  index: number
  start: number
  end: number
  duration: number
}

export interface ChunkOptions {
  targetSec?: number
  minSec?: number
  maxSec?: number
}

const DEFAULTS: Required<ChunkOptions> = {
  targetSec: 600,
  minSec: 300,
  maxSec: 900
}

/**
 * Split the recording at silence midpoints near the target chunk length.
 * Cutting inside a detected silence avoids slicing words in half, which
 * matters because every chunk is transcribed independently.
 */
export function planChunks(
  duration: number,
  silences: SilenceInterval[],
  options: ChunkOptions = {}
): ChunkPlan[] {
  const { targetSec, minSec, maxSec } = { ...DEFAULTS, ...options }
  if (!Number.isFinite(duration) || duration <= 0) return []
  if (duration <= maxSec) {
    return [{ index: 0, start: 0, end: duration, duration }]
  }

  const cuts: number[] = []
  let start = 0
  let guard = 0

  while (duration - start > maxSec && guard++ < 1000) {
    const low = start + minSec
    const high = Math.min(duration, start + maxSec)
    const ideal = start + targetSec

    const candidates = silences
      .filter((interval) => {
        const middle = (interval.start + interval.end) / 2
        return middle >= low && middle <= high
      })
      .map((interval) => (interval.start + interval.end) / 2)

    let cut: number
    if (candidates.length > 0) {
      cut = candidates.reduce((best, value) =>
        Math.abs(value - ideal) < Math.abs(best - ideal) ? value : best
      )
    } else {
      cut = ideal
    }

    cut = Math.max(start + minSec, Math.min(start + maxSec, cut))
    if (cut >= duration - 1) break
    cuts.push(cut)
    start = cut
  }

  cuts.push(duration)

  const chunks: ChunkPlan[] = []
  let from = 0
  for (let i = 0; i < cuts.length; i++) {
    const to = cuts[i]
    if (to - from <= 0.05) continue
    chunks.push({ index: chunks.length, start: from, end: to, duration: to - from })
    from = to
  }

  // Avoid a tiny tail chunk: merge it into the previous one.
  if (chunks.length > 1) {
    const last = chunks[chunks.length - 1]
    if (last.duration < minSec / 2) {
      const previous = chunks[chunks.length - 2]
      previous.end = last.end
      previous.duration = previous.end - previous.start
      chunks.pop()
    }
  }

  return chunks
}
