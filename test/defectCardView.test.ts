import { describe, expect, it } from 'vitest'
import { defectCardView } from '../src/renderer/src/defectCardView'
import type { Defect } from '../src/shared/types'

function defect(extra: Partial<Defect> = {}): Defect {
  return {
    id: 'd1',
    type: 'filler',
    start: 1,
    end: 2,
    wordIds: [],
    text: 'ну',
    severity: 'medium',
    source: 'auto',
    confirmed: false,
    dismissed: false,
    note: '',
    ...extra
  }
}

describe('defect card view', () => {
  it('keeps a pending card expanded with the left rail in both playback modes', () => {
    for (const skipEnabled of [false, true]) {
      expect(defectCardView(defect(), skipEnabled)).toMatchObject({
        mode: 'pending',
        compact: false,
        fullBody: true,
        showRail: true,
        showUndo: false
      })
    }
  })

  it('collapses a confirmed card in skip mode exactly like outside it', () => {
    const outside = defectCardView(defect({ confirmed: true }), false)
    const inside = defectCardView(defect({ confirmed: true }), true)

    expect(inside).toMatchObject({
      mode: 'confirmed',
      compact: true,
      fullBody: false,
      showRail: false,
      showUndo: true
    })
    expect(inside).toEqual(outside)
  })

  it('keeps a deleted card as a thin row in every mode', () => {
    for (const skipEnabled of [false, true]) {
      expect(
        defectCardView(defect({ dismissed: true, confirmed: true }), skipEnabled)
      ).toMatchObject({
        mode: 'dismissed',
        compact: true,
        fullBody: false,
        showRail: false,
        showUndo: true
      })
    }
  })

  it('keeps the automatic group marker in skip mode', () => {
    const grouped = defect({ groupIds: ['auto-filler-0', 'auto-pause-1'] })

    expect(defectCardView(grouped, false).showGroupBadge).toBe(true)
    expect(defectCardView(grouped, true).showGroupBadge).toBe(true)
    expect(defectCardView(defect({ groupIds: ['auto-filler-0'] }), true).showGroupBadge).toBe(
      false
    )
  })

  it('does not show badges or the split action on a compact card', () => {
    const compact = defectCardView(
      defect({
        confirmed: true,
        source: 'manual',
        groupIds: ['auto-filler-0', 'auto-pause-1'],
        markIds: ['m1', 'm2']
      }),
      true
    )

    expect(compact.showGroupBadge).toBe(false)
    expect(compact.showManualBadge).toBe(false)
    expect(compact.showLogicalBadge).toBe(false)
    expect(compact.showSplit).toBe(false)
  })

  it('hides only the extra manual controls in skip mode', () => {
    const manual = defect({ source: 'manual', markIds: ['m1', 'm2'] })

    expect(defectCardView(manual, true)).toMatchObject({
      showManualBadge: false,
      showLogicalBadge: false,
      showSplit: false
    })
    expect(defectCardView(manual, false)).toMatchObject({
      showManualBadge: true,
      showLogicalBadge: true,
      showSplit: true
    })
  })
})
