import { EXPORT_FIELDS } from './settings'
import { runMigrations, type MigrationStep } from './migrations'
import type { ExportField } from './types'

/**
 * Versioned migration of the on-disk `settings.json` schema.
 *
 * Only shape changes belong here: renamed fields, removed fields and one-time
 * conversions that must happen once and be written back. Filling missing fields
 * with defaults and clamping values stays in `normalizeSettings` and runs on
 * every load.
 */

export interface RawSettings {
  schemaVersion?: number
  export?: { fields?: unknown; [key: string]: unknown }
  [key: string]: unknown
}

/** Current settings schema version. Bump together with a new step below. */
export const CURRENT_SETTINGS_VERSION = 1

/** v0 → v1: the CSV confirmation column was called `reviewed`. */
function migrateReviewedColumn(document: RawSettings): RawSettings {
  const fields = document.export?.fields
  if (!Array.isArray(fields)) return document
  return {
    ...document,
    export: {
      ...document.export,
      fields: fields.map((field) => (field === 'reviewed' ? 'confirmed' : field))
    }
  }
}

const steps: ReadonlyArray<MigrationStep<RawSettings>> = [
  { version: 1, name: 'export-reviewed-column', migrate: migrateReviewedColumn }
]

export function migrateSettings(document: RawSettings): {
  settings: RawSettings
  fromVersion: number
  migrated: boolean
} {
  const result = runMigrations(document, steps, CURRENT_SETTINGS_VERSION)
  return { settings: result.value, fromVersion: result.fromVersion, migrated: result.migrated }
}

/** Guard so a future field rename cannot silently drop an unknown column. */
export function isExportField(value: unknown): value is ExportField {
  return typeof value === 'string' && EXPORT_FIELDS.includes(value as ExportField)
}
