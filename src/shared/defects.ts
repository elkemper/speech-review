import type {
  Defect,
  DefectBoundsOverride,
  DefectRules,
  DefectType,
  ManualMark,
  Severity,
  Transcript,
  Word
} from './types'
import { endsSentence, normalizeWord } from './transcript'
import { groupManualMarks } from './marks'

export const AUTO_DEFECT_TYPES: DefectType[] = [
  'filler',
  'pause',
  'repetition',
  'elongation',
  'false_start',
  'vocal_sound',
  'unclear'
]

export const DEFAULT_MIN_DURATION_BY_TYPE: Record<DefectType, number> = {
  filler: 0,
  pause: 0,
  repetition: 0,
  elongation: 0,
  false_start: 0,
  vocal_sound: 0,
  unclear: 0,
  manual: 0
}

export const DEFAULT_RULES: DefectRules = {
  fillerWords: [
    'э',
    'ээ',
    'эээ',
    'эм',
    'мм',
    'м',
    'ну',
    'вот',
    'типа',
    'короче',
    'значит',
    'собственно',
    'ага',
    'угу'
  ],
  multiWordFillers: [
    ['как', 'бы'],
    ['в', 'общем'],
    ['это', 'самое'],
    ['так', 'сказать']
  ],
  pauseThresholdSec: 1.2,
  pauseHighSec: 2.0,
  excludePauseAfterSentenceEnd: true,
  repetitionWindowSec: 2.0,
  elongationMinRepeats: 3,
  detectLexicalFillers: true,
  lowConfidenceThreshold: 0.45,
  minDurationByType: { ...DEFAULT_MIN_DURATION_BY_TYPE },
  autoGroupGapSec: 0
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/**
 * Rules are stored inside both settings and projects. Projects written by older
 * builds miss the newer nested fields, so they are merged field by field
 * instead of a shallow spread that would drop defaults.
 */
export function normalizeRules(value: unknown): DefectRules {
  const raw = (value ?? {}) as Partial<DefectRules>
  const minDuration: Record<DefectType, number> = { ...DEFAULT_MIN_DURATION_BY_TYPE }
  const rawMin = (raw.minDurationByType ?? {}) as Partial<Record<DefectType, number>>
  for (const type of DEFECT_TYPE_ORDER) {
    minDuration[type] = clampNumber(rawMin[type], 0, 10, DEFAULT_MIN_DURATION_BY_TYPE[type])
  }
  return {
    ...DEFAULT_RULES,
    ...raw,
    fillerWords: Array.isArray(raw.fillerWords)
      ? raw.fillerWords.filter((word): word is string => typeof word === 'string')
      : [...DEFAULT_RULES.fillerWords],
    multiWordFillers: Array.isArray(raw.multiWordFillers)
      ? raw.multiWordFillers.filter(
          (phrase): phrase is string[] =>
            Array.isArray(phrase) && phrase.every((word) => typeof word === 'string')
        )
      : DEFAULT_RULES.multiWordFillers.map((phrase) => [...phrase]),
    minDurationByType: minDuration,
    autoGroupGapSec: clampNumber(raw.autoGroupGapSec, 0, 10, DEFAULT_RULES.autoGroupGapSec)
  }
}

export const DEFECT_TYPE_ORDER: DefectType[] = [
  'filler',
  'pause',
  'repetition',
  'elongation',
  'false_start',
  'vocal_sound',
  'unclear',
  'manual'
]

function severityRank(value: Severity): number {
  return value === 'high' ? 0 : value === 'medium' ? 1 : 2
}

function isElongated(text: string, minRepeats: number): boolean {
  const threshold = Math.max(2, Math.floor(minRepeats) - 1)
  const re = new RegExp(`(\\p{L})\\1{${threshold},}`, 'u')
  return re.test(text.toLowerCase())
}

function isFalseStart(text: string): boolean {
  const value = text.trim()
  return value.length > 2 && /^[\p{L}\p{N}]+-$/u.test(value)
}

export function findWordIdsInRange(words: Word[], start: number, end: number): number[] {
  // Strict overlap: a word that only touches the mark boundary is not part of
  // it. Inclusive comparisons used to pull the previous/next word into marks.
  const epsilon = 1e-6
  return words
    .filter((word) => word.end > start + epsilon && word.start < end - epsilon)
    .map((word) => word.id)
}

/** Any real spoken word fully inside the gap blocks automatic grouping. */
function hasWordBetween(words: Word[], from: number, to: number): boolean {
  if (to <= from) return false
  const epsilon = 1e-6
  return words.some(
    (word) =>
      word.kind === 'word' &&
      word.duration > epsilon &&
      word.start >= from - epsilon &&
      word.end <= to + epsilon
  )
}

function mergedSeverity(group: Defect[]): Severity {
  if (group.some((defect) => defect.severity === 'high')) return 'high'
  if (group.some((defect) => defect.severity === 'medium')) return 'medium'
  return 'low'
}

function mergeAutoGroup(group: Defect[]): Defect {
  const first = group.reduce((a, b) => (a.start <= b.start ? a : b))
  return {
    id: `auto-group-${first.id}`,
    type: first.type,
    start: Math.min(...group.map((defect) => defect.start)),
    end: Math.max(...group.map((defect) => defect.end)),
    wordIds: [...new Set(group.flatMap((defect) => defect.wordIds))],
    groupIds: group.map((defect) => defect.id),
    groupTypes: [...new Set(group.map((defect) => defect.type))],
    text: group
      .map((defect) => defect.text)
      .filter(Boolean)
      .join(' · '),
    severity: mergedSeverity(group),
    source: 'auto',
    reviewed: false,
    note: ''
  }
}

/**
 * Automatic grouping: neighbouring defects become one logical item when the gap
 * between them is small and no real word sits inside that gap. A pause defect
 * spans only the silence, so a filler right before the pause groups with it,
 * while a spoken word between them prevents grouping.
 */
export function groupAutoDefects(
  defects: Defect[],
  gapSec: number,
  words: Word[]
): Defect[] {
  if (gapSec <= 0 || defects.length < 2) return defects
  const sorted = [...defects].sort((a, b) => a.start - b.start)
  const result: Defect[] = []
  let group: Defect[] = []

  const flush = (): void => {
    if (group.length === 1) result.push(group[0])
    else if (group.length > 1) result.push(mergeAutoGroup(group))
    group = []
  }

  for (const defect of sorted) {
    if (group.length === 0) {
      group.push(defect)
      continue
    }
    const groupEnd = Math.max(...group.map((item) => item.end))
    const gap = defect.start - groupEnd
    if (gap <= gapSec + 1e-6 && !hasWordBetween(words, groupEnd, defect.start)) {
      group.push(defect)
    } else {
      flush()
      group.push(defect)
    }
  }
  flush()
  return result
}

export function detectDefects(
  transcript: Transcript,
  rules: DefectRules = DEFAULT_RULES,
  marks: ManualMark[] = []
): Defect[] {
  const words = transcript.words
  const auto: Defect[] = []
  const claimed = new Set<number>()
  let sequence = 0

  const add = (
    type: DefectType,
    start: number,
    end: number,
    wordIds: number[],
    text: string,
    severity: Severity,
    measuredSec = Math.max(start, end) - start
  ): void => {
    const min = rules.minDurationByType?.[type] ?? 0
    if (measuredSec + 1e-9 < min) return
    auto.push({
      id: `auto-${type}-${sequence++}`,
      type,
      start,
      end: Math.max(start, end),
      wordIds,
      text,
      severity,
      source: 'auto',
      reviewed: false,
      note: ''
    })
  }

  if (rules.detectLexicalFillers) {
    for (let i = 0; i < words.length; i++) {
      for (const phrase of rules.multiWordFillers) {
        if (phrase.length < 2) continue
        let matches = true
        for (let k = 0; k < phrase.length; k++) {
          const word = words[i + k]
          if (
            !word ||
            word.kind !== 'word' ||
            word.normalized !== normalizeWord(phrase[k])
          ) {
            matches = false
            break
          }
        }
        if (!matches) continue

        const matched = words.slice(i, i + phrase.length)
        for (const word of matched) claimed.add(word.id)
        add(
          'filler',
          matched[0].start,
          matched[matched.length - 1].end,
          matched.map((word) => word.id),
          matched.map((word) => word.text).join(' '),
          'low'
        )
        i += phrase.length - 1
        break
      }
    }
  }

  for (const word of words) {
    if (word.kind === 'filler') {
      add('filler', word.start, word.end, [word.id], word.text, 'high')
    } else if (word.kind === 'vocal_sound' || word.kind === 'event') {
      add('vocal_sound', word.start, word.end, [word.id], word.text, 'low')
    }
  }

  if (rules.detectLexicalFillers) {
    const fillerSet = new Set(rules.fillerWords.map(normalizeWord).filter(Boolean))
    for (const word of words) {
      if (word.kind !== 'word' || claimed.has(word.id)) continue
      if (fillerSet.has(word.normalized)) {
        add('filler', word.start, word.end, [word.id], word.text, 'low')
      }
    }
  }

  for (let i = 0; i < words.length - 1; i++) {
    const previous = words[i]
    const next = words[i + 1]
    const gap = next.start - previous.end
    if (gap < rules.pauseThresholdSec) continue
    if (rules.excludePauseAfterSentenceEnd && endsSentence(previous.text)) continue
    add(
      'pause',
      previous.end,
      next.start,
      [previous.id, next.id],
      `${previous.text} … ${next.text}`,
      gap >= rules.pauseHighSec ? 'high' : 'medium'
    )
  }

  for (let i = 1; i < words.length; i++) {
    const previous = words[i - 1]
    const current = words[i]
    if (previous.kind !== 'word' || current.kind !== 'word') continue
    if (!previous.normalized || previous.normalized !== current.normalized) continue
    if (current.start - previous.end > rules.repetitionWindowSec) continue
    add(
      'repetition',
      previous.start,
      current.end,
      [previous.id, current.id],
      `${previous.text} ${current.text}`,
      'medium',
      Math.min(previous.duration, current.duration)
    )
  }

  for (const word of words) {
    if (word.kind !== 'word') continue
    if (isElongated(word.text, rules.elongationMinRepeats)) {
      add('elongation', word.start, word.end, [word.id], word.text, 'medium')
    }
  }

  for (const word of words) {
    if (word.kind !== 'word') continue
    if (isFalseStart(word.text)) {
      add('false_start', word.start, word.end, [word.id], word.text, 'medium')
    }
  }

  if (rules.lowConfidenceThreshold > 0) {
    for (const word of words) {
      if (word.kind !== 'word' || word.confidence === null) continue
      if (word.confidence < rules.lowConfidenceThreshold) {
        add('unclear', word.start, word.end, [word.id], word.text, 'medium')
      }
    }
  }

  const wordById = new Map(words.map((word) => [word.id, word]))
  const manual: Defect[] = groupManualMarks(marks).map((group) => {
    const wordIds = [
      ...new Set(
        group.marks.flatMap((mark) => {
          const stored = Array.isArray(mark.wordIds)
            ? mark.wordIds.filter((id) => wordById.has(id))
            : []
          return stored.length > 0 ? stored : findWordIdsInRange(words, mark.start, mark.end)
        })
      )
    ]
    const selectedText = wordIds
      .map((id) => wordById.get(id)?.text ?? '')
      .filter(Boolean)
      .join(' ')
    return {
      id: group.groupId
        ? `manual-group-${group.groupId}`
        : `manual-${group.marks[0].id}`,
      type: group.marks[0].type,
      start: group.start,
      end: Math.max(group.start, group.end),
      wordIds,
      markIds: group.marks.map((mark) => mark.id),
      text: group.note.trim() || selectedText || 'Ручная метка',
      severity: 'medium',
      source: 'manual',
      reviewed: false,
      note: group.note
    }
  })

  const seen = new Set<string>()
  const grouped = groupAutoDefects(auto, rules.autoGroupGapSec ?? 0, words)
  return [...grouped, ...manual]
    .filter((defect) => {
      const key =
        defect.source === 'manual'
          ? defect.id
          : `${defect.type}|${defect.start.toFixed(2)}|${defect.end.toFixed(2)}|${defect.wordIds.join(',')}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start
      const typeDelta = DEFECT_TYPE_ORDER.indexOf(a.type) - DEFECT_TYPE_ORDER.indexOf(b.type)
      if (typeDelta !== 0) return typeDelta
      return severityRank(a.severity) - severityRank(b.severity)
    })
}

export function applyDefectOverrides(
  defects: Defect[],
  overrides: Record<string, DefectBoundsOverride> | undefined
): Defect[] {
  if (!overrides || Object.keys(overrides).length === 0) return defects
  return defects.map((defect) => {
    const override = overrides[defect.id]
    if (!override) return defect
    return {
      ...defect,
      start: Math.min(override.start, override.end),
      end: Math.max(override.start, override.end)
    }
  })
}

export function countDefects(defects: Defect[]): Record<DefectType, number> {
  const counts = Object.fromEntries(DEFECT_TYPE_ORDER.map((type) => [type, 0])) as Record<
    DefectType,
    number
  >
  for (const defect of defects) {
    const types = defect.groupTypes ?? [defect.type]
    for (const type of new Set(types)) counts[type]++
  }
  return counts
}
