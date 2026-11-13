import { useEffect } from 'react'
import type { Defect } from '@shared/types'
import { nudge, playPause, seekTo, setPlaybackRate, toggleLoopForDefect } from '../player'
import { defectIdsForSelection, defectIdsInRange } from '../selection'
import { useApp } from '../store'

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

type Action =
  | 'play'
  | 'left'
  | 'right'
  | 'home'
  | 'end'
  | 'next'
  | 'prev'
  | 'skip'
  | 'confirm'
  | 'delete'
  | 'mark'
  | 'bookmark'
  | 'loop'
  | 'follow'
  | 'escape'
  | `rate${1 | 2 | 3 | 4 | 5 | 6}`

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

const NON_TEXT_INPUT_TYPES = new Set([
  'range',
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'file',
  'color'
])

/** Range sliders and checkboxes should not swallow Cmd+Z. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true
  }
  if (target instanceof HTMLInputElement) {
    return !NON_TEXT_INPUT_TYPES.has(target.type)
  }
  return false
}

/**
 * Shortcuts are matched by `event.code` first, so they keep working on a
 * Russian keyboard layout where `r`, `m`, `[` and `]` produce other characters.
 */
function actionFor(event: KeyboardEvent): Action | null {
  switch (event.code) {
    case 'Space':
      return 'play'
    case 'ArrowLeft':
      return 'left'
    case 'ArrowRight':
      return 'right'
    case 'Home':
      return 'home'
    case 'End':
      return 'end'
    case 'BracketRight':
      return 'next'
    case 'BracketLeft':
      return 'prev'
    case 'KeyK':
      return 'skip'
    case 'KeyR':
      return 'delete'
    case 'Enter':
    case 'NumpadEnter':
      return 'confirm'
    case 'KeyM':
      return 'mark'
    case 'KeyB':
      return 'bookmark'
    case 'KeyL':
      return 'loop'
    case 'KeyF':
      return 'follow'
    case 'Escape':
      return 'escape'
    case 'Digit1':
    case 'Numpad1':
      return 'rate1'
    case 'Digit2':
    case 'Numpad2':
      return 'rate2'
    case 'Digit3':
    case 'Numpad3':
      return 'rate3'
    case 'Digit4':
    case 'Numpad4':
      return 'rate4'
    case 'Digit5':
    case 'Numpad5':
      return 'rate5'
    case 'Digit6':
    case 'Numpad6':
      return 'rate6'
    default:
      break
  }

  // Fallback for synthetic events where `code` is empty.
  switch (event.key) {
    case ' ':
      return 'play'
    case 'ArrowLeft':
      return 'left'
    case 'ArrowRight':
      return 'right'
    case 'Home':
      return 'home'
    case 'End':
      return 'end'
    case ']':
      return 'next'
    case '[':
      return 'prev'
    case 'k':
    case 'K':
      return 'skip'
    case 'r':
    case 'R':
      return 'delete'
    case 'Enter':
      return 'confirm'
    case 'm':
    case 'M':
      return 'mark'
    case 'b':
    case 'B':
      return 'bookmark'
    case 'l':
    case 'L':
      return 'loop'
    case 'f':
    case 'F':
      return 'follow'
    case 'Escape':
      return 'escape'
    case '1':
    case '2':
    case '3':
    case '4':
    case '5':
    case '6':
      return `rate${event.key}` as Action
    default:
      return null
  }
}

function moveDefect(defects: Defect[], direction: 1 | -1): void {
  const state = useApp.getState()
  const visible = defects.filter((defect) => !defect.dismissed)
  if (visible.length === 0) return

  let index = visible.findIndex((defect) => defect.id === state.activeDefectId)
  if (index < 0) {
    if (direction > 0) {
      index = visible.findIndex((defect) => defect.start > state.currentTime + 0.05)
    } else {
      index = -1
      for (let i = 0; i < visible.length; i++) {
        if (visible[i].start < state.currentTime - 0.05) index = i
      }
    }
  } else {
    index += direction
  }

  index = Math.max(0, Math.min(visible.length - 1, index))
  const defect = visible[index]
  if (!defect) return
  state.setActiveDefect(defect.id)
  state.setFollow(true)
  seekTo(defect.type === 'pause' ? defect.start : Math.max(0, defect.start + 0.01))
}

export function useHotkeys(defects: Defect[]): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const state = useApp.getState()
      const meta = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      const undoCombo =
        meta && !event.shiftKey && (event.code === 'KeyZ' || key === 'z')
      const redoCombo =
        meta &&
        (((event.code === 'KeyZ' || key === 'z') && event.shiftKey) ||
          event.code === 'KeyY' ||
          key === 'y')

      // Undo/redo must also work in the settings dialog and with a range
      // slider focused; text fields keep their native undo.
      if ((undoCombo || redoCombo) && state.project && !isTextEntry(event.target)) {
        event.preventDefault()
        if (undoCombo) state.undo()
        else state.redo()
        return
      }

      if (state.showSettings) {
        if (event.key === 'Escape') {
          event.preventDefault()
          state.setShowSettings(false)
        }
        return
      }

      if (state.showHistory) {
        if (event.key === 'Escape') {
          event.preventDefault()
          state.setShowHistory(false)
        }
        return
      }

      if (isTyping(event.target)) return
      if (!state.project) return

      if (meta) {
        if (event.code === 'KeyO' || key === 'o') {
          event.preventDefault()
          void state.openVideo()
        } else if (event.code === 'Comma' || key === ',') {
          event.preventDefault()
          state.setShowSettings(true)
        }
        return
      }
      if (event.altKey) return

      const action = actionFor(event)
      if (!action) return

      // In skip mode, editing is available only while paused. While the video
      // is actually fast-forwarding, a stray keystroke must not confirm or
      // delete a defect that is currently being jumped over.
      const ffPlaying = state.settings.playback.skipEnabled && state.playing
      if (ffPlaying && (action === 'confirm' || action === 'delete' || action === 'mark')) {
        return
      }

      const active = defects.find((defect) => defect.id === state.activeDefectId) ?? null
      const hasSelection = Boolean(state.timeSelection || state.selection)
      const selectedIds = (): string[] =>
        state.timeSelection
          ? defectIdsInRange(defects, state.timeSelection)
          : defectIdsForSelection(
              defects,
              state.project?.transcript?.words ?? [],
              state.selection
            )

      switch (action) {
        case 'play':
          event.preventDefault()
          playPause()
          break
        case 'left':
          event.preventDefault()
          nudge(event.shiftKey ? -10 : -2)
          break
        case 'right':
          event.preventDefault()
          nudge(event.shiftKey ? 10 : 2)
          break
        case 'home':
          event.preventDefault()
          seekTo(0)
          break
        case 'end':
          event.preventDefault()
          seekTo(state.project.duration)
          break
        case 'next':
          event.preventDefault()
          moveDefect(defects, 1)
          break
        case 'prev':
          event.preventDefault()
          moveDefect(defects, -1)
          break
        case 'skip':
          event.preventDefault()
          state.toggleSkip()
          break
        case 'confirm':
          event.preventDefault()
          if (event.shiftKey && hasSelection) {
            const ids = selectedIds()
            if (ids.length > 0) {
              state.confirmMany(ids, `Подтверждено выделение: ${ids.length}`)
            } else {
              state.notify('В выделении нет дефектов')
            }
          } else if (active) {
            if (!active.dismissed) {
              state.confirmDefect(active.id, `Подтверждён: ${active.text}`)
            }
          }
          break
        case 'delete':
          event.preventDefault()
          if (event.shiftKey && hasSelection) {
            const ids = selectedIds()
            if (ids.length > 0) {
              state.removeDefects(
                ids.map((id) => ({
                  id,
                  relatedIds: defects.find((defect) => defect.id === id)?.groupIds
                }))
              )
              state.notify(`Удалено: ${ids.length}`)
            } else {
              state.notify('В выделении нет дефектов')
            }
          } else if (active) {
            if (!active.dismissed) state.removeDefect(active.id, active.groupIds)
          }
          break
        case 'mark':
          event.preventDefault()
          state.addMark()
          break
        case 'bookmark':
          event.preventDefault()
          state.addBookmark()
          break
        case 'loop':
          event.preventDefault()
          if (active) toggleLoopForDefect(active)
          else state.setLoop(null)
          break
        case 'follow':
          event.preventDefault()
          state.setFollow(!state.follow)
          break
        case 'escape':
          if (state.loop) state.setLoop(null)
          else if (state.activeDefectId) state.setActiveDefect(null)
          else if (state.selection || state.timeSelection) state.clearSelection()
          break
        default: {
          const index = Number(action.slice(4)) - 1
          if (index >= 0 && index < RATES.length) {
            event.preventDefault()
            setPlaybackRate(RATES[index])
          }
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [defects])
}
