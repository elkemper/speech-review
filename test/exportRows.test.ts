import { describe, expect, it } from 'vitest'
import { toExportDefects } from '../src/shared/exportRows'
import { DEFAULT_SETTINGS } from '../src/shared/settings'
import type { Defect } from '../src/shared/types'

function defect(overrides: Partial<Defect> = {}): Defect {
  return {
    id: 'auto-filler-w1',
    type: 'filler',
    start: 10,
    end: 11,
    wordIds: [1],
    text: 'э',
    severity: 'low',
    source: 'auto',
    confirmed: false,
    dismissed: false,
    note: '',
    ...overrides
  }
}

const playback = DEFAULT_SETTINGS.playback

describe('toExportDefects', () => {
  it('keeps only exported rows: no dismissed defects and no candidates', () => {
    const rows = toExportDefects(
      [
        defect({ id: 'a' }),
        defect({ id: 'b', dismissed: true }),
        defect({ id: 'c', candidate: true })
      ],
      playback,
      60
    )
    expect(rows.map((row) => row.id)).toEqual(['a'])
  })

  it('attaches the derived padded cut', () => {
    const [row] = toExportDefects([defect({ start: 10, end: 11 })], playback, 60)
    // Filler padding is 0.1 before and 0.2 after.
    expect(row.cutStart).toBeCloseTo(9.9, 6)
    expect(row.cutEnd).toBeCloseTo(11.2, 6)
  })

  it('lets an explicit override win over padding', () => {
    const [row] = toExportDefects([defect()], playback, 60, {
      'auto-filler-w1': { start: 9, end: 12 }
    })
    expect(row.cutStart).toBe(9)
    expect(row.cutEnd).toBe(12)
  })

  it('leaves the cut empty for a pause shorter than the kept room tone', () => {
    const [row] = toExportDefects(
      [defect({ id: 'auto-pause-w2', type: 'pause', start: 10, end: 10.5 })],
      playback,
      60
    )
    expect(row.cutStart).toBeNull()
    expect(row.cutEnd).toBeNull()
  })

  it('does not mutate the defects it receives', () => {
    const source = defect()
    toExportDefects([source], playback, 60)
    expect(source).not.toHaveProperty('cutStart')
  })
})
