import { describe, expect, it } from 'vitest'
import { buildContentMap, keptRanges } from './integration/contentMap'

/**
 * The map is the yardstick the real exports are measured against, so it must
 * be right on its own. Every number below is hand-computed from the cut list,
 * the frame rate and the fade length.
 */
describe('content map', () => {
  it('keeps the source in place when nothing is cut', () => {
    const map = buildContentMap({ cuts: [], duration: 10, fps: 25 })
    expect(map.frames).toBe(250)
    expect(map.samples).toBe(480000)
    expect(map.fadeFrames).toBe(0)
    expect(map.at(0)).toBe(0)
    expect(map.at(249)).toBe(249)
    expect(map.sampleAt(0)).toBe(0)
    expect(map.sampleAt(479999)).toBe(479999)
    expect(map.inDissolve(0)).toBe(false)
  })

  it('maps the crossfade scenario frame by frame', () => {
    const map = buildContentMap({
      cuts: [
        { start: 2.1, end: 2.4 },
        { start: 3.0, end: 3.9 },
        { start: 4.5, end: 4.8 },
        { start: 8.1, end: 8.9 }
      ],
      duration: 10,
      fps: 25,
      fadeSec: 0.2
    })

    // Kept ranges become whole frames: 0–53, 60–75, 98–113, 120–203, 223–250.
    expect(map.pieces.map((piece) => [piece.startFrame, piece.endFrame])).toEqual([
      [0, 53],
      [60, 75],
      [98, 113],
      [120, 203],
      [223, 250]
    ])
    expect(map.frames).toBe(173)
    expect(map.samples).toBe(332160)

    // Four five-frame dissolves, one per join.
    expect(map.dissolves.map((dissolve) => [dissolve.outputStart, dissolve.outputEnd])).toEqual([
      [48, 53],
      [58, 63],
      [68, 73],
      [146, 151]
    ])

    // First frame is the source's first frame; the last is its last frame.
    expect(map.at(0)).toBe(0)
    expect(map.at(172)).toBe(249)
    expect(map.sampleAt(0)).toBe(0)
    expect(map.sampleAt(332159)).toBe(479999)

    // Before the first fade: the source in order.
    expect(map.at(47)).toBe(47)
    // The fade mixes the outgoing tail with the incoming head.
    expect(map.at(48)).toEqual({ outgoing: 48, incoming: 60 })
    expect(map.at(52)).toEqual({ outgoing: 52, incoming: 64 })
    // The first frame after the fade is the incoming piece's sixth frame:
    // source 65 = 2.6 s, as expected after cutting 2.1–2.4 with a 0.2 s fade.
    expect(map.at(53)).toBe(65)
    expect(map.inDissolve(53)).toBe(false)

    // Last join: piece 3's tail (source 198–202) against piece 4's head.
    expect(map.at(146)).toEqual({ outgoing: 198, incoming: 223 })
    expect(map.at(150)).toEqual({ outgoing: 202, incoming: 227 })
    expect(map.at(151)).toBe(228)
  })

  it('is a plain concatenation without a fade', () => {
    const map = buildContentMap({
      cuts: [{ start: 2.1, end: 2.4 }],
      duration: 10,
      fps: 25
    })
    // 53 frames before the cut + 190 after it, with no overlap at all.
    expect(map.frames).toBe(243)
    expect(map.samples).toBe(466560)
    expect(map.dissolves).toEqual([])
    expect(map.at(52)).toBe(52)
    expect(map.at(53)).toBe(60)
    expect(map.at(242)).toBe(249)
    expect(map.sampleAt(466559)).toBe(479999)
  })

  it('shrinks a fade that is longer than the shorter piece', () => {
    const map = buildContentMap({
      cuts: [
        { start: 2, end: 3 },
        { start: 3.2, end: 10 }
      ],
      duration: 10,
      fps: 25,
      fadeSec: 0.2
    })
    // 50 frames of the first piece and 5 of the second, joined by a five-frame
    // dissolve: 50 + 5 - 5 = 50 frames.
    expect(map.pieces.map((piece) => [piece.startFrame, piece.endFrame])).toEqual([
      [0, 50],
      [75, 80]
    ])
    expect(map.frames).toBe(50)
    expect(map.samples).toBe(96000)
    expect(map.dissolves.map((dissolve) => [dissolve.outputStart, dissolve.outputEnd])).toEqual([
      [45, 50]
    ])
    expect(map.at(44)).toBe(44)
    expect(map.at(45)).toEqual({ outgoing: 45, incoming: 75 })
    expect(map.at(49)).toEqual({ outgoing: 49, incoming: 79 })
  })

  it('keeps the ends of the source when only the middle is cut away', () => {
    const map = buildContentMap({
      cuts: [
        { start: 0, end: 1 },
        { start: 9, end: 10 }
      ],
      duration: 10,
      fps: 25
    })
    expect(map.frames).toBe(200)
    expect(map.at(0)).toBe(25)
    expect(map.at(199)).toBe(224)
    expect(map.samples).toBe(384000)
    expect(map.sampleAt(0)).toBe(48000)
    expect(map.sampleAt(383999)).toBe(431999)
  })

  it('rejects positions outside the export', () => {
    const map = buildContentMap({ cuts: [], duration: 1, fps: 25 })
    expect(() => map.at(25)).toThrow()
    expect(() => map.sampleAt(48000)).toThrow()
  })

  it('derives the kept ranges from the cut list', () => {
    expect(
      keptRanges(
        [
          { start: 6, end: 8 },
          { start: 2, end: 4 }
        ],
        10
      )
    ).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 6 },
      { start: 8, end: 10 }
    ])
    expect(keptRanges([{ start: 0, end: 10 }], 10)).toEqual([])
  })

  it('merges a kept fragment shorter than two fades', () => {
    const map = buildContentMap({
      cuts: [
        { start: 2, end: 2.4 },
        { start: 2.5, end: 3 }
      ],
      duration: 10,
      fps: 25,
      fadeSec: 0.2
    })
    // 2.4–2.5 s is three frames; two five-frame fades need ten, so the
    // fragment becomes part of the cut and one full dissolve spans it.
    expect(map.pieces.map((piece) => [piece.startFrame, piece.endFrame])).toEqual([
      [0, 50],
      [75, 250]
    ])
    expect(map.frames).toBe(220)
    expect(map.samples).toBe(422400)
    expect(map.dissolves.map((dissolve) => [dissolve.outputStart, dissolve.outputEnd])).toEqual([
      [45, 50]
    ])
    expect(map.at(44)).toBe(44)
    expect(map.at(45)).toEqual({ outgoing: 45, incoming: 75 })
    expect(map.at(49)).toEqual({ outgoing: 49, incoming: 79 })
    expect(map.at(50)).toBe(80)
    expect(map.sampleAt(86400)).toEqual({ outgoing: 86400, incoming: 144000 })
    expect(map.sampleAt(422399)).toBe(479999)
  })

  it('keeps a fragment of exactly two fades with separate dissolves', () => {
    const map = buildContentMap({
      cuts: [
        { start: 2, end: 2.4 },
        { start: 2.9, end: 3 }
      ],
      duration: 10,
      fps: 25,
      fadeSec: 0.2
    })
    expect(map.pieces.map((piece) => [piece.startFrame, piece.endFrame])).toEqual([
      [0, 50],
      [60, 73],
      [75, 250]
    ])
    expect(map.frames).toBe(228)
    expect(map.samples).toBe(437760)
    expect(map.dissolves.map((dissolve) => [dissolve.outputStart, dissolve.outputEnd])).toEqual([
      [45, 50],
      [53, 58]
    ])
    // The fragment keeps three pure frames between the two dissolves.
    expect(map.at(50)).toBe(65)
    expect(map.at(52)).toBe(67)
    expect(map.at(53)).toEqual({ outgoing: 68, incoming: 75 })
    expect(map.at(58)).toBe(80)
  })

  it('keeps a first or last piece shorter than a fade', () => {
    // The cut leaves 0–0.04 s (one frame) and 0.5–10 s kept.
    const map = buildContentMap({
      cuts: [{ start: 0.04, end: 0.5 }],
      duration: 10,
      fps: 25,
      fadeSec: 0.2
    })
    expect(map.pieces.map((piece) => [piece.startFrame, piece.endFrame])).toEqual([
      [0, 1],
      [13, 250]
    ])
    expect(map.frames).toBe(237)
    expect(map.samples).toBe(455040)
    expect(map.at(0)).toEqual({ outgoing: 0, incoming: 13 })
    expect(map.at(1)).toBe(14)
  })
})
