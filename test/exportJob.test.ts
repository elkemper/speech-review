import { describe, expect, it } from 'vitest'
import { DEFAULT_VIDEO_EXPORT_SETTINGS } from '../src/shared/settings'
import {
  resolveExportJob,
  validateExportSource,
  type ExportJobInput,
  type ExportMedia
} from '../src/main/engine/exportJob'

function media(overrides: Partial<ExportMedia> = {}): ExportMedia {
  return { hasVideo: true, hasAudio: true, fps: 25, sampleRate: 48000, ...overrides }
}

function input(overrides: Partial<ExportJobInput> = {}): ExportJobInput {
  return {
    videoPath: '/media/source.mp4',
    outputPath: '/media/clean.mp4',
    temporaryPath: '/media/clean.part-1.mp4',
    cuts: [{ start: 2, end: 4 }],
    duration: 10,
    media: media(),
    settings: DEFAULT_VIDEO_EXPORT_SETTINGS,
    ...overrides
  }
}

describe('export source validation', () => {
  it('rejects a source with nothing left to keep', () => {
    expect(validateExportSource([], media())).toBe('noFragments')
  })

  it('rejects a source without video or audio and one with unknown fps', () => {
    const keep = [{ start: 0, end: 5 }]
    expect(validateExportSource(keep, media({ hasVideo: false }))).toBe('noVideoTrack')
    expect(validateExportSource(keep, media({ hasAudio: false }))).toBe('noAudioTrack')
    expect(validateExportSource(keep, media({ fps: 0 }))).toBe('fpsUnknown')
    expect(validateExportSource(keep, media())).toBeNull()
  })
})

describe('export job resolution', () => {
  it('builds the plan and total length from the cut list', () => {
    const result = resolveExportJob(input())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.job.plan.pieces).toHaveLength(2)
    expect(result.job.totalSec).toBeCloseTo(8, 6)
    expect(result.job.outputPath).toBe('/media/clean.mp4')
    expect(result.job.temporaryPath).toBe('/media/clean.part-1.mp4')
  })

  it('shortens the total by one crossfade per join', () => {
    const result = resolveExportJob(
      input({ settings: { ...DEFAULT_VIDEO_EXPORT_SETTINGS, crossfade: true, crossfadeSec: 0.2 } })
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 8 s of kept material minus one five-frame fade at 25 fps.
    expect(result.job.totalSec).toBeCloseTo(7.8, 6)
  })

  it('normalises unknown settings instead of trusting the caller', () => {
    const result = resolveExportJob(
      input({
        settings: {
          resolution: '4k',
          quality: 'tiny',
          encoder: 'av1',
          crossfade: 'yes',
          crossfadeSec: 99
        } as never
      })
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.job.settings).toEqual({
      ...DEFAULT_VIDEO_EXPORT_SETTINGS,
      crossfadeSec: 1
    })
  })

  it('falls back to 48 kHz when the probe reports no audio rate', () => {
    const result = resolveExportJob(input({ media: media({ sampleRate: 0 }) }))
    expect(result.ok && result.job.plan.sampleRate).toBe(48000)
  })

  it('refuses to overwrite the source and a foreign extension', () => {
    expect(resolveExportJob(input({ outputPath: '/media/source.mp4' })).ok).toBe(false)
    const overwrite = resolveExportJob(input({ outputPath: '/media/source.mp4' }))
    expect(overwrite.ok ? null : overwrite.code).toBe('overwriteSource')

    const format = resolveExportJob(input({ outputPath: '/media/clean.mkv' }))
    expect(format.ok ? null : format.code).toBe('videoFormat')
  })

  it('accepts every container the encoder can write', () => {
    for (const output of ['/media/clean.mp4', '/media/clean.mov', '/media/clean.M4V']) {
      expect(resolveExportJob(input({ outputPath: output })).ok).toBe(true)
    }
  })

  it('reports nothing to export when the cuts cover the file', () => {
    const result = resolveExportJob(
      input({ cuts: [{ start: 0, end: 10 }], duration: 10 })
    )
    expect(result.ok ? null : result.code).toBe('noFragments')
  })
})
