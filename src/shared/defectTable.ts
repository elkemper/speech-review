import type { CutEdge } from './cutEdit'
import type { ExportDefect, ExportField, UiLanguage } from './types'

/**
 * Confirmation of a command that asked for feedback. The main window echoes it
 * in the next snapshot, so the table does not show success for a rejected
 * command.
 */
export interface DefectTableCommandResult {
  token: string
  ok: boolean
}

/**
 * The complete content of the defect table window. The main window owns the
 * project; the table is a passive view and never derives defects or writes
 * project files itself.
 */
export interface DefectTableState {
  projectId: string
  projectName: string
  duration: number
  /** Playback position of the main window, used to prefill a new row. */
  playhead: number
  uiLanguage: UiLanguage
  fields: ExportField[]
  hasTranscript: boolean
  /** Defect highlighted in the main window; mirrored into the table. */
  activeDefectId: string | null
  canUndo: boolean
  canRedo: boolean
  /** Exportable defects in export order, with final cut bounds. */
  rows: ExportDefect[]
  /** Result of the last command that carried a token. */
  lastCommand?: DefectTableCommandResult | null
}

/**
 * Edits made in the table window. They are applied by the main window through
 * the same store actions as the panel and the timeline. Commands that show a
 * toast carry a `token` echoed back in `lastCommand`.
 */
export type DefectTableCommand =
  | { type: 'delete'; ids: string[]; token?: string }
  | { type: 'addMark'; start: number; end: number; note: string; token?: string }
  | { type: 'setNote'; id: string; note: string }
  | { type: 'setCut'; id: string; edge: CutEdge; value: number }
  | { type: 'activate'; id: string }
  | { type: 'undo' }
  | { type: 'redo' }
