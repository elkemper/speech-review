import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  buildTranscript,
  findActiveWord,
  findSegmentIndexForWord,
  parseRawWords,
  stripTrailingCommas
} from '../src/shared/transcript'
import { DEFAULT_RULES, applyDefectOverrides, countDefects, detectDefects } from '../src/shared/defects'
import type { Defect, Transcript, Word } from '../src/shared/types'

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')
}

const rawText = fixture('chunk.json')
const expectedText = fixture('out.txt').trim()

describe('transcript parser', () => {
  it('tolerates a trailing comma before the closing bracket', () => {
    expect(stripTrailingCommas('{"a":1,}')).toBe('{"a":1}')
    expect(stripTrailingCommas('[{"a":1},]')).toBe('[{"a":1}]')
    expect(stripTrailingCommas('{"a":",]"}')).toBe('{"a":",]"}')
  })

  it('parses the real audio.cpp words output', () => {
    const raw = parseRawWords(rawText)
    expect(raw).toHaveLength(80)
    expect(raw[0]).toMatchObject({ start_sample: 21760, end_sample: 27200, word: '[UH]' })
    expect(raw[raw.length - 1].word).toBe('бизнес-пуризнес')
  })

  it('builds seconds, words and segments', () => {
    const transcript = buildTranscript(parseRawWords(rawText), {
      language: 'ru',
      sampleRate: 16000
    })

    expect(transcript.words).toHaveLength(80)
    expect(transcript.words[0].start).toBeCloseTo(1.36, 3)
    expect(transcript.words[transcript.words.length - 1].end).toBeCloseTo(39.54, 3)
    expect(transcript.text).toBe(expectedText)

    const covered = transcript.segments.flatMap((segment) => segment.wordIds)
    expect(covered).toEqual(transcript.words.map((word) => word.id))
    expect(transcript.segments.map((segment) => segment.text).join(' ')).toBe(expectedText)
  })

  it('marks unsupported confidence as null instead of zero', () => {
    const transcript = buildTranscript(parseRawWords(rawText))
    expect(transcript.words.every((word) => word.confidence === null)).toBe(true)
  })

  it('classifies event tokens', () => {
    const transcript = buildTranscript(parseRawWords(rawText))
    const events = transcript.words.filter((word) => word.kind !== 'word')
    expect(events.map((word) => word.text)).toEqual([
      '[UH]',
      '[UM]',
      '[UH]',
      '[UH]',
      '[UH]',
      '[UH]'
    ])
    expect(events.every((word) => word.kind === 'filler')).toBe(true)
  })

  it('finds the active word and its segment', () => {
    const transcript = buildTranscript(parseRawWords(rawText))
    const active = findActiveWord(transcript.words, 2.7)
    expect(active?.text).toBe('три')
    const segmentIndex = findSegmentIndexForWord(transcript.segments, active!.id)
    expect(segmentIndex).toBeGreaterThanOrEqual(0)
    expect(transcript.segments[segmentIndex].wordIds).toContain(active!.id)
  })
})

describe('defect rules', () => {
  const transcript = buildTranscript(parseRawWords(rawText))
  const defects = detectDefects(transcript, DEFAULT_RULES)

  it('finds fillers, pauses and the false start', () => {
    const counts = countDefects(defects)
    expect(counts.filler).toBe(6)
    expect(counts.pause).toBe(3)
    expect(counts.false_start).toBe(1)
    expect(defects).toHaveLength(10)
  })

  it('does not flag the sentence-boundary pause after "пользу."', () => {
    const pauseAfterSentence = defects.find(
      (defect) => defect.type === 'pause' && Math.abs(defect.start - 32.96) < 0.01
    )
    expect(pauseAfterSentence).toBeUndefined()
  })

  it('places the detected pauses at the real gaps', () => {
    const pauses = defects
      .filter((defect) => defect.type === 'pause')
      .map((defect) => Number(defect.start.toFixed(2)))
    expect(pauses).toEqual([7.48, 20.96, 34.3])
  })

  it('finds the cut-off word', () => {
    const falseStart = defects.find((defect) => defect.type === 'false_start')
    expect(falseStart?.text).toBe('Вит-')
    expect(falseStart?.start).toBeCloseTo(36.25, 2)
  })

  it('does not invent repetition, elongation or vocal sound defects', () => {
    const counts = countDefects(defects)
    expect(counts.repetition).toBe(0)
    expect(counts.elongation).toBe(0)
    expect(counts.vocal_sound).toBe(0)
    expect(counts.unclear).toBe(0)
  })

  it('keeps manual marks separate from automatic defects', () => {
    const withMark = detectDefects(transcript, DEFAULT_RULES, [
      {
        id: 'mark-1',
        type: 'manual',
        start: 10,
        end: 11,
        note: 'Проверить',
        createdAt: new Date(0).toISOString()
      }
    ])
    const manual = withMark.filter((defect) => defect.source === 'manual')
    expect(manual).toHaveLength(1)
    expect(manual[0].text).toBe('Проверить')
    expect(manual[0].wordIds.length).toBeGreaterThan(0)
  })
})

describe('manual mark boundaries', () => {
  function word(id: number, start: number, end: number, text: string): Word {
    return {
      id,
      index: id,
      text,
      normalized: text,
      start,
      end,
      duration: end - start,
      kind: 'word',
      confidence: null
    }
  }

  const words = [
    word(0, 1, 1.5, 'ну'),
    word(1, 1.5, 2, 'да'),
    word(2, 2, 2.5, 'вот')
  ]
  const transcript: Transcript = {
    version: 1,
    language: 'ru',
    sampleRate: 16000,
    duration: 10,
    words,
    segments: [],
    text: 'ну да вот'
  }

  it('uses stored word ids and does not pull in touching neighbours', () => {
    const mark = {
      id: 'm',
      type: 'manual' as const,
      start: 1.5,
      end: 2,
      wordIds: [1],
      note: '',
      createdAt: new Date(0).toISOString()
    }
    const manual = detectDefects(transcript, DEFAULT_RULES, [mark]).find(
      (defect) => defect.source === 'manual'
    )
    expect(manual?.wordIds).toEqual([1])
  })

  it('falls back to strict overlap for old marks without word ids', () => {
    const mark = {
      id: 'm',
      type: 'manual' as const,
      start: 1.5,
      end: 2,
      note: '',
      createdAt: new Date(0).toISOString()
    }
    const manual = detectDefects(transcript, DEFAULT_RULES, [mark]).find(
      (defect) => defect.source === 'manual'
    )
    expect(manual?.wordIds).toEqual([1])
  })

  it('keeps dismissed manual marks in the computed list for restore and focus', () => {
    const mark = {
      id: 'm',
      type: 'manual' as const,
      start: 1.5,
      end: 2,
      wordIds: [1],
      note: 'удалённая',
      createdAt: new Date(0).toISOString()
    }
    const manual = detectDefects(transcript, DEFAULT_RULES, [], {
      dismissedMarks: [mark]
    }).find((defect) => defect.source === 'manual')
    expect(manual).toMatchObject({
      id: 'manual-m',
      dismissed: true,
      wordIds: [1],
      note: 'удалённая'
    })
  })
})

describe('automatic defect boundary overrides', () => {
  const base: Defect[] = [
    {
      id: 'defect-1',
      type: 'pause',
      start: 4,
      end: 6,
      wordIds: [],
      text: '',
      severity: 'medium',
      source: 'auto',
      confirmed: false,
      dismissed: false,
      note: ''
    },
    {
      id: 'defect-2',
      type: 'filler',
      start: 10,
      end: 11,
      wordIds: [3],
      text: 'ну',
      severity: 'medium',
      source: 'auto',
      confirmed: false,
      dismissed: false,
      note: ''
    }
  ]

  it('returns the original array when there are no overrides', () => {
    expect(applyDefectOverrides(base, undefined)).toBe(base)
    expect(applyDefectOverrides(base, {})).toBe(base)
  })

  it('replaces only the edited defect bounds', () => {
    const result = applyDefectOverrides(base, { 'defect-1': { start: 4.5, end: 5.2 } })
    expect(result[0]).toMatchObject({ id: 'defect-1', start: 4.5, end: 5.2 })
    expect(result[1]).toBe(base[1])
  })

  it('normalizes reversed override bounds', () => {
    const result = applyDefectOverrides(base, { 'defect-2': { start: 12, end: 9 } })
    expect(result[1]).toMatchObject({ start: 9, end: 12 })
  })
})

describe('logical manual marks in defect detection', () => {
  it('combines marks with the same group id into one manual defect', () => {
    const transcript: Transcript = {
      version: 1,
      language: 'ru',
      sampleRate: 16000,
      duration: 10,
      words: [
        {
          id: 0,
          index: 0,
          text: 'ну',
          normalized: 'ну',
          start: 1,
          end: 1.5,
          duration: 0.5,
          kind: 'word',
          confidence: null
        },
        {
          id: 1,
          index: 1,
          text: 'вот',
          normalized: 'вот',
          start: 1.7,
          end: 2.2,
          duration: 0.5,
          kind: 'word',
          confidence: null
        }
      ],
      segments: [],
      text: 'ну вот'
    }

    const manual = detectDefects(transcript, DEFAULT_RULES, [
      {
        id: 'a',
        type: 'manual',
        start: 1,
        end: 1.5,
        wordIds: [0],
        groupId: 'g',
        note: 'первая',
        createdAt: new Date(0).toISOString()
      },
      {
        id: 'b',
        type: 'manual',
        start: 1.7,
        end: 2.2,
        wordIds: [1],
        groupId: 'g',
        note: 'вторая',
        createdAt: new Date(0).toISOString()
      }
    ]).filter((defect) => defect.source === 'manual')

    expect(manual).toHaveLength(1)
    expect(manual[0]).toMatchObject({
      id: 'manual-group-g',
      start: 1,
      end: 2.2,
      wordIds: [0, 1],
      markIds: ['a', 'b'],
      note: 'первая · вторая'
    })
  })
})
