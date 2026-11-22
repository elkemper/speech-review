import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { clamp, formatTimecode } from '@shared/format'
import type { Defect } from '@shared/types'
import { DEFECT_COLORS, defectByWordId } from '../defectsUi'
import { seekTo } from '../player'
import { rangeForSelection, wordsInRange } from '../selection'
import {
  buildCutMap,
  buildSkipIntervals,
  cutView,
  subtractRanges,
  type CutRange
} from '../skip'
import { hatchPattern, TRACK_BG, TRACK_BG_LIGHT } from '../hatch'
import { useApp } from '../store'
import { useT } from '../i18n'
import { buildWaveLut, computeWaveStats, waveAmp } from '../waveform'
import {
  chooseTickStep,
  clampDefectEdge,
  firstVisibleWord,
  fitView,
  labelHasRoom,
  panView,
  pixelsPerSecond,
  wordDetail,
  wordLabelRow,
  zoomView,
  type DefectEdge,
  type TimeView
} from '../timelineView'

const DEFAULT_HEIGHT = 120

export default function Timeline({
  defects,
  height = DEFAULT_HEIGHT
}: {
  defects: Defect[]
  height?: number
}) {
  const project = useApp((state) => state.project)
  const peaks = useApp((state) => state.peaks)
  const currentTime = useApp((state) => state.currentTime)
  const follow = useApp((state) => state.follow)
  const loop = useApp((state) => state.loop)
  const activeDefectId = useApp((state) => state.activeDefectId)
  const selection = useApp((state) => state.selection)
  const timeSelection = useApp((state) => state.timeSelection)
  const playback = useApp((state) => state.settings.playback)
  const waveContrast = useApp((state) => state.settings.waveformContrast)
  const setActiveDefect = useApp((state) => state.setActiveDefect)
  const setCutBounds = useApp((state) => state.setCutBounds)
  const resetCutBounds = useApp((state) => state.resetCutBounds)
  const selectTimeRange = useApp((state) => state.selectTimeRange)
  const clearSelection = useApp((state) => state.clearSelection)
  const setFollow = useApp((state) => state.setFollow)
  const t = useT()

  const HEIGHT = Math.max(64, Math.round(height))
  const bookmarks = project?.bookmarks ?? []

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null)
  const [handleHover, setHandleHover] = useState<DefectEdge | null>(null)
  const [view, setView] = useState<TimeView>(() => fitView(project?.duration ?? 0))
  const viewRef = useRef(view)
  viewRef.current = view

  const duration = Math.max(0.1, project?.duration ?? 0)
  const words = project?.transcript?.words ?? []
  // Deleted defects keep their card in the panel but never mark the timeline.
  const visibleDefects = useMemo(
    () => defects.filter((defect) => !defect.dismissed),
    [defects]
  )
  const activeDefect = useMemo(
    () => visibleDefects.find((defect) => defect.id === activeDefectId) ?? null,
    [visibleDefects, activeDefectId]
  )
  const cutMap = useMemo(
    () =>
      buildCutMap(
        visibleDefects,
        playback,
        project?.duration ?? 0,
        project?.cutOverrides
      ),
    [visibleDefects, playback, project?.duration, project?.cutOverrides]
  )
  const activeCut = activeDefect ? cutMap.get(activeDefect.id) ?? null : null
  const wordDefectMap = useMemo(() => defectByWordId(visibleDefects), [visibleDefects])
  const activeWordIds = useMemo(
    () => new Set(activeDefect?.wordIds ?? []),
    [activeDefect]
  )
  const waveStats = useMemo(() => computeWaveStats(peaks), [peaks])
  const waveLut = useMemo(
    () => buildWaveLut(waveStats, waveContrast),
    [waveStats, waveContrast]
  )
  const selectedRange = useMemo(() => {
    if (timeSelection) {
      return {
        start: timeSelection.start,
        end: timeSelection.end,
        wordIds: wordsInRange(words, timeSelection.start, timeSelection.end),
        text: ''
      }
    }
    return rangeForSelection(words, selection)
  }, [words, selection, timeSelection])
  const skipIntervals = useMemo(
    () =>
      buildSkipIntervals(
        visibleDefects,
        playback,
        project?.duration ?? 0,
        project?.cutOverrides
      ),
    [visibleDefects, project?.marks, project?.duration, project?.cutOverrides, playback]
  )

  const draggingRef = useRef(false)
  const selectingRef = useRef<{ anchorTime: number } | null>(null)
  const boundaryRef = useRef<{ defectId: string; edge: DefectEdge } | null>(null)

  useEffect(() => {
    setView(fitView(project?.duration ?? 0))
  }, [project?.id, project?.duration])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.max(0, Math.floor(entries[0].contentRect.width)))
    })
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const onWheel = (event: WheelEvent): void => {
      const rect = wrap.getBoundingClientRect()
      if (rect.width <= 0) return
      event.preventDefault()
      const current = viewRef.current
      const span = current.end - current.start
      if (event.ctrlKey || event.metaKey) {
        const anchor =
          current.start +
          clamp((event.clientX - rect.left) / rect.width, 0, 1) * span
        const factor = Math.exp(-event.deltaY * 0.0025)
        setView(zoomView(current, anchor, factor, duration))
      } else {
        const delta =
          Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
        setView(panView(current, (delta / rect.width) * span, duration))
      }
      setFollow(false)
    }
    wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheel)
  }, [duration, setFollow])

  // Keep the playhead in view only while "follow" is on; manual panning turns
  // it off so the timeline does not fight the user.
  useEffect(() => {
    if (!follow || !project) return
    const current = viewRef.current
    if (currentTime >= current.start && currentTime <= current.end) return
    const span = current.end - current.start
    const start = clamp(currentTime - span * 0.35, 0, Math.max(0, duration - span))
    setView({ start, end: start + span })
  }, [currentTime, follow, project, duration])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !project || width <= 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(HEIGHT * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${HEIGHT}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, HEIGHT)

    const span = Math.max(0.001, view.end - view.start)
    const pps = pixelsPerSecond(view, width)
    const toX = (time: number): number => ((time - view.start) / span) * width

    ctx.fillStyle = TRACK_BG
    ctx.fillRect(0, 0, width, HEIGHT)

    // Time ruler
    const step = chooseTickStep(pps)
    ctx.font = '10px "SF Mono", ui-monospace, monospace'
    ctx.textBaseline = 'top'
    const firstTick = Math.ceil(view.start / step) * step
    for (let time = firstTick; time <= view.end + 0.001; time += step) {
      const x = Math.round(toX(time)) + 0.5
      ctx.strokeStyle = 'rgba(170, 178, 190, 0.13)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, 16)
      ctx.lineTo(x, HEIGHT)
      ctx.stroke()
      if (x < width - 32) {
        ctx.fillStyle = 'rgba(190, 198, 210, 0.62)'
        ctx.fillText(formatTimecode(time), x + 3, 3)
      }
    }

    // Waveform
    if (peaks && peaks.max.length > 0) {
      const mid = Math.max(30, HEIGHT * 0.42)
      const amp = Math.max(6, Math.min(40, HEIGHT * 0.24))
      const count = peaks.max.length
      const peakPps = peaks.peaksPerSecond > 0 ? peaks.peaksPerSecond : count / Math.max(0.1, peaks.duration)
      // Thin baseline under the envelope: gated silence and gaps between words
      // stay connected instead of looking like empty holes.
      ctx.strokeStyle = 'rgba(120, 176, 240, 0.3)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, Math.round(mid) + 0.5)
      ctx.lineTo(width, Math.round(mid) + 0.5)
      ctx.stroke()

      ctx.strokeStyle = 'rgba(120, 176, 240, 0.72)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = 0; x < width; x++) {
        const t0 = view.start + (x / width) * span
        const t1 = view.start + ((x + 1) / width) * span
        const from = Math.max(0, Math.floor(t0 * peakPps))
        const to = Math.min(count, Math.max(from + 1, Math.ceil(t1 * peakPps)))
        let low = 0
        let high = 0
        for (let i = from; i < to; i++) {
          if (peaks.min[i] < low) low = peaks.min[i]
          if (peaks.max[i] > high) high = peaks.max[i]
        }
        ctx.moveTo(x + 0.5, mid - waveAmp(waveLut, high) * amp)
        ctx.lineTo(x + 0.5, mid - waveAmp(waveLut, low) * amp)
      }
      ctx.stroke()
    }


    // Defect markers are the first layer of detail: show them even when the
    // whole recording is zoomed out, before word boundaries appear. The fill is
    // the original defect; the cut is drawn separately so the handles can move
    // without changing what was detected. The kept room tone is left unfilled
    // so the waveform stays visible under its neutral hatch.
    {
      for (const defect of visibleDefects) {
        if (defect.end < view.start || defect.start > view.end) continue
        const startX = clamp(toX(defect.start), 0, width)
        const color = DEFECT_COLORS[defect.type]
        const active = defect.id === activeDefectId
        const fillAlpha = defect.confirmed ? 0.12 : active ? 0.28 : 0.2
        const cut = cutMap.get(defect.id) ?? null
        const layers = cutView(defect, cut)
        ctx.globalAlpha = fillAlpha
        ctx.fillStyle = color
        for (const range of subtractRanges(layers.defect, layers.inner)) {
          const x1 = clamp(toX(range.start), 0, width)
          const x2 = clamp(toX(range.end), 0, width)
          if (x2 - x1 < 1) continue
          ctx.fillRect(x1, 16, Math.max(1.5, x2 - x1), HEIGHT - 16)
        }
        if (defect.type !== 'pause') {
          ctx.beginPath()
          ctx.moveTo(startX - 3.5, 14)
          ctx.lineTo(startX + 3.5, 14)
          ctx.lineTo(startX, 19)
          ctx.closePath()
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1
    }

    // Skip-mode ranges
    if (skipIntervals.length > 0) {
      ctx.fillStyle = 'rgba(250, 204, 21, 0.07)'
      for (const interval of skipIntervals) {
        if (interval.end < view.start || interval.start > view.end) continue
        const x1 = clamp(toX(interval.start), 0, width)
        const x2 = clamp(toX(interval.end), 0, width)
        ctx.fillRect(x1, 16, Math.max(1, x2 - x1), HEIGHT - 16)
      }
    }

    // Hatching between the original fill and the final cut. Outer hatching is
    // padding added by the cut: defect color over the empty track. Inner
    // hatching is room tone deliberately kept: a neutral, slightly lighter
    // shade of the track background, with no opaque base so the waveform stays
    // visible underneath. The active defect is drawn last so overlapping
    // neighbours cannot cover it.
    {
      const drawHatch = (
        ranges: CutRange[],
        pattern: CanvasPattern | null,
        alpha: number,
        confirmed: boolean
      ): void => {
        if (!pattern) return
        ctx.save()
        ctx.globalAlpha = alpha * (confirmed ? 0.55 : 1)
        ctx.fillStyle = pattern
        for (const range of ranges) {
          const x1 = clamp(toX(range.start), 0, width)
          const x2 = clamp(toX(range.end), 0, width)
          if (x2 - x1 < 1) continue
          ctx.fillRect(x1, 16, x2 - x1, HEIGHT - 16)
        }
        ctx.restore()
      }
      const ordered = [...visibleDefects].sort(
        (a, b) =>
          Number(a.id === activeDefectId) - Number(b.id === activeDefectId)
      )
      for (const defect of ordered) {
        const cut = cutMap.get(defect.id)
        if (!cut) continue
        if (cut.end < view.start || cut.start > view.end) continue
        const active = defect.id === activeDefectId
        const layers = cutView(defect, cut)
        const outerPattern = hatchPattern(ctx, DEFECT_COLORS[defect.type], 0.62)
        const innerPattern = hatchPattern(ctx, TRACK_BG_LIGHT, 0.9)
        drawHatch(layers.outer, outerPattern, active ? 1 : 0.85, defect.confirmed)
        drawHatch(layers.inner, innerPattern, active ? 1 : 0.85, defect.confirmed)
      }
    }

    // Word strip: small marks first, readable labels later. Both are gated per
    // word by pixel width, so zooming reveals detail gradually.
    if (words.length > 0) {
      const from = firstVisibleWord(words, view.start)
      const barTop = HEIGHT - 29
      ctx.font = '9px -apple-system, "SF Pro Text", sans-serif'
      for (let i = from; i < words.length && words[i].start <= view.end; i++) {
        const word = words[i]
        const x1 = toX(word.start)
        const x2 = toX(word.end)
        const wordWidth = Math.max(1, x2 - x1)
        const detail = wordDetail(pps, wordWidth)
        if (detail === 'none') continue

        const wordDefect = wordDefectMap.get(word.id)
        const activeWord = activeWordIds.has(word.id)
        const type = activeWord && activeDefect ? activeDefect.type : wordDefect?.type
        const confirmed = wordDefect?.confirmed ?? false
        const color = type ? DEFECT_COLORS[type] : null

        // Colored backing for marked words. Confirmed words stay visible but
        // dimmer; the active defect's words are the strongest.
        if (color) {
          ctx.save()
          ctx.globalAlpha = activeWord ? 0.24 : confirmed ? 0.09 : 0.15
          ctx.fillStyle = color
          ctx.fillRect(x1, barTop - 1, Math.max(1, wordWidth - 1), HEIGHT - barTop + 1)
          ctx.restore()
        }

        ctx.fillStyle = 'rgba(150, 160, 175, 0.22)'
        if (color) {
          ctx.save()
          ctx.globalAlpha = activeWord ? 0.9 : 0.5
          ctx.fillStyle = color
          ctx.fillRect(x1, barTop, Math.max(1, wordWidth - 1), 3)
          ctx.restore()
        } else {
          ctx.fillRect(x1, barTop, Math.max(1, wordWidth - 1), 3)
        }

        if (detail !== 'label') continue
        // Rows come from the word index, so panning never reshuffles them. Only
        // skip a tile when the previous word in the same row is too close.
        const row = wordLabelRow(word.id)
        const previous = i >= 2 ? words[i - 2] : null
        if (previous && !labelHasRoom(previous.end, word.start, pps)) continue
        const y = barTop + 5 + row * 12
        if (color) {
          ctx.save()
          ctx.globalAlpha = activeWord ? 0.28 : confirmed ? 0.1 : 0.17
          ctx.fillStyle = color
          ctx.fillRect(x1, y, wordWidth - 1, 11)
          ctx.restore()
        } else {
          ctx.fillStyle = 'rgba(150, 160, 175, 0.12)'
          ctx.fillRect(x1, y, wordWidth - 1, 11)
        }
        ctx.fillStyle = 'rgba(225, 230, 238, 0.82)'
        ctx.fillText(word.text, x1 + 1, y + 1, Math.max(1, wordWidth - 3))
      }
    }

    // Cut boundary ticks for the non-active defects. The active defect gets
    // full draggable handles below.
    {
      for (const defect of visibleDefects) {
        const cut = cutMap.get(defect.id)
        if (!cut || defect.id === activeDefectId) continue
        if (cut.end < view.start || cut.start > view.end) continue
        ctx.save()
        ctx.globalAlpha = defect.confirmed ? 0.22 : 0.42
        ctx.strokeStyle = DEFECT_COLORS[defect.type]
        ctx.lineWidth = 1
        for (const time of [cut.start, cut.end]) {
          if (time < view.start || time > view.end) continue
          const x = Math.round(toX(time)) + 0.5
          ctx.beginPath()
          ctx.moveTo(x, 16)
          ctx.lineTo(x, HEIGHT)
          ctx.stroke()
        }
        ctx.restore()
      }
    }

    // Bookmarks: a thin green line with a flag at the top so they stay visible
    // even when the waveform is zoomed out.
    if (bookmarks.length > 0) {
      ctx.save()
      for (const bookmark of bookmarks) {
        if (bookmark.time < view.start || bookmark.time > view.end) continue
        const x = toX(bookmark.time)
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.55)'
        ctx.lineWidth = 1
        ctx.setLineDash([2, 3])
        ctx.beginPath()
        ctx.moveTo(x, 8)
        ctx.lineTo(x, HEIGHT)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = 'rgba(52, 211, 153, 0.95)'
        ctx.beginPath()
        ctx.moveTo(x, 2)
        ctx.lineTo(x + 7, 5)
        ctx.lineTo(x, 8)
        ctx.closePath()
        ctx.fill()
      }
      ctx.restore()
    }

    // Selected word range
    if (selectedRange) {
      const x1 = clamp(toX(selectedRange.start), 0, width)
      const x2 = clamp(toX(selectedRange.end), 0, width)
      if (x2 > x1) {
        ctx.fillStyle = 'rgba(55, 148, 255, 0.16)'
        ctx.fillRect(x1, 16, x2 - x1, HEIGHT - 16)
        ctx.strokeStyle = 'rgba(90, 170, 255, 0.75)'
        ctx.lineWidth = 1
        ctx.strokeRect(x1 + 0.5, 16.5, Math.max(1, x2 - x1 - 1), HEIGHT - 18)
      }
    }

    if (loop) {
      const x1 = toX(clamp(loop.start, 0, duration))
      const x2 = toX(clamp(loop.end, 0, duration))
      ctx.fillStyle = 'rgba(139, 92, 246, 0.14)'
      ctx.fillRect(x1, 16, Math.max(1, x2 - x1), HEIGHT - 16)
      ctx.strokeStyle = 'rgba(167, 139, 250, 0.7)'
      ctx.strokeRect(x1 + 0.5, 16.5, Math.max(1, x2 - x1 - 1), HEIGHT - 17)
    }

    // Active cut handles: both edges are draggable on the timeline.
    if (activeCut) {
      ctx.save()
      ctx.strokeStyle = 'rgba(244, 193, 105, 0.9)'
      ctx.fillStyle = 'rgba(244, 193, 105, 0.95)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 3])
      for (const time of [activeCut.start, activeCut.end]) {
        if (time < view.start - 0.5 || time > view.end + 0.5) continue
        const x = toX(time)
        ctx.beginPath()
        ctx.moveTo(x, 16)
        ctx.lineTo(x, HEIGHT - 2)
        ctx.stroke()
        ctx.fillRect(x - 3.5, 14, 7, 6)
        ctx.fillRect(x - 3.5, HEIGHT - 9, 7, 6)
      }
      ctx.restore()
    }

    // Playhead
    if (currentTime >= view.start && currentTime <= view.end) {
      const playhead = toX(currentTime)
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.95)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(playhead, 0)
      ctx.lineTo(playhead, HEIGHT)
      ctx.stroke()
      ctx.fillStyle = '#f8fafc'
      ctx.beginPath()
      ctx.arc(playhead, 3, 3, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [
    width,
    peaks,
    visibleDefects,
    currentTime,
    loop,
    activeDefectId,
    project,
    view,
    duration,
    words,
    selectedRange,
    skipIntervals,
    cutMap,
    activeDefect,
    activeCut,
    bookmarks,
    HEIGHT,
    wordDefectMap,
    activeWordIds,
    waveLut
  ])

  const timeFromClientX = (clientX: number): number => {
    const wrap = wrapRef.current
    if (!wrap) return 0
    const rect = wrap.getBoundingClientRect()
    const ratio = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1)
    return viewRef.current.start + ratio * (viewRef.current.end - viewRef.current.start)
  }

  const findDefectAt = (clientX: number): Defect | null => {
    const wrap = wrapRef.current
    if (!wrap || !project) return null
    const rect = wrap.getBoundingClientRect()
    const span = Math.max(0.001, viewRef.current.end - viewRef.current.start)
    const px = clientX - rect.left
    let nearest: Defect | null = null
    let best = 7
    for (const defect of visibleDefects) {
      const cut = cutMap.get(defect.id)
      const start = cut ? Math.min(defect.start, cut.start) : defect.start
      const end = cut ? Math.max(defect.end, cut.end) : defect.end
      const startX = ((start - viewRef.current.start) / span) * rect.width
      const endX = ((end - viewRef.current.start) / span) * rect.width
      const distance = px < startX ? startX - px : px > endX ? px - endX : 0
      if (distance < best) {
        best = distance
        nearest = defect
      }
    }
    return nearest
  }

  const handleAt = (clientX: number): DefectEdge | null => {
    if (!activeDefect || !activeCut) return null
    const wrap = wrapRef.current
    if (!wrap) return null
    const rect = wrap.getBoundingClientRect()
    const span = Math.max(0.001, viewRef.current.end - viewRef.current.start)
    const px = clientX - rect.left
    const startX = ((activeCut.start - viewRef.current.start) / span) * rect.width
    const endX = ((activeCut.end - viewRef.current.start) / span) * rect.width
    const startDistance = Math.abs(px - startX)
    const endDistance = Math.abs(px - endX)
    const best = Math.min(startDistance, endDistance)
    if (best > 7) return null
    return startDistance <= endDistance ? 'start' : 'end'
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!project) return
    if (event.button !== 0) return
    const wrap = wrapRef.current
    if (!wrap) return

    const edge = handleAt(event.clientX)
    if (activeDefect && edge) {
      event.preventDefault()
      boundaryRef.current = { defectId: activeDefect.id, edge }
      setHandleHover(edge)
      setFollow(false)
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }

    const time = timeFromClientX(event.clientX)

    if (event.shiftKey) {
      event.preventDefault()
      selectTimeRange(time, time)
      selectingRef.current = { anchorTime: time }
      setActiveDefect(null)
      setFollow(false)
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }

    const nearest = findDefectAt(event.clientX)
    if (timeSelection) clearSelection()
    if (nearest) {
      setActiveDefect(nearest.id)
      seekTo(nearest.type === 'pause' ? nearest.start : Math.max(0, nearest.start + 0.01))
    } else {
      setActiveDefect(null)
      seekTo(time)
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    draggingRef.current = true
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const wrap = wrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const x = clamp(event.clientX - rect.left, 0, rect.width)
    setHover({ x, time: timeFromClientX(event.clientX) })

    if (boundaryRef.current) {
      const current =
        visibleDefects.find((defect) => defect.id === boundaryRef.current?.defectId) ??
        activeDefect
      if (!current) {
        boundaryRef.current = null
        return
      }
      boundaryRef.current.defectId = current.id
      const cut = cutMap.get(current.id)
      if (!cut) {
        boundaryRef.current = null
        return
      }
      const time = timeFromClientX(event.clientX)
      const bounds = clampDefectEdge(
        { start: cut.start, end: cut.end },
        boundaryRef.current.edge,
        time,
        duration
      )
      setCutBounds(
        current.id,
        bounds.start,
        bounds.end,
        boundaryRef.current.edge
      )
      return
    }

    if (selectingRef.current) {
      selectTimeRange(selectingRef.current.anchorTime, timeFromClientX(event.clientX))
      return
    }
    if (draggingRef.current) {
      seekTo(timeFromClientX(event.clientX))
      return
    }
    setHandleHover(handleAt(event.clientX))
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    draggingRef.current = false
    selectingRef.current = null
    boundaryRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const zoomBy = (factor: number): void => {
    setView((current) =>
      zoomView(current, (current.start + current.end) / 2, factor, duration)
    )
    setFollow(false)
  }

  const selectedLabel = timeSelection
    ? `${formatTimecode(timeSelection.start, true)}–${formatTimecode(timeSelection.end, true)}`
    : selectedRange
      ? t('timeline.selectedWords', { count: selectedRange.wordIds.length })
      : `${formatTimecode(view.start)}–${formatTimecode(view.end)}`

  return (
    <div
      className={`timeline ${handleHover ? 'handle-hover' : ''}`}
      ref={wrapRef}
      style={{ height: `${HEIGHT}px`, flexBasis: `${HEIGHT}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(event) => {
        const edge = handleAt(event.clientX)
        if (!activeDefect || !edge) return
        event.preventDefault()
        boundaryRef.current = null
        setHandleHover(null)
        resetCutBounds(activeDefect)
      }}
      onPointerLeave={() => {
        setHover(null)
        if (!boundaryRef.current) setHandleHover(null)
      }}
      title={t('timeline.gestureHint')}
    >
      <canvas ref={canvasRef} />
      <div
        className="timeline-tools"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button onClick={() => zoomBy(1.8)} title={t('timeline.zoomIn')}>
          +
        </button>
        <button onClick={() => zoomBy(1 / 1.8)} title={t('timeline.zoomOut')}>
          −
        </button>
        <button onClick={() => setView(fitView(duration))} title={t('timeline.fit')}>
          ⤢
        </button>
        <span className="timeline-scale">{selectedLabel}</span>
      </div>
      {hover ? (
        <div className="timeline-hover" style={{ left: hover.x }}>
          {formatTimecode(hover.time, true)}
        </div>
      ) : null}
    </div>
  )
}
