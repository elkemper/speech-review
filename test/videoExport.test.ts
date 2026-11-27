import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIDEO_EXPORT_SETTINGS,
  normalizeVideoExportSettings
} from '../src/shared/settings'
import {
  buildExportPlan,
  buildReencodeArgs,
  buildVideoFilterGraph,
  crossfadeFrames,
  exportDuration,
  parseFfmpegOutTime,
  snapFrameRate,
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
      encoder: 'h264',
      crossfade: false,
      crossfadeSec: 0.1
    })
  })

  it('normalizes the crossfade flag and clamps its length', () => {
    expect(normalizeVideoExportSettings({ crossfade: 'yes' }).crossfade).toBe(false)
    expect(normalizeVideoExportSettings({ crossfade: true }).crossfade).toBe(true)
    expect(normalizeVideoExportSettings({ crossfadeSec: -1 }).crossfadeSec).toBe(0)
    expect(normalizeVideoExportSettings({ crossfadeSec: 99 }).crossfadeSec).toBe(1)
    expect(normalizeVideoExportSettings({ crossfadeSec: 'x' }).crossfadeSec).toBe(0.1)
    expect(normalizeVideoExportSettings({ crossfadeSec: 0.25 }).crossfadeSec).toBe(0.25)
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
  const plan = (ranges: Array<{ start: number; end: number }>, fadeSec = 0) =>
    buildExportPlan(ranges, 25, 48000, fadeSec)

  it('selects every kept piece in a single pass', () => {
    const graph = buildVideoFilterGraph(
      plan([
        { start: 0, end: 10 },
        { start: 20, end: 30 }
      ]),
      'source'
    )
    // 0–10 s at 25 fps is frames 0..249, 20–30 s is 500..749.
    // The source is normalised to a constant frame rate first, so frame
    // indices mean time even for a variable-frame-rate recording.
    expect(graph).toContain("[0:v]fps=25,select='between(n,0,249)+between(n,500,749)'")
    expect(graph).toContain('setpts=N/(25*TB)[v]')
    // One select pass, not one trim branch per piece.
    expect(graph).not.toContain('trim=')
    expect(graph).not.toContain('concat')
    expect(graph).not.toContain('scale=')
  })

  it('scales after select and keeps source ratio', () => {
    const graph = buildVideoFilterGraph(plan([{ start: 1, end: 2 }]), '720')
    expect(graph).toContain('[vsrc]scale=-2:720:flags=lanczos[v]')
    expect(graph).toContain('setpts=N/(25*TB)[vsrc]')
  })

  it('merges overlapping ranges and rejects an empty list', () => {
    const graph = buildVideoFilterGraph(
      plan([
        { start: 0, end: 5 },
        { start: 4, end: 8 }
      ]),
      'source'
    )
    expect(graph).toContain('between(n,0,199)')
    expect(graph.match(/select=/g)).toHaveLength(1)
    expect(() => buildVideoFilterGraph(plan([]), 'source')).toThrow()
  })

  it('dissolves the join with xfade instead of jumping to the next piece', () => {
    const withFade = buildExportPlan(
      [
        { start: 0, end: 10 },
        { start: 20, end: 30 }
      ],
      25,
      48000,
      0.2 // five frames
    )
    // 250 + 250 frames plain; one join gives up five frames.
    expect(withFade.videoFrames).toBe(495)
    const graph = buildVideoFilterGraph(withFade, 'source')

    // Each piece is a whole branch: the join, not the tail, consumes the
    // frames, so the video keeps the material the audio blends.
    expect(graph).toContain('[0:v]fps=25,settb=AVTB,split=2[s0][s1]')
    expect(graph).toContain('[s0]trim=start_frame=0:end_frame=250,setpts=PTS-STARTPTS,fps=25')
    expect(graph).toContain('[s1]trim=start_frame=500:end_frame=750,setpts=PTS-STARTPTS,fps=25')
    // Transition: five frames, starting at the end of the 9.6 s of the first
    // piece that survives (250 - 5 frames = 9.8 s).
    expect(graph).toContain(
      '[p0][p1]xfade=transition=fade:duration=0.200000:offset=9.800000[v]'
    )
    expect(graph).not.toContain('select=')
  })

  it('scales once, after the dissolve', () => {
    const withFade = buildExportPlan(
      [
        { start: 0, end: 10 },
        { start: 20, end: 30 }
      ],
      25,
      48000,
      0.2
    )
    const graph = buildVideoFilterGraph(withFade, '720')
    expect(graph).toContain('xfade=transition=fade:duration=0.200000:offset=9.800000[vsrc]')
    expect(graph.endsWith('[vsrc]scale=-2:720:flags=lanczos[v]')).toBe(true)
    expect(graph.match(/scale=/g)).toHaveLength(1)
  })

  it('keeps the single-pass select path when there is no join', () => {
    const one = buildExportPlan([{ start: 0, end: 10 }], 25, 48000, 0.4)
    expect(buildVideoFilterGraph(one, 'source')).toContain("select='between(n,0,249)'")
    expect(buildVideoFilterGraph(one, 'source')).not.toContain('xfade')
    // A fade that quantises to zero frames is no fade at all.
    expect(crossfadeFrames(0.01, 25).frames).toBe(0)
    const noFade = buildExportPlan(
      [
        { start: 0, end: 10 },
        { start: 20, end: 30 }
      ],
      25,
      48000,
      0.01
    )
    expect(buildVideoFilterGraph(noFade, 'source')).not.toContain('xfade')
  })

  it('falls back to concat for a join with no fade next to a faded one', () => {
    // Hand-built: the export plan never mixes the two, but the graph builder
    // must not emit `xfade:duration=0` if it ever does.
    const plan = buildExportPlan(
      [
        { start: 0, end: 10 },
        { start: 20, end: 30 },
        { start: 40, end: 50 }
      ],
      25,
      48000,
      0.2
    )
    plan.pieces[0].dropFrames = 0
    const graph = buildVideoFilterGraph(plan, 'source')
    expect(graph).toContain('concat=n=2:v=1:a=0[x1]')
    expect(graph).toContain('[x1][p2]xfade=transition=fade:duration=0.200000:offset=19.800000[v]')
  })
})

describe('export plan sync', () => {
  it('keeps video and audio the same length with a crossfade', () => {
    // The first piece is exactly one fade long and the two-frame fragment
    // between the cuts is merged away; both rules must keep the two tracks on
    // the same clock.
    const plan = buildExportPlan(
      [
        { start: 0, end: 0.12 },
        { start: 0.5, end: 0.6 },
        { start: 2, end: 5 }
      ],
      25,
      48000,
      0.1
    )
    expect(plan.audioSamples / 48000).toBeCloseTo(plan.videoFrames / 25, 5)
  })

  it('agrees on a long recording with many joins', () => {
    const keep: Array<{ start: number; end: number }> = []
    for (let second = 0; second < 5400; second += 10.8) {
      keep.push({ start: second, end: Math.min(5400, second + 10.4) })
    }
    const plan = buildExportPlan(keep, 25, 48000, 0.1)
    expect(plan.pieces).toHaveLength(500)
    expect(Math.abs(plan.videoFrames / 25 - plan.audioSamples / 48000)).toBeLessThan(0.001)
  })

  it('quantises the fade to whole frames and treats 0 as no fade', () => {
    expect(crossfadeFrames(0.1, 25)).toEqual({ frames: 3, seconds: 0.12 })
    expect(crossfadeFrames(0, 25)).toEqual({ frames: 0, seconds: 0 })
    expect(crossfadeFrames(0.1, 0)).toEqual({ frames: 0, seconds: 0 })
  })
})

describe('kept fragments shorter than two fades', () => {
  it('merges a fragment that cannot hold a fade on both sides', () => {
    // 2.4–2.5 s is three frames at 25 fps; two five-frame fades need ten.
    const plan = buildExportPlan(
      [
        { start: 0, end: 2 },
        { start: 2.4, end: 2.5 },
        { start: 3, end: 10 }
      ],
      25,
      48000,
      0.2
    )
    expect(plan.pieces.map((piece) => [piece.startFrame, piece.endFrame])).toEqual([
      [0, 50],
      [75, 250]
    ])
    expect(plan.pieces[0].dropFrames).toBe(5)
    expect(plan.videoFrames).toBe(220)
    expect(plan.audioSamples).toBe(422400)

    // One dissolve across the merged cut, not two entangled ones.
    const graph = buildVideoFilterGraph(plan, 'source')
    expect(graph).toContain('split=2')
    expect(graph).toContain('[s1]trim=start_frame=75:end_frame=250')
    expect(graph).toContain(
      '[p0][p1]xfade=transition=fade:duration=0.200000:offset=1.800000[v]'
    )
  })

  it('keeps a fragment exactly two fades long', () => {
    const plan = buildExportPlan(
      [
        { start: 0, end: 2 },
        { start: 2.4, end: 2.9 },
        { start: 3, end: 10 }
      ],
      25,
      48000,
      0.2
    )
    expect(plan.pieces.map((piece) => [piece.startFrame, piece.endFrame])).toEqual([
      [0, 50],
      [60, 73],
      [75, 250]
    ])
    expect(plan.videoFrames).toBe(228)
    expect(plan.audioSamples).toBe(437760)
    const middle = plan.pieces[1]
    expect(middle.fadeInSamples + middle.fadeOutSamples).toBeLessThanOrEqual(
      middle.audioEnd - middle.audioStart
    )
  })

  it('keeps a first or last piece shorter than a fade', () => {
    const plan = buildExportPlan(
      [
        { start: 0, end: 0.04 },
        { start: 0.5, end: 10 }
      ],
      25,
      48000,
      0.2
    )
    expect(plan.pieces.map((piece) => [piece.startFrame, piece.endFrame])).toEqual([
      [0, 1],
      [13, 250]
    ])
    expect(plan.videoFrames).toBe(237)
    expect(plan.audioSamples).toBe(455040)

    const tail = buildExportPlan(
      [
        { start: 0, end: 5 },
        { start: 5.5, end: 5.54 }
      ],
      25,
      48000,
      0.2
    )
    expect(tail.pieces.map((piece) => [piece.startFrame, piece.endFrame])).toEqual([
      [0, 125],
      [138, 139]
    ])
    expect(tail.pieces[1].dropFrames).toBe(0)
  })

  it('merges nothing without a crossfade', () => {
    const plan = buildExportPlan(
      [
        { start: 0, end: 2 },
        { start: 2.4, end: 2.5 },
        { start: 3, end: 10 }
      ],
      25,
      48000,
      0
    )
    expect(plan.pieces).toHaveLength(3)
  })

  it('never lets the sample fades overlap at NTSC rates', () => {
    // Six frames at 30000/1001 is 9609 samples, while two three-frame fades
    // round to 4805 + 4805: one sample too many. The picture keeps its fade;
    // only the shorter audio overlap is trimmed.
    const fps = 30000 / 1001
    const plan = buildExportPlan(
      [
        { start: 0, end: 3 / fps },
        { start: 6 / fps, end: 12 / fps },
        { start: 18 / fps, end: 5 }
      ],
      fps,
      48000,
      0.1
    )
    expect(plan.fadeFrames).toBe(3)
    expect(plan.pieces.map((piece) => [piece.startFrame, piece.endFrame])).toEqual([
      [0, 3],
      [6, 12],
      [18, 150]
    ])
    const middle = plan.pieces[1]
    expect(middle.audioEnd - middle.audioStart).toBe(9609)
    expect(middle.fadeInSamples).toBe(4805)
    expect(middle.fadeOutSamples).toBe(4804)
    expect(plan.pieces[2].fadeInSamples).toBe(4804)
    expect(plan.videoFrames).toBe(135)
    expect(plan.audioSamples).toBe(216216)
  })
})

describe('frame rate snapping', () => {
  it('restores exact NTSC rates from the rounded banner value', () => {
    expect(snapFrameRate(23.98)).toBe(24000 / 1001)
    expect(snapFrameRate(29.97)).toBe(30000 / 1001)
    expect(snapFrameRate(59.94)).toBe(60000 / 1001)
    expect(snapFrameRate(47.95)).toBe(48000 / 1001)
    expect(snapFrameRate(119.88)).toBe(120000 / 1001)
  })

  it('leaves integer and uncommon rates alone', () => {
    expect(snapFrameRate(25)).toBe(25)
    expect(snapFrameRate(30)).toBe(30)
    expect(snapFrameRate(24)).toBe(24)
    expect(snapFrameRate(60)).toBe(60)
    expect(snapFrameRate(12.5)).toBe(12.5)
    expect(snapFrameRate(0)).toBe(0)
  })
})

describe('ffmpeg arguments', () => {
  it('uses CRF and H.264 for the software encoder', () => {
    const args = buildReencodeArgs({
      input: '/in.mp4',
      output: '/out.mp4',
      filterScriptPath: '/filter.txt',
      audioInput: '/audio.wav',
      fps: 25,
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
      audioInput: '/audio.wav',
      fps: 25,
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
      audioInput: '/audio.wav',
      fps: 25,
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
      audioInput: '/audio.wav',
      fps: 25,
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
      audioInput: '/audio.wav',
      fps: 25,
      settings: settings({ encoder: 'hevc' })
    })
    expect(args).not.toContain('+faststart')
    expect(args).not.toContain('hvc1')
  })

  it('caps the filter thread pool only for the dissolve graph', () => {
    const base = {
      input: '/in.mp4',
      output: '/out.mp4',
      filterScriptPath: '/filter.txt',
      audioInput: '/audio.wav',
      fps: 25
    }
    // One `xfade` per join: at the default pool size a few hundred joins
    // exhaust the process thread limit and the graph never configures.
    const faded = buildReencodeArgs({ ...base, settings: settings({ crossfade: true }) })
    expect(faded).toContain('-filter_complex_threads')
    expect(faded[faded.indexOf('-filter_complex_threads') + 1]).toBe('2')

    // The single `select` graph has three filters; leave the pool alone.
    const plain = buildReencodeArgs({ ...base, settings: settings({ crossfade: false }) })
    expect(plain).not.toContain('-filter_complex_threads')
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
