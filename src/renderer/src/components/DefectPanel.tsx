import { useEffect, useMemo, useRef } from 'react'
import { formatShortSeconds, formatTimecode } from '@shared/format'
import type { Defect, DefectType } from '@shared/types'
import { DEFECT_COLORS, DEFECT_LABELS, TYPE_ORDER } from '../defectsUi'
import { playFrom, seekTo, toggleLoopForDefect } from '../player'
import { defectIdsForSelection } from '../selection'
import { useApp, type DefectFilter } from '../store'
import MiniTimeline from './MiniTimeline'

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M5.5 2h5M2.5 4h11M4 4l.6 9.2c.05.8.72 1.4 1.52 1.4h3.76c.8 0 1.47-.6 1.52-1.4L12 4M6.5 6.5v5M9.5 6.5v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M3.2 8.4l3.1 3.1 6.5-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function UndoIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M6.2 3.2L2.8 6.6l3.4 3.4M3 6.6h5.6c2.5 0 4.4 1.9 4.4 4.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function DefectPanel({
  defects,
  onHide
}: {
  defects: Defect[]
  onHide: () => void
}) {
  const project = useApp((state) => state.project)
  const filter = useApp((state) => state.filter)
  const activeDefectId = useApp((state) => state.activeDefectId)
  const loop = useApp((state) => state.loop)
  const selection = useApp((state) => state.selection)
  const confirmMany = useApp((state) => state.confirmMany)
  const setFilter = useApp((state) => state.setFilter)
  const setActiveDefect = useApp((state) => state.setActiveDefect)
  const confirmDefect = useApp((state) => state.confirmDefect)
  const unconfirmDefect = useApp((state) => state.unconfirmDefect)
  const restoreDefect = useApp((state) => state.restoreDefect)
  const setNote = useApp((state) => state.setNote)
  const addMark = useApp((state) => state.addMark)
  const removeDefect = useApp((state) => state.removeDefect)
  const removeDefects = useApp((state) => state.removeDefects)
  const splitManualGroup = useApp((state) => state.splitManualGroup)
  const setFollow = useApp((state) => state.setFollow)
  const notify = useApp((state) => state.notify)
  const exportSettings = useApp((state) => state.settings.export)
  const playback = useApp((state) => state.settings.playback)
  const showDismissed = useApp((state) => state.settings.showDismissed)

  const itemRefs = useRef(new Map<string, HTMLDivElement>())

  const ff = playback.skipEnabled
  const queueDefects = defects.filter((defect) => !defect.dismissed)
  const confirmedCount = queueDefects.filter((defect) => defect.confirmed).length
  const unconfirmedCount = queueDefects.length - confirmedCount

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
    for (const defect of queueDefects) {
      for (const type of defect.groupTypes ?? [defect.type]) {
        map.set(type, (map.get(type) ?? 0) + 1)
      }
    }
    return map
  }, [queueDefects])

  const filtered = useMemo(
    () =>
      defects.filter(
        (defect) =>
          (filter === 'all' ||
            defect.type === filter ||
            defect.groupTypes?.includes(filter as DefectType)) &&
          (!defect.dismissed || showDismissed)
      ),
    [defects, filter, showDismissed]
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

  const goNextUnconfirmed = (): void => {
    const currentTime = useApp.getState().currentTime
    const next =
      queueDefects.find((defect) => !defect.confirmed && defect.start > currentTime + 0.05) ??
      queueDefects.find((defect) => !defect.confirmed)
    if (next) selectDefect(next)
    else notify('Все дефекты подтверждены', 'success')
  }

  const confirmSelection = (): void => {
    if (selectedDefectIds.length === 0) return
    confirmMany(
      selectedDefectIds,
      `Подтверждено выделение: ${selectedDefectIds.length}`
    )
  }

  const removeSelection = (): void => {
    if (selectedDefectIds.length === 0) return
    removeDefects(
      selectedDefectIds.map((id) => ({
        id,
        relatedIds: defects.find((defect) => defect.id === id)?.groupIds
      }))
    )
    notify(`Удалено: ${selectedDefectIds.length}`)
  }

  const exportAs = async (format: 'csv' | 'json'): Promise<void> => {
    if (!project) return
    try {
      const path = await window.api.exportProject({
        project,
        defects: defects.filter((defect) => !defect.dismissed),
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
    { id: 'all', label: 'все', count: queueDefects.length },
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
            {confirmedCount} из {queueDefects.length} подтверждено
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
            width: `${queueDefects.length > 0 ? (confirmedCount / queueDefects.length) * 100 : 0}%`
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
        {selectedDefectIds.length > 0 ? (
          <div className="panel-selection-actions">
            <button
              className="link-btn"
              onClick={confirmSelection}
              title="Подтвердить все дефекты в выделении (Shift+Enter)"
            >
              подтвердить выделение ({selectedDefectIds.length})
            </button>
            <button
              className="link-btn danger"
              onClick={removeSelection}
              title="Удалить все дефекты в выделении (Shift+R)"
            >
              удалить выделение ({selectedDefectIds.length})
            </button>
          </div>
        ) : (
          <button
            className="link-btn"
            onClick={goNextUnconfirmed}
            disabled={unconfirmedCount === 0}
          >
            следующий неподтверждённый →
          </button>
        )}
        {ff ? (
          <span className="ff-hint">
            Режим пропуска: кнопки доступны, хоткеи подтверждения и удаления — на паузе
          </span>
        ) : null}
      </div>

      <div className="defect-list">
        {filtered.length === 0 ? (
          <div className="panel-empty">
            {defects.length === 0
              ? 'Дефектов пока нет. Запустите распознавание или добавьте ручную метку.'
              : queueDefects.length === 0 && !showDismissed
                ? 'Все дефекты удалены и скрыты по настройке.'
                : 'Под текущий фильтр ничего не попадает.'}
          </div>
        ) : (
          filtered.map((defect) => {
            const active = defect.id === activeDefectId
            const dismissed = defect.dismissed
            const confirmed = defect.confirmed && !dismissed
            const compact = dismissed || (confirmed && !ff)
            const showRail = !dismissed && !confirmed
            const fullBody = !dismissed && (!confirmed || ff)
            const showUndo = dismissed || confirmed
            const isLooping =
              active && loop !== null && Math.abs(loop.start - Math.max(0, defect.start - 0.25)) < 0.05
            return (
              <div
                key={defect.id}
                ref={(element) => {
                  if (element) itemRefs.current.set(defect.id, element)
                  else itemRefs.current.delete(defect.id)
                }}
                className={`defect-item ${active ? 'active' : ''} ${
                  compact ? 'compact' : ''
                } ${showRail ? '' : 'no-rail'} ${dismissed ? 'dismissed' : ''}`}
                title={compact ? defect.text : undefined}
                onClick={() => selectDefect(defect)}
              >
                {showRail ? (
                  <div className="defect-rail" onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      className="rail-btn delete"
                      title="Удалить дефект (R)"
                      aria-label="Удалить дефект"
                      onClick={() => removeDefect(defect.id, defect.groupIds)}
                    >
                      <TrashIcon />
                    </button>
                    <button
                      type="button"
                      className="rail-btn confirm"
                      title="Подтвердить дефект (Enter)"
                      aria-label="Подтвердить дефект"
                      onClick={() => confirmDefect(defect.id, `Подтверждён: ${defect.text}`)}
                    >
                      <CheckIcon />
                    </button>
                  </div>
                ) : null}

                <div className="defect-body">
                  <div className={`defect-line ${compact ? 'compact-line' : ''}`}>
                    {confirmed ? (
                      <span className="confirmed-mark" aria-hidden="true">
                        ✓
                      </span>
                    ) : null}
                    {dismissed ? (
                      <span className="dismissed-mark" aria-hidden="true">
                        <TrashIcon />
                      </span>
                    ) : null}
                    <span className="defect-time">{formatTimecode(defect.start, true)}</span>
                    <span
                      className="defect-type"
                      style={{ color: DEFECT_COLORS[defect.type] }}
                    >
                      {DEFECT_LABELS[defect.type]}
                    </span>
                    <span className="defect-sep">—</span>
                    <span className="defect-duration">
                      {formatShortSeconds(defect.end - defect.start)}
                    </span>
                    {!ff && !confirmed && !dismissed && defect.source === 'manual' ? (
                      <span className="badge">ручная</span>
                    ) : null}
                    {!ff && !confirmed && !dismissed && defect.groupIds && defect.groupIds.length > 1 ? (
                      <span
                        className="badge logical"
                        title={`Автоматически объединены: ${(defect.groupTypes ?? [])
                          .map((type) => DEFECT_LABELS[type])
                          .join(' + ')}`}
                      >
                        группа · {defect.groupIds.length}
                      </span>
                    ) : null}
                    {!ff && !confirmed && !dismissed && defect.markIds && defect.markIds.length > 1 ? (
                      <span className="badge logical" title="Несколько соседних меток объединены">
                        логическая · {defect.markIds.length}
                      </span>
                    ) : null}
                    {showUndo ? (
                      <button
                        type="button"
                        className="card-undo"
                        title={
                          dismissed ? 'Вернуть дефект' : 'Снять подтверждение'
                        }
                        aria-label={dismissed ? 'Вернуть дефект' : 'Снять подтверждение'}
                        onClick={(event) => {
                          event.stopPropagation()
                          if (dismissed) restoreDefect(defect.id, defect.groupIds)
                          else
                            unconfirmDefect(
                              defect.id,
                              `Снято подтверждение: ${defect.text}`,
                              defect.groupIds
                            )
                        }}
                      >
                        <UndoIcon />
                      </button>
                    ) : null}
                  </div>

                  {fullBody ? (
                    <>
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
                          {!ff &&
                          !confirmed &&
                          defect.source === 'manual' &&
                          defect.markIds &&
                          defect.markIds.length > 1 ? (
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
                        </div>
                      ) : null}
                    </>
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
