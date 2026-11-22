import { describe, expect, it } from 'vitest'
import {
  CURRENT_PROJECT_VERSION,
  migrateProject,
  type RawProject
} from '../src/shared/projectMigrations'
import { DEFAULT_RULES, detectDefects } from '../src/shared/defects'
import type { Transcript, Word } from '../src/shared/types'

function word(
  id: number,
  start: number,
  end: number,
  text: string,
  kind: Word['kind'] = 'word'
): Word {
  return {
    id,
    index: id,
    text,
    normalized: text.toLowerCase(),
    start,
    end,
    duration: end - start,
    kind,
    confidence: null
  }
}

function transcriptOf(words: Word[], duration = 60): Transcript {
  return {
    version: 1,
    language: 'ru',
    sampleRate: 16000,
    duration,
    words,
    segments: [],
    text: words.map((item) => item.text).join(' ')
  }
}

/** Rules that make detection produce plain order-based ids for the fixture. */
const baseRules = { ...DEFAULT_RULES }

const transcript = transcriptOf([
  word(0, 1, 1.5, 'ну', 'filler'),
  word(1, 4, 4.4, 'да'),
  word(2, 4.6, 4.9, 'как'),
  word(3, 4.95, 5.1, 'бы')
])

function rawProject(overrides: Partial<RawProject> = {}): RawProject {
  return {
    id: 'p1',
    marks: [],
    rules: baseRules,
    cutOverrides: {},
    confirmedDefectIds: [],
    dismissedDefectIds: [],
    dismissedMarks: [],
    defectNotes: {},
    bookmarks: [],
    transcriptComplete: true,
    ...overrides
  }
}

/**
 * Legacy ids for the fixture transcript. Detection emits the multi-word filler
 * ("как бы") first, then the single filler, then the pause, so the old global
 * counter was: auto-filler-0 = "как бы", auto-filler-1 = "ну",
 * auto-pause-2 = the pause.
 */
const LEGACY = {
  multiFiller: 'auto-filler-0',
  filler: 'auto-filler-1',
  pause: 'auto-pause-2'
}

const STABLE = {
  multiFiller: 'auto-filler-w2_3',
  filler: 'auto-filler-w0',
  pause: 'auto-pause-w0_1'
}

describe('project migrations', () => {
  it('reports the current project version', () => {
    expect(CURRENT_PROJECT_VERSION).toBe(2)
  })

  it('treats an unversioned project as v0 and marks it migrated', () => {
    const result = migrateProject(rawProject(), transcript)
    expect(result.fromVersion).toBe(0)
    expect(result.migrated).toBe(true)
    expect(result.project.schemaVersion).toBe(2)
  })

  it('leaves a current project untouched', () => {
    const current = rawProject({ schemaVersion: 2 })
    const result = migrateProject(current, transcript)
    expect(result.migrated).toBe(false)
    expect(result.project).toBe(current)
  })

  it('migrates legacy reviewed ids and boundary overrides', () => {
    // A pre-v1 file has none of the new review fields.
    const legacyDocument: RawProject = {
      id: 'p1',
      marks: [],
      rules: baseRules,
      bookmarks: [],
      transcriptComplete: true,
      reviewedDefectIds: [LEGACY.pause],
      defectOverrides: { [LEGACY.pause]: { start: 3.9, end: 4.5 } }
    }

    const result = migrateProject(legacyDocument, transcript)

    expect(result.project.dismissedDefectIds).toEqual([STABLE.pause])
    expect(result.project.cutOverrides).toEqual({
      [STABLE.pause]: { start: 3.9, end: 4.5 }
    })
    expect('reviewedDefectIds' in result.project).toBe(false)
    expect('defectOverrides' in result.project).toBe(false)
  })

  it('renames order-based ids everywhere they are stored', () => {
    const result = migrateProject(
      rawProject({
        confirmedDefectIds: [LEGACY.pause],
        dismissedDefectIds: [LEGACY.filler],
        defectNotes: { [LEGACY.pause]: 'проверить' },
        cutOverrides: { [LEGACY.pause]: { start: 3.9, end: 4.5 } }
      }),
      transcript
    )

    expect(result.project.confirmedDefectIds).toEqual([STABLE.pause])
    expect(result.project.dismissedDefectIds).toEqual([STABLE.filler])
    expect(result.project.defectNotes).toEqual({ [STABLE.pause]: 'проверить' })
    expect(result.project.cutOverrides).toEqual({
      [STABLE.pause]: { start: 3.9, end: 4.5 }
    })
  })

  it('renames automatic group ids', () => {
    const grouped = detectDefects(
      transcriptOf([word(0, 1, 1.2, 'ну', 'filler'), word(1, 1.25, 1.45, 'ээ', 'filler')]),
      { ...baseRules, autoGroupEnabled: true, autoGroupGapSec: 0.3 }
    )
    const group = grouped.find((defect) => defect.groupIds)!
    const groupTranscript = transcriptOf([
      word(0, 1, 1.2, 'ну', 'filler'),
      word(1, 1.25, 1.45, 'ээ', 'filler')
    ])

    const result = migrateProject(
      rawProject({ confirmedDefectIds: [group.id] }),
      groupTranscript
    )

    expect(result.project.confirmedDefectIds).toEqual(['auto-group-auto-filler-w0'])
  })

  it('keeps ids it cannot resolve instead of dropping the user decision', () => {
    const result = migrateProject(
      rawProject({ confirmedDefectIds: ['auto-pause-99'] }),
      transcript
    )

    expect(result.project.confirmedDefectIds).toEqual(['auto-pause-99'])
  })
  it('keeps manual ids untouched', () => {
    const result = migrateProject(
      rawProject({
        confirmedDefectIds: ['manual-group-g1', 'manual-m1'],
        dismissedDefectIds: [],
        dismissedMarks: [
          {
            id: 'm1',
            type: 'manual',
            start: 2,
            end: 3,
            note: '',
            createdAt: '2026-01-01T00:00:00.000Z'
          }
        ]
      }),
      transcript
    )

    expect(result.project.confirmedDefectIds).toEqual(['manual-group-g1', 'manual-m1'])
    expect(result.project.dismissedMarks).toHaveLength(1)
  })

  it('is idempotent', () => {
    const once = migrateProject(
      rawProject({ confirmedDefectIds: [LEGACY.pause] }),
      transcript
    )
    const twice = migrateProject(once.project, transcript)

    expect(twice.migrated).toBe(false)
    expect(twice.project.confirmedDefectIds).toEqual([STABLE.pause])
  })

  it('does not invent ids without a transcript', () => {
    const result = migrateProject(
      rawProject({ confirmedDefectIds: [LEGACY.pause] }),
      undefined
    )

    expect(result.project.confirmedDefectIds).toEqual([LEGACY.pause])
  })
})
