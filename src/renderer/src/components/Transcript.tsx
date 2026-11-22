import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { formatTimecode } from '@shared/format'
import { endsSentence, findActiveWord, findSegmentIndexForWord } from '@shared/transcript'
import type { DefectCandidate } from '@shared/defects'
import type { Defect, Segment } from '@shared/types'
import { defectTypeLabel, severityLabel } from '@shared/labels'
import { DEFECT_COLORS, candidateHint, defectByWordId } from '../defectsUi'
import { useT, useUiLanguage } from '../i18n'
import { seekTo } from '../player'
import { rangeForSelection, defectIdsForSelection } from '../selection'
import { buildSkipIntervals, cutRangeFor } from '../skip'
import { useApp } from '../store'

const GAP_ROW_MIN_SEC = 2.5

type Row =
  | { kind: 'segment'; segment: Segment }
  | { kind: 'gap'; id: string; start: number; end: number }

export default function Transcript({
  defects,
  candidates = []
}: {
  defects: Defect[]
  candidates?: DefectCandidate[]
}) {
  const project = useApp((state) => state.project)
  const currentTime = useApp((state) => state.currentTime)
  const follow = useApp((state) => state.follow)
  const selection = useApp((state) => state.selection)
  const setFollow = useApp((state) => state.setFollow)
  const selectWord = useApp((state) => state.selectWord)
  const selectRange = useApp((state) => state.selectRange)
  const clearSelection = useApp((state) => state.clearSelection)
  const setActiveDefect = useApp((state) => state.setActiveDefect)
  const setFilter = useApp((state) => state.setFilter)
  const confirmMany = useApp((state) => state.confirmMany)
  const removeDefects = useApp((state) => state.removeDefects)
  const notify = useApp((state) => state.notify)
  const playback = useApp((state) => state.settings.playback)
  const t = useT()
  const lang = useUiLanguage()

  const [onlyDefects, setOnlyDefects] = useState(false)
  const parentRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ anchorId: number; moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)

  const transcript = project?.transcript
  const words = transcript?.words ?? []
  const segments = transcript?.segments ?? []

  const wordById = useMemo(() => new Map(words.map((word) => [word.id, word])), [words])
  const selectedRange = useMemo(() => rangeForSelection(words, selection), [words, selection])
  const selectedIds = useMemo(
    () => new Set(selectedRange?.wordIds ?? []),
    [selectedRange]
  )
  const selectedDefectIds = useMemo(
    () => defectIdsForSelection(defects, words, selection),
    [defects, words, selection]
  )

  const skipIntervals = useMemo(
    () =>
      buildSkipIntervals(
        defects,
        playback,
        project?.duration ?? 0,
        project?.cutOverrides
      ),
    [defects, project?.marks, project?.duration, project?.cutOverrides, playback]
  )

  const pauseCutDurations = useMemo(() => {
    const map = new Map<string, number | null>()
    for (const defect of defects) {
      if (defect.type !== 'pause') continue
      const cut = cutRangeFor(
        defect,
        playback,
        project?.duration ?? 0,
        project?.cutOverrides?.[defect.id]
      )
      map.set(defect.id, cut ? cut.end - cut.start : null)
    }
    return map
  }, [defects, playback, project?.duration, project?.cutOverrides])

  const isSkippedRange = (start: number, end: number): boolean =>
    skipIntervals.some(
      (interval) => interval.start < end && interval.end > start
    )

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

  const candidateByWordId = useMemo(() => defectByWordId(candidates), [candidates])

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

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = []
    let previous: Segment | null = null
    for (const segment of visibleSegments) {
      if (previous) {
        const gap = segment.start - previous.end
        // A separate gap row is only meaningful for a sentence boundary.
        // Ordinary long pauses are already marked as pause defects; do not
        // give them an extra visual treatment.
        let sentenceEnd = false
        for (let i = previous.wordIds.length - 1; i >= 0; i--) {
          const word = wordById.get(previous.wordIds[i])
          if (word?.kind === 'word') {
            sentenceEnd = endsSentence(word.text)
            break
          }
        }
        if (!onlyDefects && gap >= GAP_ROW_MIN_SEC && sentenceEnd) {
          list.push({
            kind: 'gap',
            id: `gap-${previous.id}-${segment.id}`,
            start: previous.end,
            end: segment.start
          })
        }
      }
      list.push({ kind: 'segment', segment })
      previous = segment
    }
    return list
  }, [visibleSegments, onlyDefects, wordById])

  const activeWord = useMemo(() => findActiveWord(words, currentTime), [words, currentTime])
  const activeSegmentIndex =
    activeWord !== null ? findSegmentIndexForWord(segments, activeWord.id) : -1
  const activeSegmentId =
    activeSegmentIndex >= 0 ? segments[activeSegmentIndex].id : -1
  const activeRowIndex = useMemo(
    () =>
      rows.findIndex((row) => row.kind === 'segment' && row.segment.id === activeSegmentId),
    [rows, activeSegmentId]
  )

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (rows[index]?.kind === 'gap' ? 46 : 92),
    overscan: 8,
    measureElement: (element) => element.getBoundingClientRect().height
  })

  useEffect(() => {
    if (!follow || activeRowIndex < 0) return
    virtualizer.scrollToIndex(activeRowIndex, { align: 'center' })
  }, [activeRowIndex, follow, virtualizer])

  const copy = (): void => {
    if (!transcript) return
    void navigator.clipboard
      .writeText(transcript.text)
      .then(() => notify(t('transcript.copied'), 'success'))
      .catch(() => notify(t('transcript.copyFailed'), 'error'))
  }

  const renderWord = (wordId: number) => {
    const word = wordById.get(wordId)
    if (!word) return null
    const list = wordDefects.get(wordId) ?? []
    const pause = pauseAfter.get(wordId)
    const pauseCutDuration = pause ? pauseCutDurations.get(pause.id) ?? null : null
    const isActive = activeWord?.id === word.id
    const isSelected = selectedIds.has(word.id)
    const isFocus = selection?.focusId === word.id
    const activeList = list.filter((defect) => !defect.dismissed)
    const confirmed =
      activeList.length > 0 && activeList.every((defect) => defect.confirmed)
    const primary = activeList[0] ?? list[0]
    const skipped = isSkippedRange(word.start, word.end)
    const wordCandidate = candidateByWordId.get(word.id)
    // A word covered only by a hidden candidate is not a defect: it stays
    // visible but must not look like a marked filler and must explain itself.
    const candidateOnly = wordCandidate !== undefined && activeList.length === 0

    const classes = ['word']
    if (word.kind === 'filler') {
      classes.push('kind-filler')
      if (candidateOnly) classes.push('below-threshold')
    } else if (word.kind === 'event' || word.kind === 'vocal_sound') classes.push('kind-event')
    if (list.length > 0) {
      classes.push('has-defect')
      if (list.some((defect) => defect.severity === 'high')) classes.push('high')
      if (confirmed) classes.push('confirmed')
    }
    if (isActive) classes.push('active')
    if (isSelected) classes.push('selected')
    if (isFocus && selection && selection.anchorId !== selection.focusId) classes.push('focus')
    if (skipped) classes.push('skipped')

    const titleLines: string[] =
      list.length > 0
        ? list.map(
            (defect) =>
              `${defectTypeLabel(lang, defect.type)} · ${severityLabel(
                lang,
                defect.severity
              )}${
                defect.dismissed
                  ? t('transcript.dismissedSuffix')
                  : defect.confirmed
                    ? t('transcript.confirmedSuffix')
                    : ''
              }`
          )
        : candidateOnly
          ? [
              candidateHint(
                wordCandidate,
                project?.rules.minDurationByType[wordCandidate.type] ?? 0,
                lang
              )
            ]
          : []
    if (skipped && !candidateOnly) titleLines.push(t('transcript.skippedHint'))
    const title = titleLines.length > 0 ? titleLines.join('\n') : undefined

    return (
      <Fragment key={word.id}>
        <span
          className={classes.join(' ')}
          title={title}
          style={
            primary && !confirmed ? { borderBottomColor: DEFECT_COLORS[primary.type] } : undefined
          }
          onPointerDown={(event) => {
            if (event.button !== 0) return
            if (event.shiftKey) {
              event.preventDefault()
              const anchor = selection?.anchorId ?? word.id
              selectRange(anchor, word.id)
              dragRef.current = { anchorId: anchor, moved: false }
              suppressClickRef.current = true
              return
            }
            dragRef.current = { anchorId: word.id, moved: false }
          }}
          onPointerEnter={(event) => {
            if (!dragRef.current || (event.buttons & 1) === 0) return
            if (word.id === dragRef.current.anchorId) return
            event.preventDefault()
            selectRange(dragRef.current.anchorId, word.id)
            dragRef.current.moved = true
            suppressClickRef.current = true
          }}
          onPointerUp={() => {
            if (dragRef.current?.moved) {
              const range = rangeForSelection(words, useApp.getState().selection)
              if (range) seekTo(range.start)
              setActiveDefect(null)
            }
            dragRef.current = null
            // A drag can end outside any word, in which case no click fires to
            // clear the guard. Reset on the next task so the immediate click
            // (when it does fire) is still suppressed.
            if (suppressClickRef.current) {
              window.setTimeout(() => {
                suppressClickRef.current = false
              }, 0)
            }
          }}
          onClick={(event) => {
            event.stopPropagation()
            if (suppressClickRef.current) {
              suppressClickRef.current = false
              return
            }
            seekTo(word.start)
            selectWord(word.id)
            setFollow(true)
            if (primary) {
              // A deleted card can be under a type filter other than its own.
              if (primary.dismissed) setFilter('all')
              setActiveDefect(primary.id)
            } else {
              if (wordCandidate) {
                setFilter('all')
                setActiveDefect(wordCandidate.id)
              } else {
                setActiveDefect(null)
              }
            }
          }}
        >
          {word.text}
        </span>
        {pause ? (
          <button
            className={`pause-chip ${pause.severity} ${pause.confirmed ? 'confirmed' : ''} ${
              isSkippedRange(pause.start, pause.end) ? 'skipped' : ''
            }`}
            title={`${defectTypeLabel(lang, 'pause')} · ${t('unit.shortSecondsPlain', {
              value: (pause.end - pause.start).toFixed(2)
            })} · ${
              pauseCutDuration !== null
                ? t('transcript.cutSeconds', { value: pauseCutDuration.toFixed(2) })
                : t('transcript.notCut')
            }${
              pause.dismissed
                ? t('transcript.dismissedSuffix')
                : pause.confirmed
                  ? t('transcript.confirmedSuffix')
                  : ''
            }${
              isSkippedRange(pause.start, pause.end) ? t('transcript.skippedSuffix') : ''
            }`}
            onClick={(event) => {
              event.stopPropagation()
              if (pause.dismissed) setFilter('all')
              setActiveDefect(pause.id)
              seekTo(Math.max(0, pause.start - 0.2))
              setFollow(true)
            }}
          >
            ⏸{' '}
            {pauseCutDuration !== null
              ? t('unit.shortSecondsPlain', { value: pauseCutDuration.toFixed(1) })
              : '—'}
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
          {t('transcript.title')}{' '}
          <span className="muted">{t('transcript.words', { count: words.length })}</span>
          {selection && selection.anchorId !== selection.focusId ? (
            <span className="selection-badge">
              {t('transcript.selected', { count: selectedRange?.wordIds.length ?? 0 })}{' '}
              <kbd>M</kbd> ·{' '}
              {selectedDefectIds.length > 0 ? (
                <>
                  <button
                    className="link-btn"
                    onClick={() =>
                      confirmMany(
                        defects.filter((defect) => selectedDefectIds.includes(defect.id)),
                        t('panel.confirmedSelection', { count: selectedDefectIds.length })
                      )
                    }
                    title={t('panel.confirmSelectionTitle')}
                  >
                    <kbd>Shift+Enter</kbd>{' '}
                    {t('panel.confirmSelection', { count: selectedDefectIds.length })}
                  </button>{' '}
                  ·{' '}
                  <button
                    className="link-btn danger"
                    onClick={() => {
                      removeDefects(
                        selectedDefectIds.map((id) => ({
                          id,
                          relatedIds: defects.find((defect) => defect.id === id)?.groupIds
                        }))
                      )
                      notify(t('panel.deletedCount', { count: selectedDefectIds.length }))
                    }}
                    title={t('panel.deleteSelectionTitle')}
                  >
                    <kbd>Shift+R</kbd>{' '}
                    {t('panel.deleteSelection', { count: selectedDefectIds.length })}
                  </button>{' '}
                  ·{' '}
                </>
              ) : null}
              <button className="link-btn" onClick={clearSelection}>
                {t('transcript.clearSelection')}
              </button>
            </span>
          ) : null}
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={onlyDefects}
            onChange={(event) => setOnlyDefects(event.target.checked)}
          />
          {t('transcript.onlyDefects')}
        </label>
        <button className={`btn ghost small ${follow ? 'active' : ''}`} onClick={() => setFollow(!follow)}>
          {follow ? t('transcript.follow') : t('transcript.free')}
        </button>
        <button className="btn ghost small" onClick={copy}>
          {t('transcript.copy')}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="transcript-empty">
          {onlyDefects ? t('transcript.emptyNoDefects') : t('transcript.emptyNoSpeech')}
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
              const row = rows[item.index]
              if (!row) return null
              return (
                <div
                  key={row.kind === 'segment' ? `s-${row.segment.id}` : row.id}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className={row.kind === 'segment' ? 'segment' : 'segment-gap'}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${item.start}px)`
                  }}
                >
                  {row.kind === 'segment' ? (
                    <>
                      <button
                        className="segment-time"
                        onClick={() => seekTo(row.segment.start)}
                      >
                        {formatTimecode(row.segment.start)}
                      </button>
                      <div className="segment-text">{row.segment.wordIds.map(renderWord)}</div>
                    </>
                  ) : (
                    <div className="gap-row">
                      <span className="gap-line" />
                      <span className="gap-label">
                        {t('transcript.sentencePause', {
                          value: (row.end - row.start).toFixed(1)
                        })}
                      </span>
                      <span className="gap-line" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
