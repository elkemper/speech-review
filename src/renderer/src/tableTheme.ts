import { normalizeTableTheme, type TableTheme } from '@shared/tableTheme'

/**
 * Light/dark theme of the defect table window. It is deliberately independent
 * of the main window: the choice lives in this window's localStorage, is
 * applied as `data-theme` on its own document, and never enters settings,
 * the project or undo/redo.
 */
export type { TableTheme }

const STORAGE_KEY = 'sr.tableTheme'

export function loadTableTheme(): TableTheme {
  try {
    return normalizeTableTheme(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return 'dark'
  }
}

export function saveTableTheme(theme: TableTheme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // A theme is a convenience; without storage the window stays dark.
  }
}

export function applyTableTheme(theme: TableTheme): void {
  const root = document.documentElement
  if (theme === 'light') root.dataset.theme = 'light'
  else delete root.dataset.theme
}
