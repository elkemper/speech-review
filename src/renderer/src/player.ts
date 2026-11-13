import { clamp } from '@shared/format'
import type { Defect } from '@shared/types'
import { useApp } from './store'

let element: HTMLVideoElement | null = null
/**
 * While reviewing a single defect with skip mode enabled, jumping over that
 * same defect would make "прослушать" useless. The bypass expires by time, so
 * ordinary playback resumes skipping afterwards.
 */
let skipBypassUntil = -1

export function attachVideo(video: HTMLVideoElement | null): void {
  element = video
  skipBypassUntil = -1
  if (video) video.playbackRate = useApp.getState().rate
}

export function videoElement(): HTMLVideoElement | null {
  return element
}

export function seekTo(time: number): void {
  skipBypassUntil = -1
  const state = useApp.getState()
  const limit = state.project?.duration ?? element?.duration ?? 0
  const value = clamp(time, 0, Math.max(0, limit))
  if (element && Number.isFinite(value)) {
    element.currentTime = value
  }
  state.setCurrentTime(value)
}

export function playPause(): void {
  skipBypassUntil = -1
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

/** Seek and start playback. The defect panel's "прослушать" used to only seek. */
export function playFrom(time: number, until?: number): void {
  seekTo(time)
  skipBypassUntil = until ?? -1
  if (!element) return
  void element.play().catch(() => undefined)
}

export function skipBypassActive(time: number): boolean {
  return time <= skipBypassUntil
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
