import { useEffect, useMemo, useRef, useState } from 'react'
import { formatTimecode } from '@shared/format'
import type { Defect } from '@shared/types'
import { useApp } from '../store'
import { intervalAt, buildSkipIntervals } from '../skip'
import {
  attachVideo,
  nudge,
  playPause,
  setPlaybackRate,
  skipBypassActive,
  toggleLoopForDefect
} from '../player'

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

export default function Player({
  defects,
  videoHeight
}: {
  defects: Defect[]
  videoHeight?: number
}) {
  const mediaUrl = useApp((state) => state.mediaUrl)
  const project = useApp((state) => state.project)
  const currentTime = useApp((state) => state.currentTime)
  const playing = useApp((state) => state.playing)
  const rate = useApp((state) => state.rate)
  const loop = useApp((state) => state.loop)
  const activeDefectId = useApp((state) => state.activeDefectId)
  const setCurrentTime = useApp((state) => state.setCurrentTime)
  const setPlaying = useApp((state) => state.setPlaying)
  const addMark = useApp((state) => state.addMark)
  const addBookmark = useApp((state) => state.addBookmark)
  const setError = useApp((state) => state.setError)
  const playback = useApp((state) => state.settings.playback)
  const toggleSkip = useApp((state) => state.toggleSkip)

  const skipIntervals = useMemo(
    () =>
      buildSkipIntervals(defects, playback, project?.duration ?? 0),
    [defects, project?.marks, project?.duration, playback]
  )
  const skipRef = useRef(skipIntervals)
  skipRef.current = skipIntervals
  const skipStateRef = useRef<{ target: number; at: number } | null>(null)

  useEffect(() => {
    skipStateRef.current = null
  }, [skipIntervals, loop])

  const videoRef = useRef<HTMLVideoElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [videoError, setVideoError] = useState<string | null>(null)

  useEffect(() => {
    attachVideo(videoRef.current)
    return () => attachVideo(null)
  }, [mediaUrl])

  useEffect(() => {
    const video = videoRef.current
    if (video) video.playbackRate = rate
  }, [rate, mediaUrl])

  useEffect(() => {
    const video = videoRef.current
    if (video) {
      video.muted = muted
      video.volume = volume
    }
  }, [muted, volume, mediaUrl])

  useEffect(() => {
    let frame = 0
    let last = -1
    const tick = (): void => {
      const video = videoRef.current
      if (video) {
        const now = performance.now()
        const inLoop =
          loop !== null &&
          video.currentTime >= loop.start - 0.05 &&
          video.currentTime <= loop.end + 0.05

        if (loop && video.currentTime >= loop.end - 0.02) {
          skipStateRef.current = null
          video.currentTime = loop.start
        } else if (!video.paused && !inLoop && !skipBypassActive(video.currentTime)) {
          // One jump per interval. Re-assigning currentTime every animation
          // frame while the media element is still seeking made playback stall
          // on overlapping or adjacent ranges.
          const pending = skipStateRef.current
          if (pending) {
            if (
              video.currentTime >= pending.target - 0.05 ||
              now - pending.at > 500
            ) {
              skipStateRef.current = null
            }
          } else {
            const skipped = intervalAt(skipRef.current, video.currentTime)
            if (skipped && skipped.end > video.currentTime + 0.001) {
              skipStateRef.current = { target: skipped.end, at: now }
              video.currentTime = skipped.end
            }
          }
        }
        if (Math.abs(video.currentTime - last) >= 0.04) {
          last = video.currentTime
          setCurrentTime(video.currentTime)
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [loop, setCurrentTime])

  const activeDefect = defects.find((defect) => defect.id === activeDefectId) ?? null
  const loopActive = Boolean(loop)

  const toggleFullscreen = (): void => {
    const element = wrapRef.current
    if (!element) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void element.requestFullscreen().catch(() => undefined)
  }

  return (
    <div className="player">
      <div
        className="video-wrap"
        ref={wrapRef}
        style={videoHeight ? { height: `${videoHeight}px` } : undefined}
      >
        {mediaUrl ? (
          <video
            ref={videoRef}
            src={mediaUrl}
            playsInline
            preload="auto"
            onClick={playPause}
            onDoubleClick={toggleFullscreen}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() => {
              setVideoError(
                'Не удалось воспроизвести файл. Проверьте кодек: лучше всего подходит MP4/H.264 или MOV.'
              )
              setError(
                'Видео не воспроизводится. Перекодируйте в MP4/H.264 — распознавание при этом работает с любым файлом.'
              )
            }}
            onLoadedMetadata={() => setVideoError(null)}
          />
        ) : (
          <div className="video-placeholder">Видео не загружено</div>
        )}

        {!playing && mediaUrl && !videoError ? (
          <button className="big-play" onClick={playPause} title="Играть (Space)">
            ▶
          </button>
        ) : null}

        {videoError ? <div className="video-error">{videoError}</div> : null}

        {loop ? (
          <div className="loop-badge">
            ⟲ {formatTimecode(loop.start, true)} – {formatTimecode(loop.end, true)}
          </div>
        ) : null}

        {playback.skipEnabled ? (
          <div className="skip-badge">⏭ пропуск дефектов</div>
        ) : null}

        <div className="video-badges">
          <span>{project?.name}</span>
        </div>
      </div>

      <div className="player-controls">
        <button className="ctrl primary-ctrl" onClick={playPause} title="Играть / пауза (Space)">
          {playing ? '❚❚' : '▶'}
        </button>
        <button className="ctrl" onClick={() => nudge(-5)} title="Назад 5 секунд">
          −5
        </button>
        <button className="ctrl" onClick={() => nudge(5)} title="Вперёд 5 секунд">
          +5
        </button>
        <div className="timecode">
          {formatTimecode(currentTime, true)}
          <span className="muted"> / {formatTimecode(project?.duration ?? 0, true)}</span>
        </div>

        <div className="controls-spacer" />

        <button
          className="ctrl"
          onClick={() => setMuted((value) => !value)}
          title={muted ? 'Включить звук' : 'Выключить звук'}
        >
          {muted ? '🔇' : '🔊'}
        </button>
        <input
          className="volume"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(event) => setVolume(Number(event.target.value))}
          title="Громкость"
        />

        <select
          className="rate-select"
          value={rate}
          onChange={(event) => setPlaybackRate(Number(event.target.value))}
          title="Скорость"
        >
          {RATES.map((value) => (
            <option key={value} value={value}>
              {value}×
            </option>
          ))}
        </select>

        <button
          className={`ctrl ${loopActive ? 'active' : ''}`}
          onClick={() => toggleLoopForDefect(activeDefect)}
          title="Цикл по активному дефекту (L)"
        >
          ⟲ цикл
        </button>
        <button
          className={`ctrl ${playback.skipEnabled ? 'active' : ''}`}
          onClick={toggleSkip}
          title="Пропускать дефекты и метки при проигрывании (K)"
        >
          ⏭
        </button>
        <button className="ctrl" onClick={addMark} title="Добавить ручную метку (M)">
          ＋ метка
        </button>
        <button className="ctrl" onClick={() => addBookmark()} title="Поставить закладку (B)">
          🔖
        </button>
        <button className="ctrl" onClick={toggleFullscreen} title="Полный экран">
          ⛶
        </button>
      </div>
    </div>
  )
}
