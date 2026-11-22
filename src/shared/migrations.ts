/**
 * Small, file-format-agnostic schema migration runner.
 *
 * State files (`project.json`, `settings.json`) carry a `schemaVersion`.
 * A file without one is treated as version 0. Each migration step upgrades the
 * document by exactly one version and must be pure and idempotent, so a step
 * can be re-run safely if the process dies before the file is written back.
 *
 * Steps live next to the format they belong to (`projectMigrations.ts`,
 * `settingsMigrations.ts`), not here: this module knows nothing about their
 * contents.
 */

export interface MigrationStep<T> {
  /** The version this step produces. Steps run in ascending order. */
  version: number
  /** Stable name used in logs and tests. */
  name: string
  migrate: (document: T) => T
}

export interface MigrationResult<T> {
  value: T
  fromVersion: number
  /** True when at least one step ran, so the caller should write the file back. */
  migrated: boolean
}

export function readSchemaVersion(value: unknown): number {
  if (!value || typeof value !== 'object') return 0
  const version = (value as { schemaVersion?: unknown }).schemaVersion
  return typeof version === 'number' && Number.isFinite(version) && version >= 0
    ? Math.floor(version)
    : 0
}

export function runMigrations<T extends { schemaVersion?: number }>(
  document: T,
  steps: readonly MigrationStep<T>[],
  targetVersion: number
): MigrationResult<T> {
  const fromVersion = readSchemaVersion(document)
  if (fromVersion >= targetVersion) {
    return { value: document, fromVersion, migrated: false }
  }

  const ordered = [...steps].sort((a, b) => a.version - b.version)
  let value = document
  for (const step of ordered) {
    if (step.version <= fromVersion || step.version > targetVersion) continue
    value = step.migrate(value)
    value = { ...value, schemaVersion: step.version }
  }

  return { value, fromVersion, migrated: true }
}
