import { describe, expect, it } from 'vitest'
import { matchesDefectFilter } from '../src/shared/defects'
import type { DefectType } from '../src/shared/types'

function defect(type: DefectType, groupTypes?: DefectType[]): {
  type: DefectType
  groupTypes?: DefectType[]
} {
  return groupTypes ? { type, groupTypes } : { type }
}

describe('matchesDefectFilter', () => {
  it('shows every defect under the all filter', () => {
    expect(matchesDefectFilter(defect('filler'), 'all')).toBe(true)
    expect(matchesDefectFilter(defect('pause'), 'all')).toBe(true)
    expect(matchesDefectFilter(defect('manual'), 'all')).toBe(true)
  })

  it('matches the defect own type', () => {
    expect(matchesDefectFilter(defect('filler'), 'filler')).toBe(true)
    expect(matchesDefectFilter(defect('filler'), 'pause')).toBe(false)
  })

  it('matches any type inside an automatic group', () => {
    const group = defect('filler', ['filler', 'pause'])
    expect(matchesDefectFilter(group, 'filler')).toBe(true)
    expect(matchesDefectFilter(group, 'pause')).toBe(true)
    expect(matchesDefectFilter(group, 'repetition')).toBe(false)
  })

  it('keeps manual marks visible only under their own chip or all', () => {
    expect(matchesDefectFilter(defect('manual'), 'manual')).toBe(true)
    expect(matchesDefectFilter(defect('manual'), 'filler')).toBe(false)
  })

  it('never treats a disabled or unknown type as matching another chip', () => {
    expect(matchesDefectFilter(defect('unclear'), 'filler')).toBe(false)
    expect(matchesDefectFilter(defect('unclear'), 'unclear')).toBe(true)
  })
})
