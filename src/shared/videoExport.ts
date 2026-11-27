import { translate, type UiLanguage } from './i18n'
import { complementRanges, mergeRanges } from './cuts'
import type {
  CutRange,
  VideoExportEncoder,
  VideoExportQuality,
  VideoExportResolution,
  VideoExportSettings
} from './types'

/** Three quality presets for the software encoders. */
export const VIDEO_EXPORT_CRF: Record<
  'h264' | 'hevc',
  Record<VideoExportQuality, number>
> = {
  h264: { high: 18, balanced: 23, compact: 28 },
  hevc: { high: 22, balanced: 27, compact: 32 }
}

/**
 * VideoToolbox has no CRF. Its constant-quality mode is `-q:v` with a 1–100
 * scale, where a larger value means better quality. The three presets map to
 * the same perceptual ladder as the software CRF values above.
 */
export const VIDEO_EXPORT_TOOLBOX_QUALITY: Record<VideoExportQuality, number> = {
  high: 75,
  balanced: 60,
  compact: 45
}

export function isHardwareEncoder(encoder: VideoExportEncoder): boolean {
  return encoder === 'h264_videotoolbox' || encoder === 'hevc_videotoolbox'
}

export function videoCodec(encoder: VideoExportEncoder): 'h264' | 'hevc' {
  return encoder === 'hevc' || encoder === 'hevc_videotoolbox' ? 'hevc' : 'h264'
}

/** The numeric quality value sent to the selected encoder. */
export function videoQualityValue(
  encoder: VideoExportEncoder,
  quality: VideoExportQuality
): number {
  if (isHardwareEncoder(encoder)) return VIDEO_EXPORT_TOOLBOX_QUALITY[quality]
  return VIDEO_EXPORT_CRF[videoCodec(encoder)][quality]
}

/** Human-readable quality control for the dialog: CRF or VideoToolbox q:v. */
export function videoQualityLabel(
  encoder: VideoExportEncoder,
  quality: VideoExportQuality
): string {
  return isHardwareEncoder(encoder)
    ? `q:v ${videoQualityValue(encoder, quality)}`
    : `CRF ${videoQualityValue(encoder, quality)}`
}

export function resolutionHeight(resolution: VideoExportResolution): number | null {
  if (resolution === 'source') return null
  return Number(resolution)
}

/**
 * Standard NTSC-family rates. ffmpeg's `-i` banner rounds 23.976 to `23.98`
 * and 29.97 to `29.97`, and retiming the whole recording to the rounded value
 * makes the video drift against the audio: 1.7·10⁻⁴ of relative error is about
 * 0.9 s over 90 minutes. Snapping the parsed value back to the exact rational
 * removes that drift.
 */
const NTSC_RATES = [
  24000 / 1001,
  30000 / 1001,
  48000 / 1001,
  60000 / 1001,
  120000 / 1001
]

export function snapFrameRate(fps: number): number {
  if (!(fps > 0)) return fps
  for (const rate of NTSC_RATES) {
    if (Math.abs(fps - rate) < 0.01) return rate
  }
  return fps
}

/**
 * Crossfade length in whole frames. Both tracks must give up exactly the same
 * amount at a join, and the picture can only work in whole frames, so the
 * audio uses the quantised value too; otherwise the two totals drift apart by
 * up to one frame per join (10 s over 500 cuts).
 */
export function crossfadeFrames(
  fadeSec: number,
  fps: number
): { frames: number; seconds: number } {
  if (!(fps > 0) || !(fadeSec > 0)) return { frames: 0, seconds: 0 }
  const frames = Math.max(0, Math.round(fadeSec * fps))
  return { frames, seconds: frames / fps }
}

/** Total exported duration for a plain cut (no crossfade). */
export function videoExportDuration(keep: CutRange[]): number {
  return exportDuration(mergeRanges(keep))
}

export interface ExportPiece {
  /** First kept video frame (source time, frame index). */
  startFrame: number
  /** One past the last kept video frame. */
  endFrame: number
  /**
   * Frames of this piece's tail that share output positions with the next
   * piece's head. The video blends the two over this many frames (`xfade`) and
   * the audio mixes them over the same samples, so neither track runs ahead.
   */
  dropFrames: number
  /** Sample offset in the source audio. */
  audioStart: number
  audioEnd: number
  /** Samples blended with the previous piece (0 for the first). */
  fadeInSamples: number
  /** Samples blended with the next piece (0 for the last). */
  fadeOutSamples: number
}

export interface ExportPlan {
  pieces: ExportPiece[]
  fps: number
  sampleRate: number
  /** Crossfade length as applied, quantised to whole frames. */
  fadeFrames: number
  /** Video frames and audio samples of the finished file. */
  videoFrames: number
  audioSamples: number
}

/**
 * The single source of truth for one export. The video filter and the audio
 * mixer must both read this plan: if either side computes its own fades, a
 * piece shorter than the fade makes the two lengths disagree and the track
 * drifts out of sync.
 *
 * Sync rule: piece `i`'s last `dropFrames` frames and the next piece's first
 * `dropFrames` frames occupy the same output positions — the video dissolves
 * between them and the audio mixes them with complementary ramps. Both tracks
 * therefore lose exactly one fade per join, for any number of cuts.
 *
 * A kept fragment shorter than two fades cannot hold a fade on both sides: the
 * fade-in would overlap the fade-out inside it, `xfade` would blend three
 * sources at once, and the audio mixer would read the fragment twice — the
 * mixed track would be longer than this plan and every later sample would lag
 * behind the picture. Such a fragment is treated as part of the cut: the two
 * long neighbours share one full fade across the merged cut. First and last
 * pieces have only one faded side, so they may be shorter.
 */
export function buildExportPlan(
  keep: CutRange[],
  fps: number,
  sampleRate: number,
  fadeSec: number
): ExportPlan {
  const ranges = mergeRanges(keep)
  const fade = crossfadeFrames(fadeSec, fps)
  let pieces: ExportPiece[] = []

  for (let index = 0; index < ranges.length; index++) {
    const range = ranges[index]
    const startFrame = Math.max(0, Math.round(range.start * fps))
    const endFrame = Math.max(startFrame, Math.round(range.end * fps))
    if (endFrame <= startFrame) continue
    pieces.push({
      startFrame,
      endFrame,
      dropFrames: 0,
      audioStart: Math.round((startFrame / fps) * sampleRate),
      audioEnd: Math.round((endFrame / fps) * sampleRate),
      fadeInSamples: 0,
      fadeOutSamples: 0
    })
  }

  // A fragment that cannot carry one fade on each side is cut away instead of
  // being shown in two overlapping dissolves. The surviving neighbours become
  // adjacent, so the joins are recomputed below.
  if (fade.frames > 0 && pieces.length > 2) {
    const shortest = 2 * fade.frames
    pieces = pieces.filter(
      (piece, index) =>
        index === 0 ||
        index === pieces.length - 1 ||
        piece.endFrame - piece.startFrame >= shortest
    )
  }

  // A join may take no more than the shorter of the two pieces, so a piece
  // shorter than the fade still contributes a whole, positive length.
  for (let index = 0; index < pieces.length - 1; index++) {
    const piece = pieces[index]
    const next = pieces[index + 1]
    const frames = Math.min(
      fade.frames,
      piece.endFrame - piece.startFrame,
      next.endFrame - next.startFrame
    )
    const samples = Math.min(
      Math.round((frames / fps) * sampleRate),
      piece.audioEnd - piece.audioStart,
      next.audioEnd - next.audioStart
    )
    piece.dropFrames = frames
    piece.fadeOutSamples = samples
    next.fadeInSamples = samples
  }

  // Rounding can still make the two sample overlaps of a middle piece one
  // sample longer than its audio (29.97 fps: 4805 + 4805 against 9609). The
  // picture keeps its full fade; only the outgoing audio overlap is trimmed,
  // so the mixer writes exactly the length this plan promises.
  for (let index = 1; index < pieces.length - 1; index++) {
    const piece = pieces[index]
    const available = piece.audioEnd - piece.audioStart
    const over = piece.fadeInSamples + piece.fadeOutSamples - available
    if (over > 0) {
      const reduced = Math.max(0, piece.fadeOutSamples - over)
      piece.fadeOutSamples = reduced
      pieces[index + 1].fadeInSamples = reduced
    }
  }

  const videoFrames = pieces.reduce(
    (total, piece) => total + (piece.endFrame - piece.startFrame - piece.dropFrames),
    0
  )
  // Each piece is written in full; a join overlaps `fadeInSamples` of the next
  // piece with the previous tail, so the mix is shorter by that much per join.
  const audioSamples = pieces.reduce(
    (total, piece, index) =>
      total + (piece.audioEnd - piece.audioStart) - (index > 0 ? piece.fadeInSamples : 0),
    0
  )

  return {
    pieces,
    fps,
    sampleRate,
    fadeFrames: fade.frames,
    videoFrames,
    audioSamples
  }
}

/** Ranges that stay in the exported video, in playback order. */
export function videoKeepRanges(cuts: CutRange[], duration: number): CutRange[] {
  return complementRanges(cuts, duration)
}

export function exportDuration(keep: CutRange[]): number {
  return keep.reduce((total, range) => total + Math.max(0, range.end - range.start), 0)
}

function seconds(value: number): string {
  return Math.max(0, value).toFixed(6)
}

/**
 * Build the video filter for a plan.
 *
 * Without a crossfade the graph is one `select` pass over the source. Each
 * `trim` branch in a graph receives every decoded frame of the source, so a
 * 90-minute recording with 500 cuts spent minutes copying frames into 500
 * branches; `select` walks the source once and its cost is flat in the number
 * of pieces.
 *
 * With a crossfade the pieces have to overlap, and only a real dissolve keeps
 * the picture with the sound: the audio mixes the previous tail with the next
 * head, so the video must blend the same two frames at the same output
 * position. Each piece becomes its own branch and `xfade` joins them; the
 * chain costs one extra pass over the material per join on top of the single
 * decode (measured at 720p, two filter threads: 0.02–0.06 s per join for a
 * 4-minute source, roughly 5–10 minutes extra on a 90-minute 1080p export
 * with 500 joins), and the piece count stays linear.
 */
export function buildVideoFilterGraph(
  plan: ExportPlan,
  resolution: VideoExportResolution,
  lang: UiLanguage = 'ru'
): string {
  if (plan.pieces.length === 0) {
    throw new Error(translate(lang, 'error.videoNoFragments'))
  }

  const height = resolutionHeight(resolution)
  const finalLabel = height ? 'vsrc' : 'v'
  const parts: string[] = []

  const fades = plan.pieces.some((piece) => piece.dropFrames > 0)
  if (fades && plan.pieces.length > 1) {
    buildCrossfadeGraph(plan, finalLabel, parts)
  } else {
    parts.push(buildSelectGraph(plan, finalLabel))
  }
  if (height) {
    parts.push(`[vsrc]scale=-2:${height}:flags=lanczos[v]`)
  }
  return parts.join(';')
}

/** One `select` pass; used when no join needs a dissolve. */
function buildSelectGraph(plan: ExportPlan, finalLabel: string): string {
  // Frame indices, not timestamps: `between(n,…)` rounds the same way the
  // audio slicing does, so both totals stay equal at any number of joins.
  const expression = plan.pieces
    .map((piece) => `between(n,${piece.startFrame},${piece.endFrame - 1 - piece.dropFrames})`)
    .join('+')

  // `fps` first: it maps the source onto a constant-rate grid using the real
  // timestamps. Without it a variable-frame-rate source is cut by frame index
  // as if every frame lasted 1/fps seconds, and the video drifts away from the
  // audio piece by piece.
  return `[0:v]fps=${plan.fps},select='${expression}',setpts=N/(${plan.fps}*TB)[${finalLabel}]`
}

/**
 * One branch per piece, joined by `xfade`. The piece keeps all of its frames:
 * the join consumes `dropFrames` from the end of the accumulated output and the
 * same number from the start of the next piece, which is exactly the overlap
 * the audio mixer performs.
 */
function buildCrossfadeGraph(plan: ExportPlan, finalLabel: string, parts: string[]): void {
  const pieces = plan.pieces
  const branches = pieces.map((_, index) => `[s${index}]`).join('')
  parts.push(`[0:v]fps=${plan.fps},settb=AVTB,split=${pieces.length}${branches}`)

  // `start_frame`/`end_frame` count frames after the `fps` normalisation, so a
  // piece begins at the same frame index the plan and the audio use.
  pieces.forEach((piece, index) => {
    parts.push(
      `[s${index}]trim=start_frame=${piece.startFrame}:end_frame=${piece.endFrame},` +
        `setpts=PTS-STARTPTS,fps=${plan.fps},settb=AVTB[p${index}]`
    )
  })

  let previous = 'p0'
  let length = pieces[0].endFrame - pieces[0].startFrame
  for (let index = 1; index < pieces.length; index++) {
    const fade = pieces[index - 1].dropFrames
    const pieceFrames = pieces[index].endFrame - pieces[index].startFrame
    const label = index === pieces.length - 1 ? finalLabel : `x${index}`
    if (fade > 0) {
      // `offset` is where the transition starts on the accumulated timeline.
      parts.push(
        `[${previous}][p${index}]xfade=transition=fade:` +
          `duration=${seconds(fade / plan.fps)}:` +
          `offset=${seconds((length - fade) / plan.fps)}[${label}]`
      )
      length += pieceFrames - fade
    } else {
      // Defensive: the plan never produces a zero-length join next to a real
      // one, but a hand-built plan could.
      parts.push(`[${previous}][p${index}]concat=n=2:v=1:a=0[${label}]`)
      length += pieceFrames
    }
    previous = label
  }
}

function videoEncoderArgs(settings: VideoExportSettings, output: string): string[] {
  const codec = videoCodec(settings.encoder)
  const hardware = isHardwareEncoder(settings.encoder)
  const mp4Tag = isMovContainer(output)

  if (!hardware) {
    const args = [
      '-c:v',
      codec === 'h264' ? 'libx264' : 'libx265',
      '-preset',
      'medium',
      '-crf',
      String(videoQualityValue(settings.encoder, settings.quality)),
      '-pix_fmt',
      'yuv420p'
    ]
    if (codec === 'hevc' && mp4Tag) args.push('-tag:v', 'hvc1')
    return args
  }

  const args = [
    '-c:v',
    codec === 'h264' ? 'h264_videotoolbox' : 'hevc_videotoolbox',
    '-q:v',
    String(videoQualityValue(settings.encoder, settings.quality)),
    '-pix_fmt',
    'yuv420p'
  ]
  if (codec === 'hevc' && mp4Tag) args.push('-tag:v', 'hvc1')
  return args
}

/**
 * ffmpeg gives every filter instance a slice of the graph thread pool. The
 * dissolve graph has one `xfade` per join, and a few hundred joins at the
 * default pool size exhaust the process thread limit: the graph fails to
 * configure with `Resource temporarily unavailable` before a single frame is
 * written (reproduced at 350 joins on a 6-thread host). Two threads keep a
 * 500-join export running; the filter cost stays under the encoder's.
 */
const CROSSFADE_FILTER_THREADS = 2

export interface ReencodeArgsInput {
  input: string
  /** Audio is cut here, already mixed in Node, so ffmpeg only encodes it. */
  audioInput: string
  output: string
  filterScriptPath: string
  settings: VideoExportSettings
  fps: number
}

/**
 * Full ffmpeg command for a re-encoded clean video. The video graph lives in
 * `filterScriptPath`; the audio comes from the pre-cut WAV as a second input,
 * so a hundred cuts never turn into a hundred `atrim` branches.
 */
export function buildReencodeArgs(input: ReencodeArgsInput): string[] {
  const args = [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i',
    input.input,
    '-i',
    input.audioInput,
    '-filter_complex_script',
    input.filterScriptPath,
    ...(input.settings.crossfade
      ? ['-filter_complex_threads', String(CROSSFADE_FILTER_THREADS)]
      : []),
    '-map',
    '[v]',
    '-map',
    '1:a:0',
    '-fps_mode',
    'cfr',
    '-r',
    String(input.fps),
    ...videoEncoderArgs(input.settings, input.output),
    '-c:a',
    'aac',
    '-b:a',
    '192k'
  ]
  if (isMovContainer(input.output)) args.push('-movflags', '+faststart')
  args.push(
    '-max_muxing_queue_size',
    '1024',
    '-progress',
    'pipe:1',
    '-nostats',
    '-loglevel',
    'error',
    input.output
  )
  return args
}

function isMovContainer(path: string): boolean {
  const lower = path.toLowerCase()
  return lower.endsWith('.mp4') || lower.endsWith('.m4v') || lower.endsWith('.mov')
}

/** Parses ffmpeg's `-progress pipe:1` output and returns seconds. */
export function parseFfmpegOutTime(line: string): number | null {
  const trimmed = line.trim()
  const micros = /^out_time_(?:us|ms)=(\d+)$/.exec(trimmed)
  if (micros) return Number(micros[1]) / 1_000_000
  const timecode = /^out_time=(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(trimmed)
  if (timecode) {
    return Number(timecode[1]) * 3600 + Number(timecode[2]) * 60 + Number(timecode[3])
  }
  return null
}
