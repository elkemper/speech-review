import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { clamp, formatTimecode } from '@shared/format'
import type { Defect } from '@shared/types'
import { DEFECT_COLORS, defectByWordId } from '../defectsUi'
import { seekTo } from '../player'
import { useApp } from '../store'
import { clampDefectEdge, chooseTickStep, type DefectEdge } from '../timelineView'
import {
  MINI_ZOOM_MAX,
  MINI_ZOOM_MIN,
  clampMiniZoom,
  miniEdgeAt,
  miniTimeForX,
  miniVisibleFraction,
  miniWindowForDefect,
  miniXForTime,
  panMiniWindow,
  zoomMiniWindow,
  type MiniWindow
} from '../miniTimeline'

const HEIGHT = 76

function baseWindow(defect: Defect, duration: number, padSec: number): MiniWindow {
  return miniWindowForDefect(defect.start, defect.end, duration, padSec)
}

function framedWindow(
  defect: Defect,
  duration: number,
  zoom: number,
  padSec: number,
  anchorTime?: number
): MiniWindow {
  const base = baseWindow(defect, duration, padSec)
  if (zoom <= 1) return base
  const center = anchorTime ?? (defect.start + defect.end) / 2
  return zoomMiniWindow(base, zoom, center, base)
}

/**
 * Small waveform under the selected defect in the right panel. It shows enough
 * context to adjust the mark without searching on the main timeline and shares
 * the same playhead, selection and boundary state.
 *
 * Zoom is 1×–2×. At 1× the whole default window is visible and pannable stops;
 * at 2× the content is twice as large and can be scrolled horizontally inside
 * that original window. Neighbouring defects are faint and non-interactive.
 */
export default function MiniTimeline({
  defect,
  defects,
  duration
}: {
  defect: Defect
  defects: Defect[]
  duration: number
}) {
  const peaks = useApp((state) => state.peaks)
  const currentTime = useApp((state) => state.currentTime)
  const project = useApp((state) => state.project)
  const padSec = useApp((state) => state.settings.miniTimelinePadSec)
  const setDefectBounds = useApp((state) => state.setDefectBounds)

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const defectRef = useRef(defect)
  defectRef.current = defect
  const baseRef = useRef<MiniWindow>(baseWindow(defect, duration, padSec))
  baseRef.current = baseWindow(defect, duration, padSec)

  const [width, setWidth] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [view, setView] = useState<MiniWindow>(() => baseWindow(defect, duration, padSec))
  const [hoverEdge, setHoverEdge] = useState<DefectEdge | null>(null)
  const dragRef = useRef<DefectEdge | null>(null)
  const scrubRef = useRef(false)
  const viewRef = useRef(view)
  viewRef.current = view
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const selectedIdRef = useRef(defect.id)
  const scrollDragRef = useRef<{
    startX: number
    startViewStart: number
    trackWidth: number
    span: number
  } | null>(null)

  const words = project?.transcript?.words ?? []
  const wordDefectMap = useMemo(() => defectByWordId(defects), [defects])
  const activeWordIds = useMemo(() => new Set(defect.wordIds), [defect.wordIds])
  const nearbyDefects = useMemo(
    () =>
      defects.filter(
        (item) =>
          item.id !== defect.id && item.end >= view.start && item.start <= view.end
      ),
    [defects, defect.id, view.start, view.end]
  )
  const base = baseRef.current
  const zoomed = zoom > 1 + 1e-6
  const visibleFraction = miniVisibleFraction(view, base)
  const thumbLeft =
    base.end - base.start > 1e-6
      ? ((view.start - base.start) / (base.end - base.start)) * 100
      : 0

  // External edits (main timeline, undo) reframe the snippet, but not while the
  // user is dragging one of its handles. A new selected defect resets zoom.
  useEffect(() => {
    if (dragRef.current) return
    if (selectedIdRef.current !== defect.id) {
      selectedIdRef.current = defect.id
      zoomRef.current = 1
      setZoom(1)
      setView(baseWindow(defect, duration, padSec))
      return
    }
    const nextBase = baseWindow(defect, duration, padSec)
    const currentZoom = zoomRef.current
    if (currentZoom <= 1) {
      setView(nextBase)
      return
    }
    const current = viewRef.current
    const anchor = (current.start + current.end) / 2
    setView(zoomMiniWindow(nextBase, currentZoom, anchor, nextBase))
  }, [defect.id, defect.start, defect.end, duration, padSec])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.max(0, Math.floor(entries[0].contentRect.width)))
    })
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  const applyZoom = (factor: number, anchorTime: number): void => {
    const current = zoomRef.current
    const next = clampMiniZoom(current * factor)
    if (Math.abs(next - current) < 1e-6) return
    const actual = next / current
    zoomRef.current = next
    setZoom(next)
    setView((previous) => zoomMiniWindow(previous, actual, anchorTime, baseRef.current))
  }
  const applyZoomRef = useRef(applyZoom)
  applyZoomRef.current = applyZoom

  const panBy = (deltaSec: number): void => {
    if (zoomRef.current <= 1) return
    setView((previous) => panMiniWindow(previous, deltaSec, baseRef.current))
  }
  const panByRef = useRef(panBy)
  panByRef.current = panBy

  const zoomStep = (direction: 1 | -1): void => {
    const current = viewRef.current
    applyZoom(direction > 0 ? 1.25 : 1 / 1.25, (current.start + current.end) / 2)
  }

  const resetZoom = (): void => {
    zoomRef.current = 1
    setZoom(1)
    setView(baseWindow(defectRef.current, duration, padSec))
  }

  // Ctrl/Cmd+wheel (or pinch) zooms; horizontal/shift+wheel pans while the
  // snippet is zoomed in. At 1× the wheel is left to the list.
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        const rect = wrap.getBoundingClientRect()
        const anchor = miniTimeForX(event.clientX - rect.left, viewRef.current, rect.width)
        applyZoomRef.current(event.deltaY < 0 ? 1.15 : 1 / 1.15, anchor)
        return
      }
      if (zoomRef.current <= 1) return
      const horizontal =
        event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)
      if (!horizontal) return
      event.preventDefault()
      const rect = wrap.getBoundingClientRect()
      const span = viewRef.current.end - viewRef.current.start
      const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      panByRef.current((raw / Math.max(1, rect.width)) * span)
    }
    wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(HEIGHT * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${HEIGHT}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, HEIGHT)

    const span = Math.max(1e-6, view.end - view.start)
    const toX = (time: number): number => miniXForTime(time, view, width)

    ctx.fillStyle = '#141414'
    ctx.fillRect(0, 0, width, HEIGHT)

    // Grid
    const pps = width / span
    const step = chooseTickStep(pps)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
    ctx.lineWidth = 1
    const firstTick = Math.ceil(view.start / step) * step
    for (let time = firstTick; time <= view.end; time += step) {
      const x = Math.round(toX(time)) + 0.5
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, HEIGHT)
      ctx.stroke()
    }

    // Neighbouring defects: context only, deliberately faint and not draggable.
    if (nearbyDefects.length > 0) {
      ctx.save()
      for (const other of nearbyDefects) {
        const left = clamp(toX(other.start), 0, width)
        const right = clamp(toX(other.end), 0, width)
        const color = DEFECT_COLORS[other.type]
        ctx.fillStyle = color
        if (other.type === 'pause') {
          ctx.globalAlpha = 0.08
          ctx.fillRect(left, 4, Math.max(1, right - left), HEIGHT - 8)
          ctx.globalAlpha = 0.34
          ctx.fillRect(left, 4, 1.5, HEIGHT - 8)
          if (right > left + 2) ctx.fillRect(right - 1.5, 4, 1.5, HEIGHT - 8)
        } else {
          // Lighter than the active handles, but still visibly faint.
          ctx.globalAlpha = 0.34
          ctx.fillRect(left, 4, 1.5, HEIGHT - 8)
          ctx.globalAlpha = 0.5
          ctx.fillRect(left - 1.5, 2, 4.5, 3)
        }
      }
      ctx.restore()
    }

    // Waveform
    if (peaks && peaks.max.length > 0) {
      const mid = 30
      const amp = 18
      const count = peaks.max.length
      const peakPps =
        peaks.peaksPerSecond > 0 ? peaks.peaksPerSecond : count / Math.max(0.1, peaks.duration)
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
        ctx.moveTo(x + 0.5, mid - high * amp)
        ctx.lineTo(x + 0.5, mid - low * amp)
      }
      ctx.stroke()
    }

    // Word ticks and labels where they fit.
    if (words.length > 0) {
      const barTop = HEIGHT - 18
      ctx.font = '8px -apple-system, "SF Pro Text", sans-serif'
      for (const word of words) {
        if (word.end < view.start || word.start > view.end) continue
        const x1 = toX(word.start)
        const x2 = toX(word.end)
        const wordWidth = Math.max(1, x2 - x1)
        const wordDefect = wordDefectMap.get(word.id)
        const activeWord = activeWordIds.has(word.id)
        if (wordDefect || activeWord) {
          const type = activeWord ? defect.type : wordDefect!.type
          const reviewed = wordDefect?.reviewed ?? false
          ctx.save()
          ctx.globalAlpha = activeWord ? 0.42 : reviewed ? 0.12 : 0.22
          ctx.fillStyle = DEFECT_COLORS[type]
          ctx.fillRect(x1, barTop - 2, Math.max(1, wordWidth - 1), HEIGHT - barTop + 2)
          ctx.restore()
        }
        ctx.fillStyle = 'rgba(150, 160, 175, 0.3)'
        ctx.fillRect(x1, barTop, Math.max(1, wordWidth - 1), 2)
        if (wordWidth >= 16) {
          ctx.fillStyle = 'rgba(225, 230, 238, 0.62)'
          ctx.fillText(word.text, x1 + 1, barTop + 4, Math.max(1, wordWidth - 2))
        }
      }
    }

    // Active defect span
    const color = DEFECT_COLORS[defect.type]
    const x1 = clamp(toX(defect.start), 0, width)
    const x2 = clamp(toX(defect.end), 0, width)
    ctx.save()
    ctx.globalAlpha = 0.2
    ctx.fillStyle = color
    ctx.fillRect(x1, 4, Math.max(1, x2 - x1), HEIGHT - 8)
    ctx.restore()

    // Boundary handles
    const activeEdge = hoverEdge ?? dragRef.current
    for (const edge of ['start', 'end'] as DefectEdge[]) {
      const x = toX(edge === 'start' ? defect.start : defect.end)
      if (x < -2 || x > width + 2) continue
      const active = activeEdge === edge
      ctx.strokeStyle = color
      ctx.globalAlpha = active ? 1 : 0.8
      ctx.lineWidth = active ? 2 : 1.5
      ctx.beginPath()
      ctx.moveTo(x, 3)
      ctx.lineTo(x, HEIGHT - 3)
      ctx.stroke()
      ctx.fillStyle = color
      ctx.fillRect(x - 3.5, 2, 7, 5)
      ctx.fillRect(x - 3.5, HEIGHT - 7, 7, 5)
      ctx.globalAlpha = 1
    }

    // Playhead, shared with the main timeline and the player.
    if (currentTime >= view.start && currentTime <= view.end) {
      const x = toX(currentTime)
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.95)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, HEIGHT)
      ctx.stroke()
      ctx.fillStyle = '#f8fafc'
      ctx.beginPath()
      ctx.arc(x, 2, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [
    width,
    view,
    peaks,
    words,
    defect,
    currentTime,
    hoverEdge,
    duration,
    nearbyDefects,
    wordDefectMap,
    activeWordIds,
    padSec
  ])

  const xFromEvent = (event: ReactPointerEvent<HTMLDivElement>): number => {
    const wrap = wrapRef.current
    if (!wrap) return 0
    const rect = wrap.getBoundingClientRect()
    return clamp(event.clientX - rect.left, 0, rect.width)
  }

  const timeFromEvent = (event: ReactPointerEvent<HTMLDivElement>): number => {
    const wrap = wrapRef.current
    if (!wrap) return 0
    const rect = wrap.getBoundingClientRect()
    return miniTimeForX(event.clientX - rect.left, viewRef.current, rect.width)
  }

  const currentEdgeAt = (x: number): DefectEdge | null => {
    const wrap = wrapRef.current
    if (!wrap) return null
    const current = defectRef.current
    return miniEdgeAt(
      x,
      current.start,
      current.end,
      viewRef.current,
      wrap.getBoundingClientRect().width
    )
  }

  const finishDrag = (): void => {
    scrubRef.current = false
    setHoverEdge(null)
    const current = viewRef.current
    const anchor = (current.start + current.end) / 2
    setView(framedWindow(defectRef.current, duration, zoomRef.current, padSec, anchor))
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation()
    if (event.button !== 0) return
    const x = xFromEvent(event)
    const edge = currentEdgeAt(x)
    event.currentTarget.setPointerCapture(event.pointerId)
    if (edge) {
      dragRef.current = edge
      setHoverEdge(edge)
      return
    }
    dragRef.current = null
    scrubRef.current = true
    seekTo(timeFromEvent(event))
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation()
    const x = xFromEvent(event)
    if (dragRef.current) {
      const current = defectRef.current
      const time = timeFromEvent(event)
      const bounds = clampDefectEdge(
        { start: current.start, end: current.end },
        dragRef.current,
        time,
        duration
      )
      setDefectBounds(current.id, bounds.start, bounds.end)
      return
    }
    if (scrubRef.current) {
      seekTo(timeFromEvent(event))
      return
    }
    setHoverEdge(currentEdgeAt(x))
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation()
    dragRef.current = null
    finishDrag()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const onScrollThumbDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation()
    if (event.button !== 0) return
    const track = event.currentTarget.parentElement
    if (!track) return
    scrollDragRef.current = {
      startX: event.clientX,
      startViewStart: viewRef.current.start,
      trackWidth: track.getBoundingClientRect().width,
      span: viewRef.current.end - viewRef.current.start
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onScrollThumbMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation()
    const drag = scrollDragRef.current
    if (!drag) return
    const base = baseRef.current
    const baseSpan = base.end - base.start
    const deltaSec =
      ((event.clientX - drag.startX) / Math.max(1, drag.trackWidth)) * baseSpan
    setView(
      panMiniWindow(
        { start: drag.startViewStart, end: drag.startViewStart + drag.span },
        deltaSec,
        base
      )
    )
  }

  const onScrollThumbUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation()
    scrollDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const onScrollTrackDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation()
    if (event.button !== 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1)
    const base = baseRef.current
    const targetCenter = base.start + ratio * (base.end - base.start)
    const current = viewRef.current
    const currentCenter = (current.start + current.end) / 2
    setView(panMiniWindow(current, targetCenter - currentCenter, base))
  }

  const rangeLabel = useMemo(
    () => `${formatTimecode(view.start, true)} – ${formatTimecode(view.end, true)}`,
    [view.start, view.end]
  )

  return (
    <div
      className={`mini-timeline ${hoverEdge ? 'edge-hover' : ''} ${
        zoomed ? 'zoomed' : ''
      }`}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="mini-timeline-head">
        <span>{defect.source === 'manual' ? 'границы метки' : 'границы дефекта'}</span>
        <span className="mini-zoom">
          <button
            type="button"
            onClick={() => zoomStep(-1)}
            disabled={zoom <= MINI_ZOOM_MIN + 1e-6}
            title="Отдалить (минимум 1×)"
          >
            −
          </button>
          <button
            type="button"
            className="mini-zoom-value"
            onClick={resetZoom}
            title="Сбросить масштаб"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => zoomStep(1)}
            disabled={zoom >= MINI_ZOOM_MAX - 1e-6}
            title="Приблизить (до 2×)"
          >
            +
          </button>
        </span>
      </div>
      <div
        className="mini-timeline-canvas"
        ref={wrapRef}
        title={`${rangeLabel}. Потяните края; Ctrl/⌘+колесо — масштаб, Shift+колесо — прокрутка.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          if (!dragRef.current && !scrubRef.current) setHoverEdge(null)
        }}
      >
        <canvas ref={canvasRef} />
      </div>
      {zoomed ? (
        <div
          className="mini-scrollbar"
          title="Прокрутите или потяните ползунок"
          onPointerDown={onScrollTrackDown}
        >
          <div
            className="mini-scrollbar-thumb"
            style={{
              left: `${clamp(thumbLeft, 0, 100 - visibleFraction * 100)}%`,
              width: `${Math.max(8, visibleFraction * 100)}%`
            }}
            onPointerDown={onScrollThumbDown}
            onPointerMove={onScrollThumbMove}
            onPointerUp={onScrollThumbUp}
            onPointerCancel={onScrollThumbUp}
          />
        </div>
      ) : null}
      <div className="mini-timeline-foot">
        <span>{formatTimecode(defect.start, true)}</span>
        <span className="muted">
          {zoomed ? `видно ${Math.round(visibleFraction * 100)}%` : 'потяните края'}
        </span>
        <span>{formatTimecode(defect.end, true)}</span>
      </div>
    </div>
  )
}