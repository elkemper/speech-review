import { useEffect, useMemo, useRef } from 'react'
import { formatTimecode } from '@shared/format'
import type { Defect, DefectType } from '@shared/types'
import { DEFECT_COLORS, DEFECT_LABELS, SEVERITY_LABELS, TYPE_ORDER } from '../defectsUi'
import { playFrom, seekTo, toggleLoopForDefect } from '../player'
import { defectIdsForSelection } from '../selection'
import { buildSkipIntervals } from '../skip'
import { useApp, type DefectFilter } from '../store'
import MiniTimeline from './MiniTimeline'

export default function DefectPanel({
  defects,
  onHide
}: {
  defects: Defect[]
  onHide: () => void
}) {
  const project = useApp((state) => state.project)
  const filter = useApp((state) => state.filter)
  const onlyUnreviewed = useApp((state) => state.onlyUnreviewed)
  const activeDefectId = useApp((state) => state.activeDefectId)
  const loop = useApp((state) => state.loop)
  const selection = useApp((state) => state.selection)
  const setReviewedMany = useApp((state) => state.setReviewedMany)
  const setFilter = useApp((state) => state.setFilter)
  const setOnlyUnreviewed = useApp((state) => state.setOnlyUnreviewed)
  const setActiveDefect = useApp((state) => state.setActiveDefect)
  const toggleReviewed = useApp((state) => state.toggleReviewed)
  const setNote = useApp((state) => state.setNote)
  const addMark = useApp((state) => state.addMark)
  const removeDefect = useApp((state) => state.removeDefect)
  const splitManualGroup = useApp((state) => state.splitManualGroup)
  const setFollow = useApp((state) => state.setFollow)
  const notify = useApp((state) => state.notify)
  const exportSettings = useApp((state) => state.settings.export)
  const playback = useApp((state) => state.settings.playback)
  const hideReviewed = useApp((state) => state.settings.hideReviewed)

  const itemRefs = useRef(new Map<string, HTMLDivElement>())

  const skipIntervals = useMemo(
    () =>
      buildSkipIntervals(defects, playback, project?.duration ?? 0),
    [defects, project?.marks, project?.duration, playback]
  )

  const isSkipped = (defect: Defect): boolean =>
    skipIntervals.some(
      (interval) => interval.start < defect.end && interval.end > defect.start
    )

  const reviewedCount = defects.filter((defect) => defect.reviewed).length
  const unreviewedCount = defects.length - reviewedCount

  const selectedDefectIds = useMemo(
    () =>
      defectIdsForSelection(
        defects,
        project?.transcript?.words ?? [],
        selection
      ),
    [defects, project?.transcript?.words, selection]
  )

  const counts = useMemo(() => {
    const map = new Map<DefectType, number>()
    for (const defect of defects) {
      for (const type of defect.groupTypes ?? [defect.type]) {
        map.set(type, (map.get(type) ?? 0) + 1)
      }
    }
    return map
  }, [defects])

  const filtered = useMemo(
    () =>
      defects.filter(
        (defect) =>
          (filter === 'all' ||
            defect.type === filter ||
            defect.groupTypes?.includes(filter as DefectType)) &&
          (!onlyUnreviewed || !defect.reviewed) &&
          (!hideReviewed || !defect.reviewed)
      ),
    [defects, filter, onlyUnreviewed, hideReviewed]
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
        <div className="panel-head-actions">
          <button className="btn small" onClick={addMark} title="Добавить ручную метку (M)">
            ＋ метка
          </button>
          <button className="icon-btn" onClick={onHide} title="Скрыть панель дефектов">
            ⟩
          </button>
        </div>
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
        {selectedDefectIds.length > 0 ? (
          <button
            className="link-btn"
            onClick={() =>
              setReviewedMany(
                selectedDefectIds,
                true,
                `Проверено выделение: ${selectedDefectIds.length}`
              )
            }
            title="Отметить проверенными все дефекты в выделении (Shift+R)"
          >
            проверить выделение ({selectedDefectIds.length})
          </button>
        ) : (
          <button className="link-btn" onClick={goNextUnreviewed} disabled={unreviewedCount === 0}>
            следующий →
          </button>
        )}
      </div>

      <div className="defect-list">
        {filtered.length === 0 ? (
          <div className="panel-empty">
            {defects.length === 0
              ? 'Дефектов пока нет. Запустите распознавание или добавьте ручную метку.'
              : hideReviewed && defects.every((defect) => defect.reviewed)
                ? 'Все дефекты проверены и скрыты по настройке.'
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
                    toggleReviewed(
                      defect.id,
                      `${defect.reviewed ? 'Снята отметка' : 'Проверено'}: ${
                        DEFECT_LABELS[defect.type]
                      } · ${defect.text}`
                    )
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
                    {defect.groupIds && defect.groupIds.length > 1 ? (
                      <span
                        className="badge logical"
                        title={`Автоматически объединены: ${(defect.groupTypes ?? [])
                          .map((type) => DEFECT_LABELS[type])
                          .join(' + ')}`}
                      >
                        группа · {defect.groupIds.length}
                      </span>
                    ) : null}
                    {defect.markIds && defect.markIds.length > 1 ? (
                      <span className="badge logical" title="Несколько соседних меток объединены">
                        логическая · {defect.markIds.length}
                      </span>
                    ) : null}
                    {skipped ? (
                      <span className="skip-mark" title="Пропускается в режиме быстрого просмотра">
                        ⏭
                      </span>
                    ) : null}
                  </div>

                  <div className="defect-text">{defect.text}</div>

                  {active ? (
                    <MiniTimeline
                      defect={defect}
                      defects={defects}
                      duration={project?.duration ?? 0}
                    />
                  ) : null}

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
                        <>
                          {defect.markIds && defect.markIds.length > 1 ? (
                            <button
                              className="link-btn"
                              onClick={(event) => {
                                event.stopPropagation()
                                splitManualGroup(defect.id)
                              }}
                            >
                              разъединить
                            </button>
                          ) : null}
                          <button
                            className="link-btn danger"
                            onClick={(event) => {
                              event.stopPropagation()
                              removeDefect(defect.id)
                            }}
                          >
                            удалить
                          </button>
                        </>
                      ) : null}
                      <span className="defect-hint">границы — на таймлайне</span>
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
