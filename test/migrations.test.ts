import { describe, expect, it } from 'vitest'
import { readSchemaVersion, runMigrations } from '../src/shared/migrations'

interface Doc {
  schemaVersion?: number
  value: string
  log?: string[]
}

const steps = [
  {
    version: 1,
    name: 'first',
    migrate: (doc: Doc): Doc => ({ ...doc, value: `${doc.value}+1`, log: [...(doc.log ?? []), '1'] })
  },
  {
    version: 2,
    name: 'second',
    migrate: (doc: Doc): Doc => ({ ...doc, value: `${doc.value}+2`, log: [...(doc.log ?? []), '2'] })
  }
]

describe('schema versioning', () => {
  it('treats a missing version as zero', () => {
    expect(readSchemaVersion({})).toBe(0)
    expect(readSchemaVersion({ schemaVersion: 3 })).toBe(3)
    expect(readSchemaVersion({ schemaVersion: '3' })).toBe(0)
    expect(readSchemaVersion(null)).toBe(0)
  })

  it('runs every step in order up to the target version', () => {
    const result = runMigrations<Doc>({ value: 'base' }, steps, 2)
    expect(result.value.value).toBe('base+1+2')
    expect(result.value.log).toEqual(['1', '2'])
    expect(result.fromVersion).toBe(0)
    expect(result.migrated).toBe(true)
    expect(result.value.schemaVersion).toBe(2)
  })

  it('skips steps the document already has', () => {
    const result = runMigrations<Doc>({ value: 'base', schemaVersion: 1 }, steps, 2)
    expect(result.value.value).toBe('base+2')
    expect(result.fromVersion).toBe(1)
  })

  it('is a no-op for a current document', () => {
    const input = { value: 'base', schemaVersion: 2 }
    const result = runMigrations<Doc>(input, steps, 2)
    expect(result.migrated).toBe(false)
    expect(result.value).toBe(input)
  })

  it('does not run steps newer than the target', () => {
    const result = runMigrations<Doc>({ value: 'base' }, steps, 1)
    expect(result.value.value).toBe('base+1')
    expect(result.value.schemaVersion).toBe(1)
  })

  it('is idempotent', () => {
    const once = runMigrations<Doc>({ value: 'base' }, steps, 2)
    const twice = runMigrations<Doc>(once.value, steps, 2)
    expect(twice.migrated).toBe(false)
    expect(twice.value).toBe(once.value)
  })

  it('leaves the target version to the caller', () => {
    const result = runMigrations<Doc>({ value: 'base' }, steps, 2)
    expect(result.value.schemaVersion).toBe(2)
  })
})
