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
 * Build a filter graph that trims every kept range, resets timestamps, joins
 * the segments and optionally scales the result. `-filter_complex_script` is
 * used by the caller so a long recording with hundreds of cuts does not hit
 * the command-line length limit.
 */
export function buildVideoFilterGraph(
  keep: CutRange[],
  resolution: VideoExportResolution
): string {
  const ranges = mergeRanges(keep).filter((range) => range.end - range.start > 0.000001)
  if (ranges.length === 0) {
    throw new Error('Нет фрагментов для экспорта')
  }

  const height = resolutionHeight(resolution)
  const parts: string[] = []

  if (ranges.length === 1) {
    const range = ranges[0]
    const videoLabel = height ? 'vsrc' : 'v'
    parts.push(
      `[0:v]trim=start=${seconds(range.start)}:end=${seconds(range.end)},` +
        `setpts=PTS-STARTPTS[${videoLabel}]`
    )
    parts.push(
      `[0:a]atrim=start=${seconds(range.start)}:end=${seconds(range.end)},` +
        `asetpts=PTS-STARTPTS[a]`
    )
    if (height) {
      parts.push(`[vsrc]scale=-2:${height}:flags=lanczos[v]`)
    }
    return parts.join(';')
  }

  for (let index = 0; index < ranges.length; index++) {
    const range = ranges[index]
    parts.push(
      `[0:v]trim=start=${seconds(range.start)}:end=${seconds(range.end)},` +
        `setpts=PTS-STARTPTS[v${index}]`
    )
    parts.push(
      `[0:a]atrim=start=${seconds(range.start)}:end=${seconds(range.end)},` +
        `asetpts=PTS-STARTPTS[a${index}]`
    )
  }

  const inputs: string[] = []
  for (let index = 0; index < ranges.length; index++) {
    inputs.push(`[v${index}][a${index}]`)
  }
  const videoLabel = height ? 'vsrc' : 'v'
  parts.push(
    `${inputs.join('')}concat=n=${ranges.length}:v=1:a=1[${videoLabel}][a]`
  )
  if (height) {
    parts.push(`[vsrc]scale=-2:${height}:flags=lanczos[v]`)
  }
  return parts.join(';')
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

export interface ReencodeArgsInput {
  input: string
  output: string
  filterScriptPath: string
  settings: VideoExportSettings
}

/**
 * Full ffmpeg command for a re-encoded clean video. The filter graph lives in
 * `filterScriptPath`; audio is always re-encoded with AAC for MP4/MOV output.
 */
export function buildReencodeArgs(input: ReencodeArgsInput): string[] {
  const args = [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i',
    input.input,
    '-filter_complex_script',
    input.filterScriptPath,
    '-map',
    '[v]',
    '-map',
    '[a]',
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
