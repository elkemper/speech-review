import type { Defect, DefectType, Severity } from '@shared/types'
import type { DefectCandidate } from '@shared/defects'

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

/**
 * Tooltip for a word that only carries a hidden candidate. Such a word keeps
 * its kind styling hint but is not a defect and is not cut by skip mode.
 */
export function candidateHint(candidate: DefectCandidate, minSec: number): string {
  if (candidate.reason === 'type-disabled') {
    return `${DEFECT_LABELS[candidate.type]} · тип выключен · не пропускается`
  }
  const measured = Math.max(0, candidate.measuredSec).toFixed(2)
  return `${DEFECT_LABELS[candidate.type]} · ниже порога ${measured} c < ${minSec.toFixed(
    2
  )} c · не пропускается`
}

/**
 * The defect/mark that owns each word, used for colored underlays on the
 * timelines. Pauses are excluded because they describe a gap, not words.
 * A manual mark wins over an automatic defect when both cover a word.
 */
export function defectByWordId<T extends Defect>(defects: T[]): Map<number, T> {
  const map = new Map<number, T>()
  for (const defect of defects) {
    if (defect.type === 'pause') continue
    for (const wordId of defect.wordIds) {
      const current = map.get(wordId)
      if (!current || (current.source === 'auto' && defect.source === 'manual')) {
        map.set(wordId, defect)
      }
    }
  }
  return map
}
