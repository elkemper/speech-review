import { useMemo } from 'react'
import { translate, type MessageKey, type TParams, type UiLanguage } from '@shared/i18n'
import { useApp } from './store'

export function useUiLanguage(): UiLanguage {
  return useApp((state) => state.settings.uiLanguage)
}

/**
 * Returns a translator bound to the current UI language. The function identity
 * changes only when the language changes, so components can rely on it.
 */
export function useT(): (key: MessageKey, params?: TParams) => string {
  const lang = useUiLanguage()
  return useMemo(() => (key: MessageKey, params?: TParams) => translate(lang, key, params), [lang])
}
