import { describe, expect, it } from 'vitest'
import {
  defectIdsForSelection,
  defectIdsInRange,
  markRangeForSelection,
  markRangeForTimeSelection,
  nearestWord,
  rangeForSelection,
  timeSelectionFor
} from '../src/renderer/src/selection'
import {
  canDrawWordLabel,
  canDrawWordMark,
  chooseTickStep,
  clampDefectEdge,
  clampView,
  fitView,
  LABEL_MIN_GAP_PX,
  labelHasRoom,
  lodFor,
  minWordLabelWidth,
  panView,
  pixelsPerSecond,
  wordDetail,
  wordLabelRow,
  wordMarksVisible,
  zoomView
} from '../src/renderer/src/timelineView'
import type { Defect, Word } from '../src/shared/types'
import { defectByWordId } from '../src/renderer/src/defectsUi'
import {
  MINI_WINDOW_MIN_SPAN_SEC,
  clampMiniZoom,
  miniEdgeAt,
  miniTimeForX,
  miniVisibleFraction,
  miniWindowForDefect,
  miniXForTime,
  panMiniWindow,
  zoomMiniWindow
} from '../src/renderer/src/miniTimeline'

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
      confirmed: false,
      dismissed: false,
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
      confirmed: false,
      dismissed: false,
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

  it('ignores dismissed defects for bulk confirmation and deletion', () => {
    const withDismissed = [
      ...defects,
      {
        ...defects[0],
        id: 'd3',
        wordIds: [0, 1, 2],
        dismissed: true
      }
    ]
    expect(
      defectIdsForSelection(withDismissed, words, { anchorId: 0, focusId: 2 })
    ).toEqual(['d0', 'd2'])
  })

  it('returns nothing without a selection or transcript', () => {
    expect(defectIdsForSelection(defects, words, null)).toEqual([])
    expect(defectIdsForSelection(defects, [], { anchorId: 0, focusId: 0 })).toEqual([])
  })
})

describe('mini timeline window', () => {
  it('keeps the default ±3 s context around a short defect', () => {
    const view = miniWindowForDefect(10, 10.2, 60)
    expect(view.start).toBeCloseTo(7, 6)
    expect(view.end).toBeCloseTo(13.2, 6)
    expect(view.end - view.start).toBeGreaterThanOrEqual(MINI_WINDOW_MIN_SPAN_SEC)
  })

  it('accepts a custom padding from settings', () => {
    expect(miniWindowForDefect(10, 11, 60, 1)).toEqual({ start: 9, end: 12 })
    expect(miniWindowForDefect(10, 11, 60, 0)).toEqual({ start: 10, end: 11 })
  })

  it('clamps the window to the recording edges', () => {
    const atStart = miniWindowForDefect(0, 0.2, 60)
    expect(atStart.start).toBe(0)
    expect(atStart.end).toBeGreaterThan(0.2)

    const atEnd = miniWindowForDefect(59.8, 60, 60)
    expect(atEnd.end).toBe(60)
    expect(atEnd.start).toBeLessThan(59.8)
  })

  it('does not grow beyond a short recording', () => {
    expect(miniWindowForDefect(0.5, 1, 2)).toEqual({ start: 0, end: 2 })
    expect(miniWindowForDefect(0, 0, 0)).toEqual({ start: 0, end: 0.1 })
  })

  it('round-trips time through x coordinates', () => {
    const view = { start: 8, end: 14 }
    const x = miniXForTime(10, view, 300)
    expect(x).toBeCloseTo(100, 5)
    expect(miniTimeForX(100, view, 300)).toBeCloseTo(10, 5)
    expect(miniTimeForX(-50, view, 300)).toBe(8)
    expect(miniTimeForX(400, view, 300)).toBe(14)
  })

  it('detects which boundary handle is grabbed', () => {
    const view = { start: 8, end: 14 }
    expect(miniEdgeAt(100, 10, 11, view, 300)).toBe('start')
    expect(miniEdgeAt(150, 10, 11, view, 300)).toBe('end')
    expect(miniEdgeAt(125, 10, 11, view, 300)).toBeNull()
  })
})

describe('mini timeline zoom and pan', () => {
  const bounds = { start: 8, end: 12 }

  it('clamps zoom to the 1x–2x range', () => {
    expect(clampMiniZoom(0.1)).toBe(1)
    expect(clampMiniZoom(5)).toBe(4)
    expect(clampMiniZoom(Number.NaN)).toBe(1)
  })

  it('zooms in around the anchor inside the base window', () => {
    expect(zoomMiniWindow(bounds, 2, 10, bounds)).toEqual({
      start: 9,
      end: 11
    })
  })

  it('never zooms out beyond the base window', () => {
    expect(zoomMiniWindow({ start: 9, end: 11 }, 0.5, 10, bounds)).toEqual(bounds)
    expect(zoomMiniWindow(bounds, 1, 10, bounds)).toEqual(bounds)
  })

  it('clamps the zoomed window to the base edges', () => {
    expect(zoomMiniWindow(bounds, 2, 8, bounds)).toEqual({ start: 8, end: 10 })
    expect(zoomMiniWindow(bounds, 2, 12, bounds)).toEqual({ start: 10, end: 12 })
  })

  it('keeps a minimum span when zooming in hard', () => {
    const view = zoomMiniWindow({ start: 9, end: 11 }, 100, 10, bounds)
    expect(view.end - view.start).toBeCloseTo(0.02, 5)
  })

  it('pans only inside the base window', () => {
    expect(panMiniWindow({ start: 9, end: 11 }, 1, bounds)).toEqual({
      start: 10,
      end: 12
    })
    expect(panMiniWindow({ start: 9, end: 11 }, -1, bounds)).toEqual({
      start: 8,
      end: 10
    })
    expect(panMiniWindow(bounds, 1, bounds)).toEqual(bounds)
  })

  it('reports how much of the base window is visible', () => {
    expect(miniVisibleFraction(bounds, bounds)).toBe(1)
    expect(miniVisibleFraction({ start: 9, end: 11 }, bounds)).toBe(0.5)
  })
})

describe('colored word underlays', () => {
  const base = {
    type: 'filler' as const,
    start: 1,
    end: 2,
    severity: 'low' as const,
    confirmed: false,
    dismissed: false,
    note: '',
    text: ''
  }
  const auto: Defect = {
    ...base,
    id: 'auto-1',
    wordIds: [0, 1],
    source: 'auto'
  }
  const pause: Defect = {
    ...base,
    id: 'pause-1',
    type: 'pause',
    wordIds: [1, 2],
    source: 'auto'
  }
  const manual: Defect = {
    ...base,
    id: 'manual-1',
    type: 'manual',
    wordIds: [1],
    source: 'manual'
  }

  it('maps words to their defect and lets manual marks win', () => {
    const map = defectByWordId([auto, pause, manual])
    expect(map.get(0)?.id).toBe('auto-1')
    expect(map.get(1)?.id).toBe('manual-1')
  })

  it('does not color words for pause defects', () => {
    const map = defectByWordId([pause])
    expect(map.size).toBe(0)
  })
})

describe('stable word label rows', () => {
  it('assigns rows by word index, not by position in the viewport', () => {
    expect(wordLabelRow(0)).toBe(0)
    expect(wordLabelRow(1)).toBe(1)
    expect(wordLabelRow(2)).toBe(0)
    expect(wordLabelRow(41)).toBe(1)

    // The same word keeps its row no matter which index the visible slice
    // starts from: panning cannot reshuffle the strip.
    const rows = Array.from({ length: 20 }, (_, id) => wordLabelRow(id))
    for (const offset of [0, 1, 5, 20]) {
      const shifted = Array.from({ length: 20 }, (_, i) => wordLabelRow(i + offset))
      expect(shifted).toEqual(rows.slice(offset).concat(shifted.slice(rows.length - offset)))
    }
  })

  it('keeps two neighbouring labels in different rows', () => {
    expect(wordLabelRow(10)).not.toBe(wordLabelRow(11))
  })

  it('leaves room for a tile only when the previous same-row word is far enough', () => {
    // 20 ms apart at 80 px/s is 1.6 px: too tight for the 4 px gap.
    expect(labelHasRoom(1, 1.02, 80)).toBe(false)
    // 100 ms at 80 px/s is 8 px: fine.
    expect(labelHasRoom(1, 1.1, 80)).toBe(true)
    // The gap is measured in pixels, so zooming in always helps.
    expect(labelHasRoom(1, 1.02, 400)).toBe(true)
    expect(labelHasRoom(1, 1.02, 0)).toBe(false)
    expect(LABEL_MIN_GAP_PX).toBe(4)
  })
})

describe('time selection on the timeline', () => {
  it('normalizes and clamps the dragged range', () => {
    expect(timeSelectionFor(5, 2, 60)).toEqual({ start: 2, end: 5 })
    expect(timeSelectionFor(-4, 7, 60)).toEqual({ start: 0, end: 7 })
    expect(timeSelectionFor(55, 99, 60)).toEqual({ start: 55, end: 60 })
  })

  it('keeps the exact area edges and only collects overlapping words', () => {
    expect(markRangeForTimeSelection(words, { start: 1.2, end: 2.2 }, 60)).toEqual({
      start: 1.2,
      end: 2.2,
      wordIds: [0, 1]
    })
    expect(markRangeForTimeSelection(words, { start: 1, end: 1 }, 60)).toEqual({
      start: 1,
      end: 1.05,
      wordIds: [0]
    })
  })

  it('finds defects touched by the exact time range', () => {
    const defect = (id: string, start: number, end: number, extra: Partial<Defect> = {}): Defect => ({
      id,
      type: 'filler',
      start,
      end,
      wordIds: [],
      text: id,
      severity: 'medium',
      source: 'auto',
      confirmed: false,
      dismissed: false,
      note: '',
      ...extra
    })

    const list = [
      defect('left', 1, 2),
      defect('middle', 3, 4),
      defect('dismissed', 3.2, 3.8, { dismissed: true }),
      defect('candidate', 4.2, 4.6, { candidate: true })
    ]

    expect(defectIdsInRange(list, { start: 2, end: 4.2 })).toEqual(['middle'])
    expect(defectIdsInRange(list, { start: 2, end: 3 })).toEqual([])
    expect(defectIdsInRange(list, { start: 4, end: 4.5 })).toEqual(['candidate'])
    expect(defectIdsInRange(list, null)).toEqual([])
    expect(defectIdsInRange(list, { start: 4, end: 4 })).toEqual([])
  })
})
