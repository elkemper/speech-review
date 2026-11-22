import type { UiLanguage } from '@shared/i18n'

/**
 * Current interface language, cached for the main process so the menu, native
 * dialogs, progress messages and user-facing errors can be translated without
 * reading settings on every call. Kept in its own Electron-free module so
 * engine helpers stay importable from unit tests.
 *
 * `src/main/settings.ts` updates it on every load and save.
 */
let current: UiLanguage = 'ru'

export function currentUiLanguage(): UiLanguage {
  return current
}

export function setCurrentUiLanguage(lang: UiLanguage): void {
  current = lang
}
