import { describe, expect, it } from 'vitest'
import { CURRENT_SETTINGS_VERSION, migrateSettings } from '../src/shared/settingsMigrations'

describe('settings migrations', () => {
  it('reports the current settings version', () => {
    expect(CURRENT_SETTINGS_VERSION).toBe(1)
  })

  it('renames the legacy reviewed export column to confirmed', () => {
    const result = migrateSettings({
      export: { fields: ['start_tc', 'reviewed', 'text'] }
    })

    expect(result.settings.export?.fields).toEqual(['start_tc', 'confirmed', 'text'])
    expect(result.migrated).toBe(true)
    expect(result.settings.schemaVersion).toBe(1)
  })

  it('is a no-op for a current file', () => {
    const current = { schemaVersion: 1, export: { fields: ['confirmed'] } }
    const result = migrateSettings(current)

    expect(result.migrated).toBe(false)
    expect(result.settings).toBe(current)
  })

  it('leaves a file without export fields untouched by the step', () => {
    const result = migrateSettings({})
    expect(result.settings.export).toBeUndefined()
  })

  it('is idempotent', () => {
    const once = migrateSettings({ export: { fields: ['reviewed'] } })
    const twice = migrateSettings(once.settings)

    expect(twice.migrated).toBe(false)
    expect(twice.settings.export?.fields).toEqual(['confirmed'])
  })
})
