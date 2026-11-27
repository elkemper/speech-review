import { useEffect, useMemo, useRef } from 'react'
import { cutEditFor, movedCutEdge } from '@shared/cutEdit'
import type {
  DefectTableCommand,
  DefectTableCommandResult,
  DefectTableState
} from '@shared/defectTable'
import { isExportableDefect, toExportDefects } from '@shared/exportRows'
import type { Defect } from '@shared/types'
import { canRedo, canUndo } from './history'
import { seekTo } from './player'
import { useApp } from './store'

/** Everything except the playhead, which is read at send time. */
type TableSnapshot = Omit<DefectTableState, 'playhead'>

const MIN_ROW_SEC = 0.05

/**
 * Main-window side of the defect table. It publishes the exported view of the
 * defect list to the table window and applies the table's commands through the
 * normal store actions, so ids, grouping, confirmation, cut overrides, history
 * and autosave all keep their existing rules.
 *
 * The table never derives defects or writes the project itself.
 */
export function useDefectTableBridge(defects: Defect[]): void {
  const project = useApp((state) => state.project)
  const settings = useApp((state) => state.settings)
  const activeDefectId = useApp((state) => state.activeDefectId)
  const history = useApp((state) => state.history)
  const defectsRef = useRef(defects)
  defectsRef.current = defects

  const snapshot = useMemo<TableSnapshot | null>(() => {
    if (!project) return null
    return {
      projectId: project.id,
      projectName: project.name,
      duration: project.duration,
      uiLanguage: settings.uiLanguage,
      fields: settings.export.fields,
      hasTranscript: Boolean(project.transcript),
      activeDefectId,
      canUndo: canUndo(history),
      canRedo: canRedo(history),
      rows: toExportDefects(
        defects,
        settings.playback,
        project.duration,
        project.cutOverrides
      )
    }
  }, [
    project,
    settings.uiLanguage,
    settings.export.fields,
    settings.playback,
    defects,
    activeDefectId,
    history
  ])

  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot
  const sendTimerRef = useRef<number | null>(null)
  const lastResultRef = useRef<DefectTableCommandResult | null>(null)

  useEffect(() => {
    const sendSnapshot = (): void => {
      const current = snapshotRef.current
      if (!current) return
      window.api.sendDefectTableState({
        ...current,
        playhead: useApp.getState().currentTime,
        lastCommand: lastResultRef.current
      })
    }

    const offReady = window.api.onDefectTableReady(sendSnapshot)
    const offCommand = window.api.onDefectTableCommand((command) => {
      const ok = applyTableCommand(command, defectsRef.current)
      // The table shows success feedback only after the command was applied;
      // an add or delete that the main window rejected must not look done.
      if ((command.type === 'delete' || command.type === 'addMark') && command.token) {
        lastResultRef.current = { token: command.token, ok }
        sendSnapshot()
      }
    })
    return () => {
      offReady()
      offCommand()
    }
  }, [])

  // Publish every change the table can see: defects, export fields, playback
  // padding (which moves cuts), language and the project itself. A short
  // debounce keeps typing in the main note field from serializing the whole
  // row list on every keystroke. The ready request above always sends at once.
  useEffect(() => {
    if (!snapshot) return
    if (sendTimerRef.current !== null) window.clearTimeout(sendTimerRef.current)
    sendTimerRef.current = window.setTimeout(() => {
      sendTimerRef.current = null
      window.api.sendDefectTableState({
        ...snapshot,
        playhead: useApp.getState().currentTime,
        lastCommand: lastResultRef.current
      })
    }, 80)
    return () => {
      if (sendTimerRef.current !== null) {
        window.clearTimeout(sendTimerRef.current)
        sendTimerRef.current = null
      }
    }
  }, [snapshot])

  // Closing the project unmounts the workspace; the table would have no state
  // owner left, so it closes together with the project.
  useEffect(() => {
    return () => {
      void window.api.closeDefectTable().catch(() => undefined)
    }
  }, [])
}

function applyTableCommand(command: DefectTableCommand, defects: Defect[]): boolean {
  const store = useApp.getState()
  const project = store.project
  if (!project) return false
  const rows = new Map(
    defects.filter(isExportableDefect).map((defect) => [defect.id, defect])
  )

  switch (command.type) {
    case 'delete': {
      const items = [...new Set(command.ids)]
        .filter((id) => rows.has(id))
        .map((id) => ({ id, relatedIds: rows.get(id)?.groupIds }))
      if (items.length === 0) return false
      store.removeDefects(items)
      return true
    }
    case 'addMark': {
      const duration = project.duration
      if (!Number.isFinite(command.start) || !Number.isFinite(command.end)) return false
      if (command.start < 0 || command.end > duration + 1e-9) return false
      if (command.end - command.start < MIN_ROW_SEC) return false
      return store.addMarkRange(command.start, command.end, command.note)
    }
    case 'setNote': {
      if (!rows.has(command.id)) return false
      store.setNote(command.id, command.note)
      return true
    }
    case 'setCut': {
      const defect = rows.get(command.id)
      if (!defect) return false
      const edit = cutEditFor(
        defect,
        store.settings.playback,
        project.duration,
        project.cutOverrides?.[defect.id],
        command.edge,
        command.value
      )
      if (!edit) return false
      store.setCutBounds(
        defect.id,
        edit.start,
        edit.end,
        movedCutEdge(command.edge)
      )
      return true
    }
    case 'activate': {
      const defect = rows.get(command.id)
      if (!defect) return false
      // The table lists every export row, while the panel may be filtered to a
      // type. Clear the display filter so the activated card is not dropped.
      store.setFilter('all')
      store.setActiveDefect(defect.id)
      store.setFollow(true)
      // Same seek as the panel: a pause is selected without a pre-roll.
      seekTo(defect.type === 'pause' ? defect.start : Math.max(0, defect.start + 0.01))
      return true
    }
    case 'undo':
      store.undo()
      return true
    case 'redo':
      store.redo()
      return true
  }
}
