import { useEffect, useMemo, useRef } from 'react'
import { formatTimecode } from '@shared/format'
import type { Defect, DefectType } from '@shared/types'
import { DEFECT_COLORS, DEFECT_LABELS, SEVERITY_LABELS, TYPE_ORDER } from '../defectsUi'
import { playFrom, seekTo, toggleLoopForDefect } from '../player'
import { buildSkipIntervals } from '../skip'
import { useApp, type DefectFilter } from '../store'

export default function DefectPanel({ defects }: { defects: Defect[] }) {
  const project = useApp((state) => state.project)
  const filter = useApp((state) => state.filter)
  const onlyUnreviewed = useApp((state) => state.onlyUnreviewed)
  const activeDefectId = useApp((state) => state.activeDefectId)
  const loop = useApp((state) => state.loop)
  const setFilter = useApp((state) => state.setFilter)
  const setOnlyUnreviewed = useApp((state) => state.setOnlyUnreviewed)
  const setActiveDefect = useApp((state) => state.setActiveDefect)
  const toggleReviewed = useApp((state) => state.toggleReviewed)
  const setNote = useApp((state) => state.setNote)
  const addMark = useApp((state) => state.addMark)
  const removeMark = useApp((state) => state.removeMark)
  const setFollow = useApp((state) => state.setFollow)
  const notify = useApp((state) => state.notify)
  const exportSettings = useApp((state) => state.settings.export)
  const playback = useApp((state) => state.settings.playback)

  const itemRefs = useRef(new Map<string, HTMLDivElement>())

  const skipIntervals = useMemo(
    () =>
      buildSkipIntervals(
        defects,
        project?.marks ?? [],
        playback,
        project?.duration ?? 0
      ),
    [defects, project?.marks, project?.duration, playback]
  )

  const isSkipped = (defect: Defect): boolean =>
    skipIntervals.some(
      (interval) => interval.start < defect.end && interval.end > defect.start
    )

  const reviewedCount = defects.filter((defect) => defect.reviewed).length
  const unreviewedCount = defects.length - reviewedCount

  const counts = useMemo(() => {
    const map = new Map<DefectType, number>()
    for (const defect of defects) map.set(defect.type, (map.get(defect.type) ?? 0) + 1)
    return map
  }, [defects])

  const filtered = useMemo(
    () =>
      defects.filter(
        (defect) =>
          (filter === 'all' || defect.type === filter) &&
          (!onlyUnreviewed || !defect.reviewed)
      ),
    [defects, filter, onlyUnreviewed]
  )

  useEffect(() => {
    if (!activeDefectId) return
    itemRefs.current.get(activeDefectId)?.scrollIntoView({ block: 'nearest' })
  }, [activeDefectId, filtered])

  const selectDefect = (defect: Defect): void => {
    setActiveDefect(defect.id)
    setFollow(true)
    // Seek to the defect itself, not before it: a pre-roll made the previous
    // word active in the transcript and looked like an off-by-one.
    seekTo(defect.type === 'pause' ? defect.start : Math.max(0, defect.start + 0.01))
  }

  const goNextUnreviewed = (): void => {
    const currentTime = useApp.getState().currentTime
    const next =
      defects.find((defect) => !defect.reviewed && defect.start > currentTime + 0.05) ??
      defects.find((defect) => !defect.reviewed)
    if (next) selectDefect(next)
    else notify('Все дефекты проверены', 'success')
  }

  const exportAs = async (format: 'csv' | 'json'): Promise<void> => {
    if (!project) return
    try {
      const path = await window.api.exportProject({
        project,
        defects,
        marks: project.marks,
        format,
        exportSettings
      })
      if (path) notify(`Экспортировано: ${path}`, 'success')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const filterChips: Array<{ id: DefectFilter; label: string; count: number }> = [
    { id: 'all', label: 'все', count: defects.length },
    ...TYPE_ORDER.filter((type) => (counts.get(type) ?? 0) > 0).map((type) => ({
      id: type as DefectFilter,
      label: DEFECT_LABELS[type],
      count: counts.get(type) ?? 0
    }))
  ]

  return (
    <aside className="defect-panel">
      <div className="panel-head">
        <div>
          <h2>Дефекты</h2>
          <div className="panel-sub">
            {reviewedCount} из {defects.length} проверено
          </div>
        </div>
        <button className="btn small" onClick={addMark} title="Добавить ручную метку (M)">
          ＋ метка
        </button>
      </div>

      <div className="panel-progress">
        <div
          style={{
            width: `${defects.length > 0 ? (reviewedCount / defects.length) * 100 : 0}%`
          }}
        />
      </div>

      <div className="panel-filters">
        {filterChips.map((chip) => (
          <button
            key={chip.id}
            className={`chip ${filter === chip.id ? 'active' : ''}`}
            onClick={() => setFilter(chip.id)}
          >
            {chip.label} <b>{chip.count}</b>
          </button>
        ))}
      </div>

      <div className="panel-filter-row">
        <label className="switch">
          <input
            type="checkbox"
            checked={onlyUnreviewed}
            onChange={(event) => setOnlyUnreviewed(event.target.checked)}
          />
          только непроверенные
        </label>
        <button className="link-btn" onClick={goNextUnreviewed} disabled={unreviewedCount === 0}>
          следующий →
        </button>
      </div>

      <div className="defect-list">
        {filtered.length === 0 ? (
          <div className="panel-empty">
            {defects.length === 0
              ? 'Дефектов пока нет. Запустите распознавание или добавьте ручную метку.'
              : 'Под текущий фильтр ничего не попадает.'}
          </div>
        ) : (
          filtered.map((defect) => {
            const active = defect.id === activeDefectId
            const skipped = isSkipped(defect)
            const isLooping =
              active && loop !== null && Math.abs(loop.start - Math.max(0, defect.start - 0.25)) < 0.05
            return (
              <div
                key={defect.id}
                ref={(element) => {
                  if (element) itemRefs.current.set(defect.id, element)
                  else itemRefs.current.delete(defect.id)
                }}
                className={`defect-item ${active ? 'active' : ''} severity-${defect.severity} ${
                  defect.reviewed ? 'reviewed' : ''
                } ${skipped ? 'skipped' : ''}`}
                title={skipped ? 'Пропускается в режиме быстрого просмотра' : undefined}
                onClick={() => selectDefect(defect)}
              >
                <button
                  className={`review-box ${defect.reviewed ? 'checked' : ''}`}
                  title={defect.reviewed ? 'Снять отметку (R)' : 'Отметить проверенным (R)'}
                  onClick={(event) => {
                    event.stopPropagation()
                    toggleReviewed(defect.id)
                  }}
                >
                  {defect.reviewed ? '✓' : ''}
                </button>

                <div className="defect-body">
                  <div className="defect-line">
                    <span
                      className="defect-type"
                      style={{ color: DEFECT_COLORS[defect.type] }}
                    >
                      {DEFECT_LABELS[defect.type]}
                    </span>
                    <span className="defect-time">{formatTimecode(defect.start, true)}</span>
                    <span className={`severity-badge severity-${defect.severity}`}>
                      {SEVERITY_LABELS[defect.severity]}
                    </span>
                    {defect.source === 'manual' ? <span className="badge">ручная</span> : null}
                    {skipped ? (
                      <span className="skip-mark" title="Пропускается в режиме быстрого просмотра">
                        ⏭
                      </span>
                    ) : null}
                  </div>

                  <div className="defect-text">{defect.text}</div>

                  {active ? (
                    <textarea
                      className="note-input"
                      value={defect.note}
                      placeholder="Заметка к дефекту…"
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => setNote(defect.id, event.target.value)}
                    />
                  ) : defect.note ? (
                    <div className="defect-note">{defect.note}</div>
                  ) : null}

                  {active ? (
                    <div className="defect-actions">
                      <button
                        className="link-btn"
                        onClick={(event) => {
                          event.stopPropagation()
                          setActiveDefect(defect.id)
                          setFollow(true)
                          playFrom(
                            Math.max(0, defect.start - (defect.type === 'pause' ? 0.15 : 0.3)),
                            defect.end + 0.35
                          )
                        }}
                      >
                        ▶ прослушать
                      </button>
                      <button
                        className="link-btn"
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleLoopForDefect(defect)
                        }}
                      >
                        {isLooping ? 'выключить цикл' : 'цикл'}
                      </button>
                      {defect.source === 'manual' ? (
                        <button
                          className="link-btn danger"
                          onClick={(event) => {
                            event.stopPropagation()
                            removeMark(defect.id.replace(/^manual-/, ''))
                          }}
                        >
                          удалить
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="panel-foot">
        <button className="btn ghost small" onClick={() => void exportAs('csv')}>
          Экспорт CSV
        </button>
        <button className="btn ghost small" onClick={() => void exportAs('json')}>
          JSON
        </button>
      </div>
    </aside>
  )
}
