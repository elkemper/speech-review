import { translate } from './i18n'
import type { RawWord, Segment, Transcript, Word, WordKind } from './types'

export const DEFAULT_SAMPLE_RATE = 16000

const EVENT_RE = /^\[[^\]]+\]$/u
const FILLER_EVENT_RE = /^\[(UH|UM|ER|HM|AH|EH|MM)\]$/iu
const SOUND_EVENT_RE =
  /^\[(LAUGHTER|LAUGH|COUGH|SIGH|BREATH|SNIFF|SMACK|CLICK|NOISE|MUSIC|APPLAUSE|CRY)\]$/iu

const SEGMENT_MAX_GAP_SEC = 0.8
const SEGMENT_MAX_WORDS = 70
const SEGMENT_MAX_DURATION_SEC = 25

export function isEventToken(text: string): boolean {
  return EVENT_RE.test(text.trim())
}

export function classifyWord(text: string): WordKind {
  const value = text.trim()
  if (!EVENT_RE.test(value)) return 'word'
  if (FILLER_EVENT_RE.test(value)) return 'filler'
  if (SOUND_EVENT_RE.test(value)) return 'vocal_sound'
  return 'event'
}

export function normalizeWord(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim()
}

/**
 * The audio.cpp JSON writer may emit a trailing comma before `]` or `}`.
 * This removes only commas that sit outside strings and are followed by a
 * closing bracket, so text content is never touched.
 */
export function stripTrailingCommas(input: string): string {
  let out = ''
  let inString = false
  let escaped = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]

    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }

    if (ch === '"') {
      inString = true
      out += ch
      continue
    }

    if (ch === ',') {
      let j = i + 1
      while (j < input.length && /\s/.test(input[j])) j++
      if (input[j] === ']' || input[j] === '}') continue
    }

    out += ch
  }

  return out
}

export function parseRawWords(jsonText: string): RawWord[] {
  const cleaned = stripTrailingCommas(jsonText.replace(/^\uFEFF/, '').trim())
  const parsed: unknown = JSON.parse(cleaned)

  let list: unknown
  if (Array.isArray(parsed)) {
    list = parsed
  } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { words?: unknown }).words)) {
    list = (parsed as { words: unknown[] }).words
  } else {
    throw new Error(translate('en', 'error.wordsNotArray'))
  }

  const words = list as Array<Record<string, unknown>>
  return words.map((item, index) => {
    const start = item.start_sample
    const end = item.end_sample
    const text = item.word
    if (typeof start !== 'number' || !Number.isFinite(start)) {
      throw new Error(translate('en', 'error.wordsStart', { index }))
    }
    if (typeof end !== 'number' || !Number.isFinite(end)) {
      throw new Error(translate('en', 'error.wordsEnd', { index }))
    }
    if (typeof text !== 'string') {
      throw new Error(translate('en', 'error.wordsWord', { index }))
    }
    const confidence = typeof item.confidence === 'number' ? item.confidence : undefined
    return {
      start_sample: Math.max(0, Math.round(start)),
      end_sample: Math.max(0, Math.round(end)),
      word: text,
      confidence
    }
  })
}

export interface BuildTranscriptOptions {
  language?: string
  sampleRate?: number
  duration?: number
}

export function buildTranscript(raw: RawWord[], options: BuildTranscriptOptions = {}): Transcript {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE
  const language = options.language ?? 'ru'

  const sorted = raw
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.start_sample - b.item.start_sample || a.index - b.index)
    .map(({ item }) => item)

  const hasConfidence = sorted.some((item) => typeof item.confidence === 'number' && item.confidence > 0)

  const words: Word[] = sorted.map((item, index) => {
    const start = item.start_sample / sampleRate
    const end = Math.max(start, item.end_sample / sampleRate)
    const text = item.word
    return {
      id: index,
      index,
      text,
      normalized: normalizeWord(text),
      start,
      end,
      duration: end - start,
      kind: classifyWord(text),
      confidence: hasConfidence ? (item.confidence ?? null) : null
    }
  })

  const lastEnd = words.length > 0 ? words[words.length - 1].end : 0
  const duration = options.duration ?? lastEnd
  const segments = groupSegments(words)

  return {
    version: 1,
    language,
    sampleRate,
    duration,
    words,
    segments,
    text: words.map((word) => word.text).join(' ')
  }
}

export function endsSentence(text: string): boolean {
  return /[.!?…]["»)]?$/u.test(text.trim())
}

function previousLexicalWord(words: Word[], index: number): Word | null {
  for (let i = index; i >= 0; i--) {
    if (words[i].kind === 'word') return words[i]
  }
  return null
}

export function groupSegments(words: Word[]): Segment[] {
  const segments: Segment[] = []
  let current: Word[] = []

  const flush = (): void => {
    if (current.length === 0) return
    const id = segments.length
    segments.push({
      id,
      start: current[0].start,
      end: current[current.length - 1].end,
      wordIds: current.map((word) => word.id),
      text: current.map((word) => word.text).join(' ')
    })
    current = []
  }

  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    if (current.length > 0) {
      const previous = current[current.length - 1]
      const gap = word.start - previous.end
      const lexical = previousLexicalWord(words, i - 1)
      const shouldSplit =
        gap > SEGMENT_MAX_GAP_SEC ||
        (lexical !== null && endsSentence(lexical.text)) ||
        current.length >= SEGMENT_MAX_WORDS ||
        word.end - current[0].start > SEGMENT_MAX_DURATION_SEC
      if (shouldSplit) flush()
    }
    current.push(word)
  }

  flush()
  return segments
}

export function findActiveWord(words: Word[], time: number): Word | null {
  if (words.length === 0) return null

  let low = 0
  let high = words.length - 1
  let found = -1

  while (low <= high) {
    const mid = (low + high) >> 1
    if (words[mid].start <= time + 0.02) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  if (found < 0) return null
  const word = words[found]
  if (time <= word.end + 0.25) return word
  return null
}

export function findSegmentIndexForWord(segments: Segment[], wordId: number): number {
  if (segments.length === 0) return -1

  let low = 0
  let high = segments.length - 1
  let found = -1

  while (low <= high) {
    const mid = (low + high) >> 1
    const segment = segments[mid]
    const first = segment.wordIds[0]
    const last = segment.wordIds[segment.wordIds.length - 1]
    if (wordId < first) {
      high = mid - 1
    } else if (wordId > last) {
      low = mid + 1
    } else {
      found = mid
      break
    }
  }

  return found
}
