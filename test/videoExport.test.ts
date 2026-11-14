import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIDEO_EXPORT_SETTINGS,
  normalizeVideoExportSettings
} from '../src/shared/settings'
import {
  buildReencodeArgs,
  buildVideoFilterGraph,
  exportDuration,
  parseFfmpegOutTime,
  videoKeepRanges,
  videoQualityLabel
} from '../src/shared/videoExport'
import type { VideoExportSettings } from '../src/shared/types'

function settings(overrides: Partial<VideoExportSettings> = {}): VideoExportSettings {
  return { ...DEFAULT_VIDEO_EXPORT_SETTINGS, ...overrides }
}

describe('video export settings', () => {
  it('normalizes missing and unknown values', () => {
    expect(normalizeVideoExportSettings(null)).toEqual(DEFAULT_VIDEO_EXPORT_SETTINGS)
    expect(
      normalizeVideoExportSettings({
        resolution: '4k',
        quality: 'tiny',
        encoder: 'av1'
      })
    ).toEqual({
      resolution: 'source',
      quality: 'balanced',
      encoder: 'h264'
    })
  })

  it('keeps every known encoder and preset', () => {
    for (const encoder of [
      'h264',
      'hevc',
      'h264_videotoolbox',
      'hevc_videotoolbox'
    ] as const) {
      expect(normalizeVideoExportSettings({ encoder }).encoder).toBe(encoder)
    }
    expect(normalizeVideoExportSettings({ resolution: '720' }).resolution).toBe('720')
    expect(normalizeVideoExportSettings({ quality: 'compact' }).quality).toBe('compact')
  })
})

describe('video filter graph', () => {
  it('trims and concatenates multiple kept ranges', () => {
    const graph = buildVideoFilterGraph(
      [
        { start: 0, end: 10 },
        { start: 20, end: 30 }
      ],
      'source'
    )
    expect(graph).toContain(
      '[0:v]trim=start=0.000000:end=10.000000,setpts=PTS-STARTPTS[v0]'
    )
    expect(graph).toContain(
      '[0:a]atrim=start=0.000000:end=10.000000,asetpts=PTS-STARTPTS[a0]'
    )
    expect(graph).toContain(
      '[0:v]trim=start=20.000000:end=30.000000,setpts=PTS-STARTPTS[v1]'
    )
    expect(graph).toContain('concat=n=2:v=1:a=1[v][a]')
    expect(graph).not.toContain('scale=')
  })

  it('scales after concat and keeps source ratio', () => {
    const graph = buildVideoFilterGraph([{ start: 1, end: 2 }], '720')
    expect(graph).toContain('[vsrc]scale=-2:720:flags=lanczos[v]')
    expect(graph).toContain('setpts=PTS-STARTPTS[vsrc]')
    expect(graph).not.toContain('concat')
    expect(graph).toContain('asetpts=PTS-STARTPTS[a]')
  })

  it('merges overlapping ranges and rejects an empty list', () => {
    const graph = buildVideoFilterGraph(
      [
        { start: 0, end: 5 },
        { start: 4, end: 8 }
      ],
      'source'
    )
    expect(graph).toContain('end=8.000000')
    expect(graph.match(/\[0:v\]trim=start/g)).toHaveLength(1)
    expect(() => buildVideoFilterGraph([], 'source')).toThrow()
  })
})

describe('ffmpeg arguments', () => {
  it('uses CRF and H.264 for the software encoder', () => {
    const args = buildReencodeArgs({
      input: '/in.mp4',
      output: '/out.mp4',
      filterScriptPath: '/filter.txt',
      settings: settings({ encoder: 'h264', quality: 'balanced' })
    })
    expect(args).toContain('libx264')
    expect(args).toContain('23')
    expect(args).toContain('aac')
    expect(args).toContain('+faststart')
    expect(args).not.toContain('-tag:v')
  })

  it('uses HEVC, hvc1 and the HEVC CRF ladder', () => {
    const args = buildReencodeArgs({
      input: '/in.mp4',
      output: '/out.mp4',
      filterScriptPath: '/filter.txt',
      settings: settings({ encoder: 'hevc', quality: 'high' })
    })
    expect(args).toContain('libx265')
    expect(args).toContain('22')
    expect(args).toContain('hvc1')
  })

  it('sends hardware presets to VideoToolbox as q:v', () => {
    const hardware = buildReencodeArgs({
      input: '/in.mp4',
      output: '/out.mp4',
      filterScriptPath: '/filter.txt',
      settings: settings({ encoder: 'h264_videotoolbox', quality: 'high' })
    })
    expect(hardware).toContain('h264_videotoolbox')
    expect(hardware).toContain('-q:v')
    expect(hardware).toContain('75')
    expect(hardware).not.toContain('-crf')
    expect(hardware).not.toContain('-preset')
    expect(videoQualityLabel('h264_videotoolbox', 'high')).toBe('q:v 75')
    expect(videoQualityLabel('h264', 'balanced')).toBe('CRF 23')

    const hevc = buildReencodeArgs({
      input: '/in.mp4',
      output: '/out.mov',
      filterScriptPath: '/filter.txt',
      settings: settings({ encoder: 'hevc_videotoolbox', quality: 'compact' })
    })
    expect(hevc).toContain('hevc_videotoolbox')
    expect(hevc).toContain('45')
    expect(hevc).toContain('hvc1')
    expect(hevc).not.toContain('-crf')
  })

  it('omits faststart for non-MOV containers', () => {
    const args = buildReencodeArgs({
      input: '/in.mp4',
      output: '/out.mkv',
      filterScriptPath: '/filter.txt',
      settings: settings({ encoder: 'hevc' })
    })
    expect(args).not.toContain('+faststart')
    expect(args).not.toContain('hvc1')
  })
})

describe('video export helpers', () => {
  it('derives the kept ranges from the cut list', () => {
    expect(videoKeepRanges([{ start: 2, end: 4 }], 10)).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 10 }
    ])
    expect(exportDuration([{ start: 0, end: 2 }, { start: 4, end: 10 }])).toBe(8)
  })

  it('parses ffmpeg progress lines', () => {
    expect(parseFfmpegOutTime('out_time_us=1234567')).toBeCloseTo(1.234567)
    expect(parseFfmpegOutTime('out_time_ms=2000000')).toBe(2)
    expect(parseFfmpegOutTime('out_time=00:01:02.500')).toBe(62.5)
    expect(parseFfmpegOutTime('progress=end')).toBeNull()
    expect(parseFfmpegOutTime('')).toBeNull()
  })
})
