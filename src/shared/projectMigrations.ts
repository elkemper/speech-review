import { DEFAULT_RULES, detectDefectsWithCandidates, normalizeRules } from './defects'
import { runMigrations, type MigrationStep } from './migrations'
import type {
  Bookmark,
  DefectBoundsOverride,
  DefectRules,
  DefectType,
  ManualMark,
  Transcript
} from './types'

/**
 * Versioned migration of the on-disk project metadata (`project.json`).
 *
 * The transcript is migrated together with the metadata but is not part of the
 * metadata document; it is passed to `migrateProject` because automatic defect
 * ids can only be translated with the words they were detected on.
 *
 * Every step is pure and idempotent. `loadProject` runs this once and writes
 * the result back, so a project is upgraded on disk exactly once.
 */

/** Metadata shape as written to disk. Unknown/legacy keys are allowed. */
export interface RawProject {
  schemaVersion?: number
  id?: string
  name?: string
  marks?: ManualMark[]
  rules?: DefectRules
  cutOverrides?: Record<string, DefectBoundsOverride>
  confirmedDefectIds?: string[]
  dismissedDefectIds?: string[]
  dismissedMarks?: ManualMark[]
  defectNotes?: Record<string, string>
  bookmarks?: Bookmark[]
  transcriptComplete?: boolean
  /** Legacy (pre-v1) fields. */
  reviewedDefectIds?: string[]
  defectOverrides?: Record<string, { start: number; end: number }>
}

export interface MigratedProject<T extends RawProject = RawProject> {
  project: T
  fromVersion: number
  migrated: boolean
}

/** Current project schema version. Bump together with a new step below. */
export const CURRENT_PROJECT_VERSION = 2

/** `auto-<type>-<n>` and `auto-group-<n>`, as written before v2. */
const LEGACY_AUTO_ID = /^auto-(?:group-)?[a-z_]+-\d+$/
const LEGACY_GROUP_ID = /^auto-group-(.+)$/

function isManualId(id: string): boolean {
  return id.startsWith('manual-')
}

/**
 * v0 → v1: fold the legacy `reviewedDefectIds` / `defectOverrides` fields into
 * the current state, and move deleted manual marks into the archive.
 *
 * This is what `loadProject` used to do inline. It is a no-op for a file that
 * already has the new fields.
 */
function migrateLegacyFields(document: RawProject): RawProject {
  const next: RawProject = { ...document }
  const legacyReviewed = Array.isArray(document.reviewedDefectIds)
    ? [...document.reviewedDefectIds]
    : []
  const hasNewState =
    Array.isArray(document.confirmedDefectIds) ||
    Array.isArray(document.dismissedDefectIds) ||
    Array.isArray(document.dismissedMarks)

  const confirmedDefectIds = hasNewState ? document.confirmedDefectIds ?? [] : []
  let dismissedDefectIds = hasNewState
    ? [...(document.dismissedDefectIds ?? [])]
    : legacyReviewed.filter((id) => !isManualId(id))

  // Manual deletions now live in the archive with the full mark.
  const manualDismissedIds = new Set<string>()
  for (const id of legacyReviewed) {
    if (isManualId(id)) manualDismissedIds.add(id)
  }
  for (const id of dismissedDefectIds) {
    if (isManualId(id)) manualDismissedIds.add(id)
  }
  dismissedDefectIds = dismissedDefectIds.filter((id) => !isManualId(id))

  const dismissedMarks: ManualMark[] = hasNewState ? [...(document.dismissedMarks ?? [])] : []
  const archivedIds = new Set(dismissedMarks.map((mark) => mark.id))
  const marks: ManualMark[] = []
  for (const mark of document.marks ?? []) {
    if (archivedIds.has(mark.id)) continue
    const singleId = `manual-${mark.id}`
    const groupId = mark.groupId ? `manual-group-${mark.groupId}` : null
    if (manualDismissedIds.has(singleId) || (groupId && manualDismissedIds.has(groupId))) {
      dismissedMarks.push(mark)
      archivedIds.add(mark.id)
    } else {
      marks.push(mark)
    }
  }

  next.marks = marks
  next.confirmedDefectIds = confirmedDefectIds
  next.dismissedDefectIds = dismissedDefectIds
  next.dismissedMarks = dismissedMarks
  next.cutOverrides = document.cutOverrides ?? document.defectOverrides ?? {}
  delete next.reviewedDefectIds
  delete next.defectOverrides
  return next
}

/**
 * Map every old `auto-<type>-<n>` id to its stable replacement.
 *
 * The old `n` was a global counter over every rule match in detection order,
 * including matches that were filtered out as disabled types or below-threshold
 * candidates. Re-running detection with the filters neutralised reproduces that
 * counter; `detectDefectsWithCandidates().matches` gives the matches in exactly
 * that order.
 */
export function legacyAutoIdMap(
  transcript: Transcript,
  rules: DefectRules
): Map<string, string> {
  const neutral: DefectRules = {
    ...normalizeRules(rules),
    enabledTypes: Object.fromEntries(
      Object.keys(DEFAULT_RULES.enabledTypes).map((type) => [type, true])
    ) as Record<DefectType, boolean>,
    minDurationByType: Object.fromEntries(
      Object.keys(DEFAULT_RULES.minDurationByType).map((type) => [type, 0])
    ) as Record<DefectType, number>,
    autoGroupEnabled: false,
    autoGroupGapSec: 0
  }

  const { matches } = detectDefectsWithCandidates(transcript, neutral)
  const map = new Map<string, string>()
  matches.forEach((match, index) => {
    map.set(`auto-${match.type}-${index}`, match.id)
  })
  return map
}

function translateId(id: string, map: Map<string, string>): string {
  const groupMatch = LEGACY_GROUP_ID.exec(id)
  if (groupMatch) {
    const first = map.get(groupMatch[1])
    return first ? `auto-group-${first}` : id
  }
  if (isManualId(id) || !LEGACY_AUTO_ID.test(id)) return id
  return map.get(id) ?? id
}

/** v1 → v2: rewrite order-based automatic ids to stable ids. */
function migrateAutomaticIds(document: RawProject, transcript?: Transcript): RawProject {
  if (!transcript) return document
  const map = legacyAutoIdMap(transcript, document.rules ?? DEFAULT_RULES)
  if (map.size === 0) return document

  const remapList = (ids: string[] | undefined): string[] | undefined =>
    ids?.map((id) => translateId(id, map))

  const notes = document.defectNotes
    ? Object.fromEntries(
        Object.entries(document.defectNotes).map(([id, note]) => [translateId(id, map), note])
      )
    : undefined

  const overrides = document.cutOverrides
    ? Object.fromEntries(
        Object.entries(document.cutOverrides).map(([id, bounds]) => [
          translateId(id, map),
          bounds
        ])
      )
    : undefined

  return {
    ...document,
    confirmedDefectIds: remapList(document.confirmedDefectIds),
    dismissedDefectIds: remapList(document.dismissedDefectIds),
    defectNotes: notes,
    cutOverrides: overrides
  }
}

export function migrateProject<T extends RawProject>(
  document: T,
  transcript?: Transcript
): MigratedProject<T> {
  const steps: ReadonlyArray<MigrationStep<T>> = [
    {
      version: 1,
      name: 'legacy-review-fields',
      migrate: (value) => migrateLegacyFields(value) as T
    },
    {
      version: 2,
      name: 'stable-automatic-ids',
      migrate: (value) => migrateAutomaticIds(value, transcript) as T
    }
  ]
  const result = runMigrations(document, steps, CURRENT_PROJECT_VERSION)
  return { project: result.value, fromVersion: result.fromVersion, migrated: result.migrated }
}
