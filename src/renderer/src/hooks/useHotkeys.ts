import { useEffect } from 'react'
import type { Defect } from '@shared/types'
import { nudge, playPause, seekTo, setPlaybackRate, toggleLoopForDefect } from '../player'
import { defectIdsForSelection } from '../selection'
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
  | 'review'
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
    case 'KeyJ':
      return 'next'
    case 'BracketLeft':
    case 'KeyK':
      return 'prev'
    case 'KeyR':
      return 'review'
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
    case 'j':
      return 'next'
    case '[':
    case 'k':
      return 'prev'
    case 'r':
    case 'R':
      return 'review'
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
  if (defects.length === 0) return

  let index = defects.findIndex((defect) => defect.id === state.activeDefectId)
  if (index < 0) {
    if (direction > 0) {
      index = defects.findIndex((defect) => defect.start > state.currentTime + 0.05)
    } else {
      index = -1
      for (let i = 0; i < defects.length; i++) {
        if (defects[i].start < state.currentTime - 0.05) index = i
      }
    }
  } else {
    index += direction
  }

  index = Math.max(0, Math.min(defects.length - 1, index))
  const defect = defects[index]
  if (!defect) return
  state.setActiveDefect(defect.id)
  state.setFollow(true)
  seekTo(defect.type === 'pause' ? defect.start : Math.max(0, defect.start + 0.01))
}

export function useHotkeys(defects: Defect[]): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const state = useApp.getState()

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

      const meta = event.metaKey || event.ctrlKey
      if (meta) {
        const key = event.key.toLowerCase()
        if ((event.code === 'KeyZ' || key === 'z') && !event.shiftKey) {
          event.preventDefault()
          state.undo()
        } else if (
          ((event.code === 'KeyZ' || key === 'z') && event.shiftKey) ||
          event.code === 'KeyY' ||
          key === 'y'
        ) {
          event.preventDefault()
          state.redo()
        } else if (event.code === 'KeyO' || key === 'o') {
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

      const active = defects.find((defect) => defect.id === state.activeDefectId) ?? null

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
        case 'review':
          event.preventDefault()
          if (event.shiftKey && state.selection) {
            const ids = defectIdsForSelection(
              defects,
              state.project.transcript?.words ?? [],
              state.selection
            )
            if (ids.length > 0) {
              state.setReviewedMany(
                ids,
                true,
                `Проверено выделение: ${ids.length}`
              )
            } else {
              state.notify('В выделении нет дефектов')
            }
          } else if (active) {
            state.toggleReviewed(
              active.id,
              `${active.reviewed ? 'Снята отметка' : 'Проверено'}: ${active.text}`
            )
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
          else if (state.selection) state.clearSelection()
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
