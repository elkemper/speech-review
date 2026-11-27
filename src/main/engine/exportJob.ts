import { extname, resolve } from 'node:path'
import { normalizeVideoExportSettings } from '@shared/settings'
import type { CutRange, MediaStreamInfo, VideoExportSettings } from '@shared/types'
import {
  buildExportPlan,
  videoKeepRanges,
  type ExportPlan
} from '@shared/videoExport'

/** The probe result reduced to what the export decision needs. */
export type ExportMedia = MediaStreamInfo

/**
 * Everything that can make an export impossible or ill-defined. The main
 * process translates these at the IPC boundary so the algorithm stays free of
 * user-facing strings and the failure paths can be asserted in tests.
 */
export type ExportErrorCode =
  | 'noFragments'
  | 'noVideoTrack'
  | 'noAudioTrack'
  | 'fpsUnknown'
  | 'videoFormat'
  | 'overwriteSource'
  | 'decodeFailed'
  | 'renderFailed'
  | 'noOutput'
  | 'mediaFailed'

export class ExportError extends Error {
  constructor(
    readonly code: ExportErrorCode,
    readonly details?: string
  ) {
    super(code)
    this.name = 'ExportError'
  }
}

export interface ExportJob {
  videoPath: string
  outputPath: string
  /** `.part-` file ffmpeg writes; renamed onto `outputPath` on success. */
  temporaryPath: string
  plan: ExportPlan
  settings: VideoExportSettings
  /** Output seconds; with a crossfade this is the mixed length. */
  totalSec: number
}

export interface ExportJobInput {
  videoPath: string
  outputPath: string
  temporaryPath: string
  cuts: CutRange[]
  duration: number
  media: ExportMedia
  settings: VideoExportSettings
}

export type ExportJobResult =
  | { ok: true; job: ExportJob }
  | { ok: false; code: ExportErrorCode }

const OUTPUT_EXTENSIONS = ['.mp4', '.m4v', '.mov']

/** Checks that depend only on the source, so the dialog opens on a valid run. */
export function validateExportSource(
  keep: CutRange[],
  media: ExportMedia
): ExportErrorCode | null {
  if (keep.length === 0) return 'noFragments'
  if (!media.hasVideo) return 'noVideoTrack'
  if (!media.hasAudio) return 'noAudioTrack'
  if (!(media.fps > 0)) return 'fpsUnknown'
  return null
}

/**
 * Decide whether the export can run and build the plan both the video graph
 * and the audio mixer will follow. Pure apart from path comparison: no
 * Electron, no ffmpeg, no filesystem.
 */
export function resolveExportJob(input: ExportJobInput): ExportJobResult {
  const keep = videoKeepRanges(input.cuts, input.duration)
  const invalid = validateExportSource(keep, input.media)
  if (invalid) return { ok: false, code: invalid }

  if (resolve(input.outputPath) === resolve(input.videoPath)) {
    return { ok: false, code: 'overwriteSource' }
  }
  if (!OUTPUT_EXTENSIONS.includes(extname(input.outputPath).toLowerCase())) {
    return { ok: false, code: 'videoFormat' }
  }

  const settings = normalizeVideoExportSettings(input.settings)
  const sampleRate = input.media.sampleRate || 48000
  const plan = buildExportPlan(
    keep,
    input.media.fps,
    sampleRate,
    settings.crossfade ? settings.crossfadeSec : 0
  )
  if (plan.pieces.length === 0) return { ok: false, code: 'noFragments' }

  return {
    ok: true,
    job: {
      videoPath: input.videoPath,
      outputPath: input.outputPath,
      temporaryPath: input.temporaryPath,
      plan,
      settings,
      totalSec: plan.audioSamples / sampleRate
    }
  }
}
