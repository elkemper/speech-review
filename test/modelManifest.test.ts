import { describe, expect, it } from 'vitest'
import {
  BUILTIN_VERSION,
  compareVersions,
  MODEL_SPECS,
  parseManifest,
  resolveSpecs
} from '../src/shared/models'
import { normalizeModelVersions } from '../src/shared/settings'
import { diffEntry, nextVersion } from '../scripts/model-manifest-lib.mjs'

const VALID_ENTRY = {
  id: 'q8_0',
  version: '2026.12.1',
  releasedAt: '2026-12-01',
  file: 'crisperwhisper-2-large-q8_0.gguf',
  size: 1999999999,
  sha256: 'a'.repeat(64),
  url: 'https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/main/CrisperWhisper2.0-GGUF/crisperwhisper-2-large-q8_0.gguf'
}

describe('parseManifest', () => {
  it('accepts a valid manifest', () => {
    const manifest = parseManifest({
      formatVersion: 1,
      generatedAt: '2026-12-01T00:00:00.000Z',
      models: [VALID_ENTRY]
    })
    expect(manifest).not.toBeNull()
    expect(manifest?.models).toHaveLength(1)
    expect(manifest?.models[0].version).toBe('2026.12.1')
  })

  it('rejects wrong formatVersion, non-object values and empty model lists', () => {
    expect(parseManifest(null)).toBeNull()
    expect(parseManifest('x')).toBeNull()
    expect(parseManifest({ formatVersion: 2, models: [VALID_ENTRY] })).toBeNull()
    expect(parseManifest({ formatVersion: 1, models: [] })).toBeNull()
    expect(parseManifest({ formatVersion: 1 })).toBeNull()
  })

  it('drops entries without a valid sha256, size or https url', () => {
    const noHash = parseManifest({
      formatVersion: 1,
      models: [{ ...VALID_ENTRY, sha256: 'not-a-hash' }]
    })
    expect(noHash).toBeNull()

    const noSize = parseManifest({
      formatVersion: 1,
      models: [{ ...VALID_ENTRY, size: -1 }]
    })
    expect(noSize).toBeNull()

    const httpUrl = parseManifest({
      formatVersion: 1,
      models: [{ ...VALID_ENTRY, url: 'http://example.com/m.gguf' }]
    })
    expect(httpUrl).toBeNull()
  })

  it('drops entries with unknown model ids but keeps the valid ones', () => {
    const manifest = parseManifest({
      formatVersion: 1,
      models: [{ ...VALID_ENTRY, id: 'q9_9' }, VALID_ENTRY]
    })
    expect(manifest?.models).toHaveLength(1)
    expect(manifest?.models[0].id).toBe('q8_0')
  })
})

describe('compareVersions', () => {
  it('orders calendar versions numerically', () => {
    expect(compareVersions('2026.12.1', '2026.11.1')).toBeGreaterThan(0)
    expect(compareVersions('2026.11.2', '2026.11.10')).toBeLessThan(0)
    expect(compareVersions('2026.11.1', '2026.11.1')).toBe(0)
  })

  it('treats unknown installed versions as the oldest', () => {
    expect(compareVersions(BUILTIN_VERSION, 'unknown')).toBeGreaterThan(0)
    expect(compareVersions('unknown', '2020.1.1')).toBeLessThan(0)
  })
})

describe('resolveSpecs', () => {
  it('returns built-in specs with the builtin version without a manifest', () => {
    const specs = resolveSpecs(null)
    expect(specs.q8_0.sha256).toBe(MODEL_SPECS.q8_0.sha256)
    expect(specs.q8_0.size).toBe(MODEL_SPECS.q8_0.size)
    expect(specs.q8_0.version).toBe(BUILTIN_VERSION)
  })

  it('overrides the built-in spec when the manifest describes another build', () => {
    const specs = resolveSpecs(parseManifest({ formatVersion: 1, models: [VALID_ENTRY] }))
    expect(specs.q8_0.sha256).toBe(VALID_ENTRY.sha256)
    expect(specs.q8_0.size).toBe(VALID_ENTRY.size)
    expect(specs.q8_0.version).toBe('2026.12.1')
    expect(specs.bf16.version).toBe(BUILTIN_VERSION)
    expect(specs.bf16.sha256).toBe(MODEL_SPECS.bf16.sha256)
  })

  it('keeps the built-in spec when the manifest entry matches it', () => {
    const entry = {
      ...VALID_ENTRY,
      size: MODEL_SPECS.q8_0.size,
      sha256: MODEL_SPECS.q8_0.sha256
    }
    const specs = resolveSpecs(parseManifest({ formatVersion: 1, models: [entry] }))
    expect(specs.q8_0.sha256).toBe(MODEL_SPECS.q8_0.sha256)
    // The manifest version still labels the installed build.
    expect(specs.q8_0.version).toBe('2026.12.1')
  })
})

describe('normalizeModelVersions', () => {
  it('keeps only known ids with non-empty versions', () => {
    expect(
      normalizeModelVersions({ q8_0: '2026.12.1', bf16: '', q9_9: '1.0', q4_k: 5 })
    ).toEqual({ q8_0: '2026.12.1' })
  })

  it('returns an empty record for missing or non-object values', () => {
    expect(normalizeModelVersions(undefined)).toEqual({})
    expect(normalizeModelVersions('x')).toEqual({})
  })
})

describe('manifest script helpers', () => {
  it('suggests the next patch version within the current month', () => {
    const today = new Date('2026-12-05T00:00:00Z')
    expect(nextVersion(today, ['2026.11.3', '2026.12.1'])).toBe('2026.12.2')
    expect(nextVersion(today, ['2026.11.3'])).toBe('2026.12.1')
    expect(nextVersion(today, [])).toBe('2026.12.1')
  })

  it('detects size and hash drift against live HF metadata', () => {
    const entry = { size: 100, sha256: 'a'.repeat(64) }
    expect(diffEntry(entry, { size: 100, sha256: 'a'.repeat(64) })).toBeNull()
    expect(diffEntry(entry, { size: 200, sha256: 'a'.repeat(64) })).toEqual({
      sizeChanged: true,
      hashChanged: false
    })
    expect(diffEntry(entry, { size: 200, sha256: 'b'.repeat(64) })).toEqual({
      sizeChanged: true,
      hashChanged: true
    })
  })
})
