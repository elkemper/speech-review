/**
 * Light/dark theme value of the defect table window. The window is dark by
 * default; `light` is an explicit opt-in. Storage and DOM application are
 * window-side concerns and live in the renderer.
 */
export type TableTheme = 'dark' | 'light'

export function normalizeTableTheme(value: unknown): TableTheme {
  return value === 'light' ? 'light' : 'dark'
}
