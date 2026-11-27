/**
 * Independent model of what the exported file must contain.
 *
 * It answers one question for any output frame: which source frame is shown
 * there, and inside a crossfade, which two source frames are mixed. The model
 * is written from the cut list, the frame rate and the fade length only — it
 * deliberately does not import the export code, so a bug in `buildExportPlan`
 * or in the filter graph cannot hide behind the expectation.
 *
 * Rounding must match the export exactly: both sides round frame numbers with
 * `Math.round` and derive sample offsets from the rounded frames.
 */

export interface ContentCut {
  start: number
  end: number
}

export interface ContentOptions {
  cuts: ContentCut[]
  duration: number
  fps: number
  fadeSec?: number
  sampleRate?: number
}

export interface ContentPiece {
  /** First source frame of the kept range. */
  startFrame: number
  /** One past the last source frame of the kept range. */
  endFrame: number
  /** Output frame where this piece's first frame is shown. */
  outputStart: number
  /** Frames of the head that share positions with the previous piece. */
  headFrames: number
  /** Frames of the tail that share positions with the next piece. */
  tailFrames: number
  /** First source sample of the piece. */
  audioStart: number
  /** One past the last source sample of the piece. */
  audioEnd: number
  /** Output sample where this piece's first sample is heard. */
  audioOutputStart: number
  /** Samples of the head that share positions with the previous piece. */
  headSamples: number
  /** Samples of the tail that share positions with the next piece. */
  tailSamples: number
}

export interface ContentDissolve {
  /** Index of the incoming piece. */
  piece: number
  /** First blended output frame. */
  outputStart: number
  /** One past the last blended frame. */
  outputEnd: number
  /** First blended output sample. */
  audioStart: number
  /** One past the last blended sample. */
  audioEnd: number
}

export interface ContentMap {
  fps: number
  sampleRate: number
  fadeFrames: number
  pieces: ContentPiece[]
  dissolves: ContentDissolve[]
  /** Total output frames. */
  frames: number
  /** Total output samples. */
  samples: number
  /** Source frame shown at the output frame; a pair inside a dissolve. */
  at(outputFrame: number): ContentAt
  /** Source sample heard at the output sample; a pair inside a dissolve. */
  sampleAt(outputSample: number): ContentAt
  /** True when the output frame falls inside a dissolve. */
  inDissolve(outputFrame: number): boolean
}

export type ContentAt = number | { outgoing: number; incoming: number }

/** Kept ranges: the complement of the merged cut list. */
export function keptRanges(cuts: ContentCut[], duration: number): ContentCut[] {
  const sorted = [...cuts].sort((left, right) => left.start - right.start)
  const keep: ContentCut[] = []
  let cursor = 0
  for (const cut of sorted) {
    const start = Math.max(0, Math.min(duration, cut.start))
    const end = Math.max(0, Math.min(duration, cut.end))
    if (start > cursor) keep.push({ start: cursor, end: start })
    cursor = Math.max(cursor, end)
  }
  if (cursor < duration) keep.push({ start: cursor, end: duration })
  return keep.filter((range) => range.end > range.start)
}

/**
 * Build the full map. Everything is derived from the cut list; call `at` and
 * `sampleAt` for the expected content of a specific output position.
 */
export function buildContentMap(options: ContentOptions): ContentMap {
  const fps = options.fps
  const sampleRate = options.sampleRate ?? 48000
  const fadeFrames =
    options.fadeSec && options.fadeSec > 0 && fps > 0
      ? Math.max(0, Math.round(options.fadeSec * fps))
      : 0

  let pieces: ContentPiece[] = keptRanges(options.cuts, options.duration)
    .map((range) => ({
      startFrame: Math.max(0, Math.round(range.start * fps)),
      endFrame: Math.max(0, Math.round(range.end * fps))
    }))
    .map((range) => ({ ...range, endFrame: Math.max(range.startFrame, range.endFrame) }))
    .filter((range) => range.endFrame > range.startFrame)
    .map((range) => ({
      startFrame: range.startFrame,
      endFrame: range.endFrame,
      outputStart: 0,
      headFrames: 0,
      tailFrames: 0,
      audioStart: Math.round((range.startFrame / fps) * sampleRate),
      audioEnd: Math.round((range.endFrame / fps) * sampleRate),
      audioOutputStart: 0,
      headSamples: 0,
      tailSamples: 0
    }))

  // A middle piece shorter than two fades cannot hold one full dissolve on
  // each side, so the app treats it as part of the cut: the two long
  // neighbours share a single dissolve across the merged cut. The first and
  // last pieces have only one faded side and may be shorter.
  if (fadeFrames > 0 && pieces.length > 2) {
    const shortest = 2 * fadeFrames
    pieces = pieces.filter(
      (piece, index) =>
        index === 0 ||
        index === pieces.length - 1 ||
        piece.endFrame - piece.startFrame >= shortest
    )
  }

  const dissolves: ContentDissolve[] = []
  if (pieces.length === 0) {
    return emptyMap(fps, sampleRate, fadeFrames)
  }

  // A join can never spend more than the shorter piece, exactly like the plan.
  for (let index = 0; index < pieces.length - 1; index++) {
    const piece = pieces[index]
    const next = pieces[index + 1]
    const frames = Math.min(
      fadeFrames,
      piece.endFrame - piece.startFrame,
      next.endFrame - next.startFrame
    )
    const samples = Math.min(
      Math.round((frames / fps) * sampleRate),
      piece.audioEnd - piece.audioStart,
      next.audioEnd - next.audioStart
    )
    piece.tailFrames = frames
    piece.tailSamples = samples
    next.headFrames = frames
    next.headSamples = samples
  }

  // Rounding can leave the two sample overlaps of a middle piece one sample
  // longer than its audio (29.97 fps). The picture keeps its full fade; only
  // the outgoing audio overlap is trimmed, so the mix stays the planned length.
  for (let index = 1; index < pieces.length - 1; index++) {
    const piece = pieces[index]
    const available = piece.audioEnd - piece.audioStart
    const over = piece.headSamples + piece.tailSamples - available
    if (over > 0) {
      const tail = Math.max(0, piece.tailSamples - over)
      piece.tailSamples = tail
      pieces[index + 1].headSamples = tail
    }
  }

  // The accumulated length before a join is the full sum of the pieces seen so
  // far minus the overlaps of the earlier joins.
  let framesBefore = pieces[0].endFrame - pieces[0].startFrame
  let samplesBefore = pieces[0].audioEnd - pieces[0].audioStart
  pieces[0].outputStart = 0
  pieces[0].audioOutputStart = 0
  for (let index = 1; index < pieces.length; index++) {
    const piece = pieces[index]
    piece.outputStart = framesBefore - piece.headFrames
    piece.audioOutputStart = samplesBefore - piece.headSamples
    if (piece.headFrames > 0) {
      dissolves.push({
        piece: index,
        outputStart: piece.outputStart,
        outputEnd: piece.outputStart + piece.headFrames,
        audioStart: piece.audioOutputStart,
        audioEnd: piece.audioOutputStart + piece.headSamples
      })
    }
    framesBefore += piece.endFrame - piece.startFrame - pieces[index - 1].tailFrames
    samplesBefore += piece.audioEnd - piece.audioStart - pieces[index - 1].tailSamples
  }

  const at = (outputFrame: number): ContentAt => {
    const dissolve = dissolveAt(dissolves, outputFrame)
    const piece = dissolve ? pieces[dissolve.piece] : pieceAt(pieces, outputFrame)
    if (!piece) throw new Error(`output frame ${outputFrame} is outside the export`)
    if (dissolve) {
      const previous = pieces[dissolve.piece - 1]
      return {
        outgoing: previous.startFrame + (outputFrame - previous.outputStart),
        incoming: piece.startFrame + (outputFrame - dissolve.outputStart)
      }
    }
    return piece.startFrame + (outputFrame - piece.outputStart)
  }

  const sampleAt = (outputSample: number): ContentAt => {
    const dissolve = dissolveAtSample(dissolves, outputSample)
    const piece = dissolve ? pieces[dissolve.piece] : pieceAtSample(pieces, outputSample)
    if (!piece) throw new Error(`output sample ${outputSample} is outside the export`)
    if (dissolve) {
      const previous = pieces[dissolve.piece - 1]
      return {
        outgoing: previous.audioStart + (outputSample - previous.audioOutputStart),
        incoming: piece.audioStart + (outputSample - dissolve.audioStart)
      }
    }
    return piece.audioStart + (outputSample - piece.audioOutputStart)
  }

  return {
    fps,
    sampleRate,
    fadeFrames,
    pieces,
    dissolves,
    frames: framesBefore,
    samples: samplesBefore,
    at,
    sampleAt,
    inDissolve: (outputFrame) => dissolveAt(dissolves, outputFrame) !== undefined
  }
}

function dissolveAt(
  dissolves: ContentDissolve[],
  outputFrame: number
): ContentDissolve | undefined {
  return dissolves.find(
    (dissolve) => outputFrame >= dissolve.outputStart && outputFrame < dissolve.outputEnd
  )
}

function dissolveAtSample(
  dissolves: ContentDissolve[],
  outputSample: number
): ContentDissolve | undefined {
  return dissolves.find(
    (dissolve) => outputSample >= dissolve.audioStart && outputSample < dissolve.audioEnd
  )
}

function pieceAt(pieces: ContentPiece[], outputFrame: number): ContentPiece | undefined {
  return pieces.find((piece) => {
    const length = piece.endFrame - piece.startFrame
    return outputFrame >= piece.outputStart && outputFrame < piece.outputStart + length
  })
}

function pieceAtSample(pieces: ContentPiece[], outputSample: number): ContentPiece | undefined {
  return pieces.find((piece) => {
    const length = piece.audioEnd - piece.audioStart
    return outputSample >= piece.audioOutputStart && outputSample < piece.audioOutputStart + length
  })
}

function emptyMap(fps: number, sampleRate: number, fadeFrames: number): ContentMap {
  const fail = (): never => {
    throw new Error('the export is empty')
  }
  // Every output position lies in some piece, so these lookups never run.
  return {
    fps,
    sampleRate,
    fadeFrames,
    pieces: [],
    dissolves: [],
    frames: 0,
    samples: 0,
    at: fail,
    sampleAt: fail,
    inDissolve: () => false
  }
}
