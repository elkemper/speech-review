import type {
  Defect,
  DefectRules,
  DefectType,
  ManualMark,
  Severity,
  Transcript,
  Word
} from './types'
import { endsSentence, normalizeWord } from './transcript'

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
  lowConfidenceThreshold: 0.45
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

function findWordIdsInRange(words: Word[], start: number, end: number): number[] {
  // Strict overlap: a word that only touches the mark boundary is not part of
  // it. Inclusive comparisons used to pull the previous/next word into marks.
  const epsilon = 1e-6
  return words
    .filter((word) => word.end > start + epsilon && word.start < end - epsilon)
    .map((word) => word.id)
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
    severity: Severity
  ): void => {
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
      'medium'
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
  const manual: Defect[] = marks.map((mark) => {
    const stored = Array.isArray(mark.wordIds)
      ? mark.wordIds.filter((id) => wordById.has(id))
      : null
    const wordIds = stored && stored.length > 0 ? stored : findWordIdsInRange(words, mark.start, mark.end)
    const selectedText = wordIds
      .map((id) => wordById.get(id)?.text ?? '')
      .filter(Boolean)
      .join(' ')
    return {
      id: `manual-${mark.id}`,
      type: mark.type,
      start: mark.start,
      end: Math.max(mark.start, mark.end),
      wordIds,
      text: mark.note.trim() || selectedText || 'Ручная метка',
      severity: 'medium',
      source: 'manual',
      reviewed: false,
      note: mark.note
    }
  })

  const seen = new Set<string>()
  return [...auto, ...manual]
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

export function countDefects(defects: Defect[]): Record<DefectType, number> {
  const counts = Object.fromEntries(DEFECT_TYPE_ORDER.map((type) => [type, 0])) as Record<
    DefectType,
    number
  >
  for (const defect of defects) counts[defect.type]++
  return counts
}
