import type { DefectType, Severity } from '@shared/types'

export const DEFECT_LABELS: Record<DefectType, string> = {
  filler: 'филлер',
  pause: 'пауза',
  repetition: 'повтор',
  elongation: 'растяжка',
  false_start: 'обрыв',
  vocal_sound: 'звук',
  unclear: 'неразборчиво',
  manual: 'ручная метка'
}

export const DEFECT_COLORS: Record<DefectType, string> = {
  filler: '#f59e0b',
  pause: '#38bdf8',
  repetition: '#a78bfa',
  elongation: '#f472b6',
  false_start: '#fb7185',
  vocal_sound: '#34d399',
  unclear: '#94a3b8',
  manual: '#eab308'
}

export const SEVERITY_LABELS: Record<Severity, string> = {
  low: 'низкая',
  medium: 'средняя',
  high: 'высокая'
}

export const TYPE_ORDER: DefectType[] = [
  'filler',
  'pause',
  'false_start',
  'repetition',
  'elongation',
  'vocal_sound',
  'manual',
  'unclear'
]
