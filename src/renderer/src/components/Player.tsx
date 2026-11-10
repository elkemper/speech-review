import { useEffect, useRef, useState } from 'react'
import { formatTimecode } from '@shared/format'
import type { Defect } from '@shared/types'
import { useApp } from '../store'
import {
  attachVideo,
  nudge,
  playPause,
  setPlaybackRate,
  toggleLoopForDefect
} from '../player'

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

export default function Player({ defects }: { defects: Defect[] }) {
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
  const setError = useApp((state) => state.setError)

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
        if (loop && video.currentTime >= loop.end - 0.02) {
          video.currentTime = loop.start
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
      <div className="video-wrap" ref={wrapRef}>
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
        <button className="ctrl" onClick={addMark} title="Добавить ручную метку (M)">
          ＋ метка
        </button>
        <button className="ctrl" onClick={toggleFullscreen} title="Полный экран">
          ⛶
        </button>
      </div>
    </div>
  )
}
