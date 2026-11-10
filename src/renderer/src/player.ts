import { clamp } from '@shared/format'
import type { Defect } from '@shared/types'
import { useApp } from './store'

let element: HTMLVideoElement | null = null

export function attachVideo(video: HTMLVideoElement | null): void {
  element = video
  if (video) video.playbackRate = useApp.getState().rate
}

export function videoElement(): HTMLVideoElement | null {
  return element
}

export function seekTo(time: number): void {
  const state = useApp.getState()
  const limit = state.project?.duration ?? element?.duration ?? 0
  const value = clamp(time, 0, Math.max(0, limit))
  if (element && Number.isFinite(value)) {
    element.currentTime = value
  }
  state.setCurrentTime(value)
}

export function playPause(): void {
  const state = useApp.getState()
  if (!element) return
  if (element.paused) {
    if (element.ended || element.currentTime >= (state.project?.duration ?? 0) - 0.05) {
      element.currentTime = 0
    }
    void element.play().catch(() => undefined)
  } else {
    element.pause()
  }
}

export function nudge(delta: number): void {
  seekTo(useApp.getState().currentTime + delta)
}

export function setPlaybackRate(rate: number): void {
  useApp.getState().setRate(rate)
  if (element) element.playbackRate = rate
}

export function toggleLoopForDefect(defect: Defect | null): void {
  const state = useApp.getState()
  if (!defect) {
    state.setLoop(null)
    return
  }
  const duration = state.project?.duration ?? defect.end + 1
  const start = Math.max(0, defect.start - 0.25)
  const end = Math.min(duration, defect.end + 0.6)
  if (
    state.loop &&
    Math.abs(state.loop.start - start) < 0.01 &&
    Math.abs(state.loop.end - end) < 0.01
  ) {
    state.setLoop(null)
    return
  }
  state.setLoop({ start, end })
  seekTo(start)
}
