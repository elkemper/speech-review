import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { formatTimecode } from '@shared/format'
import { findActiveWord, findSegmentIndexForWord } from '@shared/transcript'
import type { Defect } from '@shared/types'
import { DEFECT_COLORS, DEFECT_LABELS, SEVERITY_LABELS } from '../defectsUi'
import { seekTo } from '../player'
import { useApp } from '../store'

export default function Transcript({ defects }: { defects: Defect[] }) {
  const project = useApp((state) => state.project)
  const currentTime = useApp((state) => state.currentTime)
  const follow = useApp((state) => state.follow)
  const selectedWordId = useApp((state) => state.selectedWordId)
  const setFollow = useApp((state) => state.setFollow)
  const selectWord = useApp((state) => state.selectWord)
  const setActiveDefect = useApp((state) => state.setActiveDefect)
  const notify = useApp((state) => state.notify)

  const [onlyDefects, setOnlyDefects] = useState(false)
  const parentRef = useRef<HTMLDivElement>(null)

  const transcript = project?.transcript
  const words = transcript?.words ?? []
  const segments = transcript?.segments ?? []

  const wordById = useMemo(() => new Map(words.map((word) => [word.id, word])), [words])

  const wordDefects = useMemo(() => {
    const map = new Map<number, Defect[]>()
    for (const defect of defects) {
      if (defect.type === 'pause') continue
      for (const wordId of defect.wordIds) {
        const list = map.get(wordId)
        if (list) list.push(defect)
        else map.set(wordId, [defect])
      }
    }
    return map
  }, [defects])

  const pauseAfter = useMemo(() => {
    const map = new Map<number, Defect>()
    for (const defect of defects) {
      if (defect.type !== 'pause' || defect.wordIds.length === 0) continue
      map.set(defect.wordIds[0], defect)
    }
    return map
  }, [defects])

  const visibleSegments = useMemo(() => {
    if (!onlyDefects) return segments
    return segments.filter((segment) =>
      segment.wordIds.some((wordId) => wordDefects.has(wordId) || pauseAfter.has(wordId))
    )
  }, [segments, onlyDefects, wordDefects, pauseAfter])

  const activeWord = useMemo(() => findActiveWord(words, currentTime), [words, currentTime])
  const activeSegmentIndex =
    activeWord !== null ? findSegmentIndexForWord(segments, activeWord.id) : -1
  const activeSegmentId =
    activeSegmentIndex >= 0 ? segments[activeSegmentIndex].id : -1
  const activeVisibleIndex = useMemo(
    () => visibleSegments.findIndex((segment) => segment.id === activeSegmentId),
    [visibleSegments, activeSegmentId]
  )

  const virtualizer = useVirtualizer({
    count: visibleSegments.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 92,
    overscan: 8,
    measureElement: (element) => element.getBoundingClientRect().height
  })

  useEffect(() => {
    if (!follow || activeVisibleIndex < 0) return
    virtualizer.scrollToIndex(activeVisibleIndex, { align: 'center' })
  }, [activeVisibleIndex, follow, virtualizer])

  const copy = (): void => {
    if (!transcript) return
    void navigator.clipboard
      .writeText(transcript.text)
      .then(() => notify('Транскрипт скопирован', 'success'))
      .catch(() => notify('Не удалось скопировать текст', 'error'))
  }

  const renderWord = (wordId: number) => {
    const word = wordById.get(wordId)
    if (!word) return null
    const list = wordDefects.get(wordId) ?? []
    const pause = pauseAfter.get(wordId)
    const isActive = activeWord?.id === word.id
    const isSelected = selectedWordId === word.id
    const reviewed = list.length > 0 && list.every((defect) => defect.reviewed)

    const classes = ['word']
    if (word.kind === 'filler') classes.push('kind-filler')
    else if (word.kind === 'event' || word.kind === 'vocal_sound') classes.push('kind-event')
    if (list.length > 0) {
      classes.push('has-defect')
      if (list.some((defect) => defect.severity === 'high')) classes.push('high')
      if (reviewed) classes.push('reviewed')
    }
    if (isActive) classes.push('active')
    if (isSelected) classes.push('selected')

    const title =
      list.length > 0
        ? list
            .map(
              (defect) =>
                `${DEFECT_LABELS[defect.type]} · ${SEVERITY_LABELS[defect.severity]}${
                  defect.reviewed ? ' · проверено' : ''
                }`
            )
            .join('\n')
        : undefined

    return (
      <Fragment key={word.id}>
        <span
          className={classes.join(' ')}
          title={title}
          style={
            list[0] && !reviewed ? { borderBottomColor: DEFECT_COLORS[list[0].type] } : undefined
          }
          onClick={(event) => {
            event.stopPropagation()
            seekTo(word.start)
            selectWord(word.id)
            setFollow(true)
            if (list[0]) setActiveDefect(list[0].id)
          }}
        >
          {word.text}
        </span>
        {pause ? (
          <button
            className={`pause-chip ${pause.severity} ${pause.reviewed ? 'reviewed' : ''}`}
            title={`${DEFECT_LABELS.pause} · ${(pause.end - pause.start).toFixed(2)} c${
              pause.reviewed ? ' · проверено' : ''
            }`}
            onClick={(event) => {
              event.stopPropagation()
              setActiveDefect(pause.id)
              seekTo(Math.max(0, pause.start - 0.2))
              setFollow(true)
            }}
          >
            ⏸ {(pause.end - pause.start).toFixed(1)} c
          </button>
        ) : null}{' '}
      </Fragment>
    )
  }

  if (!transcript) return null

  return (
    <section className="transcript">
      <div className="transcript-toolbar">
        <div className="transcript-title">
          Транскрипт <span className="muted">{words.length} слов</span>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={onlyDefects}
            onChange={(event) => setOnlyDefects(event.target.checked)}
          />
          только с дефектами
        </label>
        <button className={`btn ghost small ${follow ? 'active' : ''}`} onClick={() => setFollow(!follow)}>
          {follow ? 'Следовать' : 'Свободно'}
        </button>
        <button className="btn ghost small" onClick={copy}>
          Копировать
        </button>
      </div>

      {visibleSegments.length === 0 ? (
        <div className="transcript-empty">
          {onlyDefects
            ? 'В этой записи не найдено дефектов по текущим правилам.'
            : 'Речь не распознана. Проверьте, что в файле есть аудиодорожка.'}
        </div>
      ) : (
        <div
          className="transcript-scroll"
          ref={parentRef}
          onWheel={(event) => {
            if (Math.abs(event.deltaY) > 4 && follow) setFollow(false)
          }}
        >
          <div className="transcript-inner" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map((item) => {
              const segment = visibleSegments[item.index]
              if (!segment) return null
              return (
                <div
                  key={segment.id}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className="segment"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${item.start}px)`
                  }}
                >
                  <button className="segment-time" onClick={() => seekTo(segment.start)}>
                    {formatTimecode(segment.start)}
                  </button>
                  <div className="segment-text">{segment.wordIds.map(renderWord)}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
