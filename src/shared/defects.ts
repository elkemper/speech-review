import { translate, type UiLanguage } from './i18n'
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
  // A pause has no separate threshold: this is the shortest silence that
  // becomes a pause defect at all.
  pause: 1.2,
  repetition: 0,
  elongation: 0,
  false_start: 0,
  vocal_sound: 0,
  unclear: 0,
  manual: 0
}

export const MIN_PAUSE_MIN_DURATION = 0.3
export const MAX_PAUSE_MIN_DURATION = 10

/** Every type is detected by default; `unclear` stays off until confidence is real. */
export const DEFAULT_ENABLED_TYPES: Record<DefectType, boolean> = {
  filler: true,
  pause: true,
  repetition: true,
  elongation: true,
  false_start: true,
  vocal_sound: true,
  unclear: false,
  manual: true
}

/**
 * Recognition language of the filler lexicons. `Settings.language` and
 * `Project.language` carry this value; anything unknown falls back to Russian.
 */
export type FillerLanguage = 'ru' | 'en'

/**
 * Filler lexicons are recognition data, not interface copy: the ASR language
 * decides which words are fillers, independent of `Settings.uiLanguage`.
 * They are not part of the message catalogue and are never translated.
 */
export const FILLER_LEXICONS: Record<
  FillerLanguage,
  { fillerWords: string[]; multiWordFillers: string[][] }
> = {
  ru: {
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
    ]
  },
  en: {
    fillerWords: [
      'uh',
      'uhh',
      'uhm',
      'um',
      'umm',
      'er',
      'erm',
      'ah',
      'eh',
      'hm',
      'hmm',
      'mm',
      'mhm',
      'like',
      'actually',
      'basically',
      'literally',
      'right',
      'okay',
      'so',
      'well',
      'y\'know'
    ],
    multiWordFillers: [
      ['you', 'know'],
      ['i', 'mean'],
      ['kind', 'of'],
      ['sort', 'of'],
      ['you', 'see']
    ]
  }
}

/** Normalizes a recognition language to one of the supported lexicons. */
export function fillerLanguage(language: unknown): FillerLanguage {
  return typeof language === 'string' && language.toLowerCase().startsWith('en') ? 'en' : 'ru'
}

/** Default filler words for a recognition language. */
export function defaultFillerWords(language: unknown): string[] {
  return [...FILLER_LEXICONS[fillerLanguage(language)].fillerWords]
}

/** Default multi-word fillers for a recognition language. */
export function defaultMultiWordFillers(language: unknown): string[][] {
  return FILLER_LEXICONS[fillerLanguage(language)].multiWordFillers.map((phrase) => [...phrase])
}

export const DEFAULT_RULES: DefectRules = {
  fillerWords: defaultFillerWords('ru'),
  multiWordFillers: defaultMultiWordFillers('ru'),
  excludePauseAfterSentenceEnd: true,
  repetitionWindowSec: 2.0,
  elongationMinRepeats: 3,
  detectLexicalFillers: true,
  lowConfidenceThreshold: 0.45,
  minDurationByType: { ...DEFAULT_MIN_DURATION_BY_TYPE },
  enabledTypes: { ...DEFAULT_ENABLED_TYPES },
  autoGroupEnabled: false,
  autoGroupGapSec: 0
}

/** Default rules for a recognition language, with a fresh copy of every list. */
export function defaultRulesForLanguage(language: unknown): DefectRules {
  return {
    ...DEFAULT_RULES,
    fillerWords: defaultFillerWords(language),
    multiWordFillers: defaultMultiWordFillers(language),
    minDurationByType: { ...DEFAULT_MIN_DURATION_BY_TYPE },
    enabledTypes: { ...DEFAULT_ENABLED_TYPES }
  }
}

/**
 * True when the stored filler lists are exactly the defaults of this language.
 * Opening a project in a different recognition language can then swap the
 * lexicon without discarding a customized word list.
 */
export function usesDefaultFillers(rules: DefectRules, language: unknown): boolean {
  const words = rules.fillerWords.map(normalizeWord)
  const expectedWords = defaultFillerWords(language).map(normalizeWord)
  if (words.length !== expectedWords.length) return false
  if (!words.every((word, index) => word === expectedWords[index])) return false
  const phrases = rules.multiWordFillers.map((phrase) => phrase.map(normalizeWord).join(' '))
  const expectedPhrases = defaultMultiWordFillers(language).map((phrase) =>
    phrase.map(normalizeWord).join(' ')
  )
  return (
    phrases.length === expectedPhrases.length &&
    phrases.every((phrase, index) => phrase === expectedPhrases[index])
  )
}

/** True when the filler lists are an untouched default of any known language. */
export function usesAnyDefaultFillers(rules: DefectRules): boolean {
  return (Object.keys(FILLER_LEXICONS) as FillerLanguage[]).some((language) =>
    usesDefaultFillers(rules, language)
  )
}

/**
 * Adopts the filler lexicon of a language while keeping every other rule.
 * A list the user has edited is preserved: only an untouched default list
 * (of any language) is replaced, so switching RU→EN swaps the default words
 * but never silently drops a custom list.
 */
export function adoptFillerLanguage(rules: DefectRules, language: unknown): DefectRules {
  if (!usesAnyDefaultFillers(rules)) return rules
  const target = fillerLanguage(language)
  if (usesDefaultFillers(rules, target)) return rules
  return {
    ...rules,
    fillerWords: defaultFillerWords(target),
    multiWordFillers: defaultMultiWordFillers(target)
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/**
 * Rules are stored inside both settings and projects. Projects written by older
 * builds miss the newer nested fields, so they are merged field by field
 * instead of a shallow spread that would drop defaults. `language` is the
 * recognition language; it only supplies the filler lexicon when the stored
 * lists are absent.
 */
export function normalizeRules(value: unknown, language: unknown = 'ru'): DefectRules {
  // Obsolete keys from the old pause-threshold model are dropped, not migrated:
  // there are no released users yet. The pause minimum is the only threshold.
  const source = { ...((value ?? {}) as Record<string, unknown>) }
  delete source.pauseThresholdSec
  delete source.pauseHighSec
  const raw = source as Partial<DefectRules>
  const minDuration: Record<DefectType, number> = { ...DEFAULT_MIN_DURATION_BY_TYPE }
  const rawMin = (raw.minDurationByType ?? {}) as Partial<Record<DefectType, number>>
  for (const type of DEFECT_TYPE_ORDER) {
    if (type === 'pause') {
      const rawPause = rawMin.pause
      minDuration.pause =
        typeof rawPause === 'number' && Number.isFinite(rawPause) && rawPause > 0
          ? clampNumber(
              rawPause,
              MIN_PAUSE_MIN_DURATION,
              MAX_PAUSE_MIN_DURATION,
              DEFAULT_MIN_DURATION_BY_TYPE.pause
            )
          : DEFAULT_MIN_DURATION_BY_TYPE.pause
    } else {
      minDuration[type] = clampNumber(rawMin[type], 0, 10, DEFAULT_MIN_DURATION_BY_TYPE[type])
    }
  }
  const enabledTypes: Record<DefectType, boolean> = { ...DEFAULT_ENABLED_TYPES }
  const rawEnabled = (raw.enabledTypes ?? {}) as Partial<Record<DefectType, boolean>>
  for (const type of DEFECT_TYPE_ORDER) {
    if (typeof rawEnabled[type] === 'boolean') enabledTypes[type] = rawEnabled[type]
  }
  // Older rules only had the gap. A positive gap meant "grouping is on".
  const autoGroupGapSec = clampNumber(raw.autoGroupGapSec, 0, 10, DEFAULT_RULES.autoGroupGapSec)
  const autoGroupEnabled =
    typeof raw.autoGroupEnabled === 'boolean'
      ? raw.autoGroupEnabled
      : autoGroupGapSec > 0
  return {
    ...DEFAULT_RULES,
    ...raw,
    fillerWords: Array.isArray(raw.fillerWords)
      ? raw.fillerWords.filter((word): word is string => typeof word === 'string')
      : defaultFillerWords(language),
    multiWordFillers: Array.isArray(raw.multiWordFillers)
      ? raw.multiWordFillers.filter(
          (phrase): phrase is string[] =>
            Array.isArray(phrase) && phrase.every((word) => typeof word === 'string')
        )
      : defaultMultiWordFillers(language),
    minDurationByType: minDuration,
    enabledTypes,
    autoGroupEnabled,
    autoGroupGapSec
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

export function compareDefects(a: Defect, b: Defect): number {
  if (a.start !== b.start) return a.start - b.start
  const typeDelta = DEFECT_TYPE_ORDER.indexOf(a.type) - DEFECT_TYPE_ORDER.indexOf(b.type)
  if (typeDelta !== 0) return typeDelta
  const severityDelta = severityRank(a.severity) - severityRank(b.severity)
  if (severityDelta !== 0) return severityDelta
  return a.id.localeCompare(b.id)
}

export function sortDefects(defects: Defect[]): Defect[] {
  return [...defects].sort(compareDefects)
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

/**
 * Stable automatic defect id.
 *
 * The id is derived from the defect type and the words it covers, not from the
 * detection order: changing a threshold, a filler word or a type toggle must
 * not move an existing confirmation, deletion, note or cut edit onto a
 * different defect. A word may produce more than one defect (for example a
 * repetition and a false start), so a collision gets a `-2`, `-3` suffix in
 * detection order. Order-based suffixes are only used inside one detection
 * pass; the base id stays stable.
 */
export function autoDefectId(type: DefectType, wordIds: number[]): string {
  const words = wordIds.length > 0 ? wordIds.join('_') : 'x'
  return `auto-${type}-w${words}`
}

function uniqueAutoDefectId(
  type: DefectType,
  wordIds: number[],
  used: Set<string>
): string {
  const base = autoDefectId(type, wordIds)
  let id = base
  let suffix = 2
  while (used.has(id)) {
    id = `${base}-${suffix++}`
  }
  used.add(id)
  return id
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
    confirmed: false,
    dismissed: false,
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

export interface DetectDefectsOptions {
  /** Automatic defect IDs deleted by the user. */
  dismissedIds?: Iterable<string>
  /** Interface language for the fallback text of a mark without words. */
  uiLanguage?: UiLanguage
  /** Manual marks deleted by the user, kept so their cards can be restored. */
  dismissedMarks?: ManualMark[]
  /**
   * Automatic IDs that must survive the minimum-duration filter. The renderer
   * fills this from overrides, review state and notes, so an explicitly edited
   * candidate stays a real defect.
   */
  promotedIds?: Iterable<string>
}

/** A rule match suppressed by a type toggle or the minimum-duration rule. */
export interface DefectCandidate extends Defect {
  reason: 'type-disabled' | 'min-duration'
  measuredSec: number
}

export interface DetectDefectsResult {
  defects: Defect[]
  candidates: DefectCandidate[]
  /**
   * Every rule match in detection order, before type toggles, minimum
   * durations and grouping. Used to translate order-based ids written by older
   * builds into stable ids.
   */
  matches: Array<{ type: DefectType; wordIds: number[]; id: string }>
}

/** Manual defects built from marks, shared by active and dismissed lists. */
export function buildManualDefects(
  words: Word[],
  marks: ManualMark[],
  uiLanguage: UiLanguage = 'ru'
): Defect[] {
  const wordById = new Map(words.map((word) => [word.id, word]))
  return groupManualMarks(marks).map((group) => {
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
      text: group.note.trim() || selectedText || translate(uiLanguage, 'defect.manual'),
      severity: 'medium',
      source: 'manual',
      confirmed: false,
      dismissed: false,
      note: group.note
    }
  })
}

export function detectDefects(
  transcript: Transcript,
  rules: DefectRules = DEFAULT_RULES,
  marks: ManualMark[] = [],
  options: DetectDefectsOptions = {}
): Defect[] {
  return detectDefectsWithCandidates(transcript, rules, marks, options).defects
}

export function detectDefectsWithCandidates(
  transcript: Transcript,
  rules: DefectRules = DEFAULT_RULES,
  marks: ManualMark[] = [],
  options: DetectDefectsOptions = {}
): DetectDefectsResult {
  const words = transcript.words
  const auto: Defect[] = []
  const candidates: DefectCandidate[] = []
  const claimed = new Set<number>()
  const dismissed = new Set(options.dismissedIds ?? [])
  const promoted = new Set([...dismissed, ...(options.promotedIds ?? [])])
  const promotedCandidates = new Set<string>()
  const usedIds = new Set<string>()
  /** Every rule match in detection order, filtered out or not. */
  const matches: Array<{ type: DefectType; wordIds: number[]; id: string }> = []

  const add = (
    type: DefectType,
    start: number,
    end: number,
    wordIds: number[],
    text: string,
    severity: Severity,
    measuredSec = Math.max(start, end) - start
  ): void => {
    const id = uniqueAutoDefectId(type, wordIds, usedIds)
    matches.push({ type, wordIds: [...wordIds], id })
    const defect: Defect = {
      id,
      type,
      start,
      end: Math.max(start, end),
      wordIds,
      text,
      severity,
      source: 'auto',
      confirmed: false,
      dismissed: false,
      note: ''
    }
    if (rules.enabledTypes?.[type] === false) {
      candidates.push({ ...defect, reason: 'type-disabled', measuredSec })
      return
    }
    const min = rules.minDurationByType?.[type] ?? 0
    if (measuredSec + 1e-9 < min) {
      if (!promoted.has(id)) {
        candidates.push({ ...defect, reason: 'min-duration', measuredSec })
        return
      }
      promotedCandidates.add(id)
    }
    auto.push(defect)
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

  const rawPauseMin = rules.minDurationByType?.pause
  const pauseMin =
    typeof rawPauseMin === 'number' && Number.isFinite(rawPauseMin) && rawPauseMin > 0
      ? rawPauseMin
      : DEFAULT_MIN_DURATION_BY_TYPE.pause
  for (let i = 0; i < words.length - 1; i++) {
    const previous = words[i]
    const next = words[i + 1]
    const gap = next.start - previous.end
    // The pause minimum is a hard detection threshold: shorter gaps are not
    // defects and do not become hidden candidates.
    if (gap < pauseMin) continue
    if (rules.excludePauseAfterSentenceEnd && endsSentence(previous.text)) continue
    add(
      'pause',
      previous.end,
      next.start,
      [previous.id, next.id],
      `${previous.text} … ${next.text}`,
      'medium'
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

  const uiLanguage = options.uiLanguage ?? 'ru'
  const activeManual = buildManualDefects(words, marks, uiLanguage)
  const dismissedManual = buildManualDefects(words, options.dismissedMarks ?? [], uiLanguage).map(
    (defect) => ({ ...defect, dismissed: true })
  )

  const seen = new Set<string>()
  const groupGap = rules.autoGroupEnabled ? rules.autoGroupGapSec ?? 0 : 0
  const activeAuto = auto.filter((defect) => !dismissed.has(defect.id))
  const dismissedAuto = auto
    .filter((defect) => dismissed.has(defect.id))
    .map((defect) => ({ ...defect, dismissed: true }))
  // A candidate promoted from below the threshold stays a standalone card, so
  // its id does not abruptly turn into an automatic-group id while selected.
  const groupedActive = groupAutoDefects(
    activeAuto.filter((defect) => !promotedCandidates.has(defect.id)),
    groupGap,
    words
  )
  const groupedDismissed = groupAutoDefects(
    dismissedAuto.filter((defect) => !promotedCandidates.has(defect.id)),
    groupGap,
    words
  ).map((defect) => ({ ...defect, dismissed: true }))
  const promotedAuto = activeAuto.filter((defect) => promotedCandidates.has(defect.id))
  const promotedDismissed = dismissedAuto.filter((defect) =>
    promotedCandidates.has(defect.id)
  )
  const defects = sortDefects([
    ...groupedActive,
    ...promotedAuto,
    ...groupedDismissed,
    ...promotedDismissed,
    ...activeManual,
    ...dismissedManual
  ]).filter((defect) => {
    const key =
      defect.source === 'manual'
        ? defect.id
        : `${defect.type}|${defect.start.toFixed(2)}|${defect.end.toFixed(2)}|${defect.wordIds.join(',')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return {
    defects,
    candidates: candidates.sort(compareDefects),
    matches
  }
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
