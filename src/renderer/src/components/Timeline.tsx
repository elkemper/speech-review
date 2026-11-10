import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { clamp, formatTimecode } from '@shared/format'
import type { Defect } from '@shared/types'
import { DEFECT_COLORS } from '../defectsUi'
import { seekTo } from '../player'
import { useApp } from '../store'

const HEIGHT = 94

export default function Timeline({ defects }: { defects: Defect[] }) {
  const project = useApp((state) => state.project)
  const peaks = useApp((state) => state.peaks)
  const currentTime = useApp((state) => state.currentTime)
  const loop = useApp((state) => state.loop)
  const activeDefectId = useApp((state) => state.activeDefectId)
  const setActiveDefect = useApp((state) => state.setActiveDefect)

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null)
  const draggingRef = useRef(false)

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

    const duration = Math.max(0.1, project.duration)

    ctx.fillStyle = '#0c111a'
    ctx.fillRect(0, 0, width, HEIGHT)

    const step = duration <= 120 ? 10 : duration <= 900 ? 60 : 300
    ctx.font = '10px "SF Mono", ui-monospace, monospace'
    ctx.textBaseline = 'top'
    for (let time = 0; time <= duration + 0.01; time += step) {
      const x = (time / duration) * width
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.10)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(Math.round(x) + 0.5, 0)
      ctx.lineTo(Math.round(x) + 0.5, HEIGHT)
      ctx.stroke()
      if (x < width - 26) {
        ctx.fillStyle = 'rgba(148, 163, 184, 0.55)'
        ctx.fillText(formatTimecode(time), x + 4, 4)
      }
    }

    if (peaks && peaks.max.length > 0) {
      const mid = HEIGHT / 2 + 6
      const amp = HEIGHT * 0.34
      const count = peaks.max.length
      ctx.strokeStyle = 'rgba(110, 168, 254, 0.6)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = 0; x < width; x++) {
        const from = Math.floor((x / width) * count)
        const to = Math.max(from + 1, Math.floor(((x + 1) / width) * count))
        let low = 0
        let high = 0
        for (let i = from; i < to && i < count; i++) {
          if (peaks.min[i] < low) low = peaks.min[i]
          if (peaks.max[i] > high) high = peaks.max[i]
        }
        ctx.moveTo(x + 0.5, mid - high * amp)
        ctx.lineTo(x + 0.5, mid - low * amp)
      }
      ctx.stroke()
    }

    for (const defect of defects) {
      const x = (defect.start / duration) * width
      const color = DEFECT_COLORS[defect.type]
      const active = defect.id === activeDefectId
      ctx.globalAlpha = defect.reviewed ? 0.16 : active ? 0.95 : 0.55
      ctx.fillStyle = color
      if (defect.type === 'pause') {
        const endX = (Math.min(duration, defect.end) / duration) * width
        ctx.fillRect(x, 0, Math.max(1.5, endX - x), HEIGHT)
      } else {
        ctx.fillRect(x - 1, 0, active ? 2.5 : 1.5, HEIGHT)
        ctx.beginPath()
        ctx.moveTo(x - 3.5, 0)
        ctx.lineTo(x + 3.5, 0)
        ctx.lineTo(x, 5)
        ctx.closePath()
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1

    if (loop) {
      const x1 = (clamp(loop.start, 0, duration) / duration) * width
      const x2 = (clamp(loop.end, 0, duration) / duration) * width
      ctx.fillStyle = 'rgba(139, 92, 246, 0.16)'
      ctx.fillRect(x1, 0, Math.max(1, x2 - x1), HEIGHT)
      ctx.strokeStyle = 'rgba(167, 139, 250, 0.7)'
      ctx.lineWidth = 1
      ctx.strokeRect(x1 + 0.5, 0.5, Math.max(1, x2 - x1 - 1), HEIGHT - 1)
    }

    const playhead = (clamp(currentTime, 0, duration) / duration) * width
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
  }, [width, peaks, defects, currentTime, loop, activeDefectId, project])

  const timeFromEvent = (clientX: number): number => {
    const wrap = wrapRef.current
    if (!wrap || !project) return 0
    const rect = wrap.getBoundingClientRect()
    const ratio = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1)
    return ratio * project.duration
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!project) return
    const wrap = wrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const px = event.clientX - rect.left

    let nearest: Defect | null = null
    let best = 7
    for (const defect of defects) {
      const x = (defect.start / Math.max(0.1, project.duration)) * rect.width
      const distance = Math.abs(x - px)
      if (distance < best) {
        best = distance
        nearest = defect
      }
    }

    if (nearest) {
      setActiveDefect(nearest.id)
      seekTo(Math.max(0, nearest.start - 0.2))
    } else {
      setActiveDefect(null)
      seekTo(timeFromEvent(event.clientX))
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    draggingRef.current = true
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const wrap = wrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const x = clamp(event.clientX - rect.left, 0, rect.width)
    setHover({ x, time: timeFromEvent(event.clientX) })
    if (draggingRef.current) seekTo(timeFromEvent(event.clientX))
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    draggingRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div
      className="timeline"
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHover(null)}
      title="Клик — перемотка. Треугольники — дефекты."
    >
      <canvas ref={canvasRef} />
      {hover ? (
        <div className="timeline-hover" style={{ left: hover.x }}>
          {formatTimecode(hover.time, true)}
        </div>
      ) : null}
    </div>
  )
}
