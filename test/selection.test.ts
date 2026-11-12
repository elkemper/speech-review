import { describe, expect, it } from 'vitest'
import {
  defectIdsForSelection,
  markRangeForSelection,
  nearestWord,
  rangeForSelection
} from '../src/renderer/src/selection'
import {
  canDrawWordLabel,
  canDrawWordMark,
  chooseTickStep,
  clampDefectEdge,
  clampView,
  fitView,
  lodFor,
  minWordLabelWidth,
  panView,
  pixelsPerSecond,
  wordDetail,
  wordMarksVisible,
  zoomView
} from '../src/renderer/src/timelineView'
import type { Defect, Word } from '../src/shared/types'

function word(id: number, start: number, end: number, text = `w${id}`): Word {
  return {
    id,
    index: id,
    text,
    normalized: text,
    start,
    end,
    duration: end - start,
    kind: 'word',
    confidence: null
  }
}

const words = [word(0, 1, 1.4, 'Привет'), word(1, 1.5, 2, 'мир'), word(2, 5, 5.6, 'пауза')]

describe('word selection', () => {
  it('builds a range from anchor to focus in either direction', () => {
    expect(rangeForSelection(words, { anchorId: 0, focusId: 2 })).toMatchObject({
      start: 1,
      end: 5.6,
      wordIds: [0, 1, 2],
      text: 'Привет мир пауза'
    })
    expect(rangeForSelection(words, { anchorId: 2, focusId: 0 })?.wordIds).toEqual([0, 1, 2])
  })

  it('uses the exact word boundaries for a manual mark', () => {
    const range = markRangeForSelection(words, { anchorId: 1, focusId: 2 }, 99, 60)
    expect(range).toEqual({ start: 1.5, end: 5.6, wordIds: [1, 2] })
  })

  it('falls back to the playhead only when nothing is selected', () => {
    const range = markRangeForSelection(words, null, 10, 60)
    expect(range.start).toBe(10)
    expect(range.end).toBe(11.5)
    expect(range.wordIds).toEqual([])
  })

  it('clamps the fallback to the recording duration', () => {
    const range = markRangeForSelection(words, null, 59.95, 60)
    expect(range.start).toBeCloseTo(59.8, 5)
    expect(range.end).toBe(60)
  })

  it('finds the nearest word for timeline snapping', () => {
    expect(nearestWord(words, 2.2)?.id).toBe(1)
    expect(nearestWord(words, 4.9)?.id).toBe(2)
  })
})

describe('timeline view', () => {
  const duration = 600

  it('fits the whole recording and clamps panning', () => {
    expect(fitView(duration)).toEqual({ start: 0, end: 600 })
    expect(panView({ start: 10, end: 110 }, -50, duration)).toEqual({ start: 0, end: 100 })
    expect(panView({ start: 500, end: 600 }, 50, duration)).toEqual({ start: 500, end: 600 })
  })

  it('zooms around the cursor and keeps the span inside the recording', () => {
    const view = { start: 100, end: 200 }
    const zoomed = zoomView(view, 150, 2, duration)
    expect(zoomed.end - zoomed.start).toBeCloseTo(50, 5)
    expect(zoomed.start + (zoomed.end - zoomed.start) / 2).toBeCloseTo(150, 5)

    const tiny = zoomView(view, 150, 1e6, duration)
    expect(tiny.end - tiny.start).toBeCloseTo(1.5, 5)
  })

  it('never leaves the recording after zooming at the edge', () => {
    const view = zoomView({ start: 0, end: 600 }, 0, 4, duration)
    expect(view.start).toBe(0)
    expect(view.end).toBeCloseTo(150, 5)
  })

  it('clamps an invalid view to the duration', () => {
    expect(clampView({ start: -10, end: 900 }, duration)).toEqual({ start: 0, end: 600 })
    expect(clampView({ start: 599, end: 599 }, duration)).toEqual({ start: 598.5, end: 600 })
  })

  it('derives scale, tick step and level of detail', () => {
    expect(pixelsPerSecond({ start: 0, end: 100 }, 1000)).toBe(10)
    expect(chooseTickStep(10)).toBe(10)
    expect(chooseTickStep(0.01)).toBe(7200)
    expect(lodFor(0.5)).toBe(0)
    expect(lodFor(5)).toBe(1)
    expect(lodFor(30)).toBe(2)
    expect(lodFor(100)).toBe(3)
  })

  it('reveals word marks before word labels and grows detail gradually', () => {
    // Fully zoomed out: neither marks nor labels.
    expect(wordMarksVisible(0.5)).toBe(false)
    expect(wordDetail(0.5, 1000)).toBe('none')

    // As soon as marks are enabled, even a very wide word is still only a
    // mark. This is the regression guard for the reversed order: labels must
    // not appear before marks.
    expect(wordMarksVisible(0.8)).toBe(true)
    expect(wordMarksVisible(0.79)).toBe(false)
    expect(wordDetail(2, 10)).toBe('mark')
    expect(wordDetail(2, 1000)).toBe('mark')

    expect(canDrawWordMark(1)).toBe(false)
    expect(canDrawWordMark(2)).toBe(true)

    // No labels at all when words are only a few pixels wide.
    expect(minWordLabelWidth(5)).toBe(Number.POSITIVE_INFINITY)
    expect(canDrawWordLabel(5, 500)).toBe(false)

    // At medium zoom only long words get a label; short words stay marks.
    expect(wordDetail(15, 70)).toBe('mark')
    expect(wordDetail(15, 80)).toBe('label')

    // As zoom grows, the same width upgrades from a mark to a label.
    expect(wordDetail(30, 40)).toBe('mark')
    expect(wordDetail(30, 50)).toBe('label')
    expect(wordDetail(100, 24)).toBe('label')

    // Ordering invariant: a label is never shown without its mark.
    for (const pps of [1, 5, 15, 30, 100]) {
      for (const width of [0.5, 1, 2, 24, 50, 100]) {
        if (canDrawWordLabel(pps, width)) expect(canDrawWordMark(width)).toBe(true)
      }
    }
  })
})

describe('defect boundary dragging', () => {
  const bounds = { start: 10, end: 20 }

  it('moves the start edge and keeps a minimum length', () => {
    expect(clampDefectEdge(bounds, 'start', 12, 60)).toEqual({ start: 12, end: 20 })
    expect(clampDefectEdge(bounds, 'start', 0, 60)).toEqual({ start: 0, end: 20 })
    // Cannot cross the end edge; the defect keeps its minimum length.
    expect(clampDefectEdge(bounds, 'start', 30, 60)).toEqual({
      start: 20 - 0.05,
      end: 20
    })
  })

  it('moves the end edge and clamps to the recording duration', () => {
    expect(clampDefectEdge(bounds, 'end', 25, 60)).toEqual({ start: 10, end: 25 })
    expect(clampDefectEdge(bounds, 'end', 120, 60)).toEqual({ start: 10, end: 60 })
    // Cannot cross the start edge.
    expect(clampDefectEdge(bounds, 'end', 5, 60)).toEqual({
      start: 10,
      end: 10 + 0.05
    })
  })

  it('handles a zero-length recording without producing negative times', () => {
    expect(clampDefectEdge({ start: 0, end: 0 }, 'end', 5, 0)).toEqual({
      start: 0,
      end: 0.05
    })
  })
})

describe('reviewing a word selection', () => {
  const defects: Defect[] = [
    {
      id: 'd0',
      type: 'filler',
      start: 1,
      end: 1.4,
      wordIds: [0],
      text: 'Привет',
      severity: 'low',
      source: 'auto',
      reviewed: false,
      note: ''
    },
    {
      id: 'd2',
      type: 'pause',
      start: 2,
      end: 5,
      wordIds: [1, 2],
      text: 'мир … пауза',
      severity: 'high',
      source: 'auto',
      reviewed: false,
      note: ''
    }
  ]

  it('returns every defect touched by the selected words', () => {
    expect(defectIdsForSelection(defects, words, { anchorId: 0, focusId: 1 })).toEqual([
      'd0',
      'd2'
    ])
  })

  it('ignores defects outside the selection', () => {
    expect(defectIdsForSelection(defects, words, { anchorId: 2, focusId: 2 })).toEqual([
      'd2'
    ])
  })

  it('returns nothing without a selection or transcript', () => {
    expect(defectIdsForSelection(defects, words, null)).toEqual([])
    expect(defectIdsForSelection(defects, [], { anchorId: 0, focusId: 0 })).toEqual([])
  })
})
