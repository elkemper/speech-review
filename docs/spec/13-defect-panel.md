# 13 — Review panel

[Index](../SPEC.md) · Prev: [12 — Interface language](12-i18n.md)

The right panel is the review surface: the defect queue, the type chips, the
card actions and the in-panel snippet. Its individual behaviours live in the
files that own them; this file owns the panel as a whole and the view filters
that reach from it into the timelines and the transcript.

**Files:** `src/shared/defects.ts`, `src/renderer/src/components/DefectPanel.tsx`,
`src/renderer/src/components/Timeline.tsx`,
`src/renderer/src/components/MiniTimeline.tsx`,
`src/renderer/src/components/Transcript.tsx`,
`src/renderer/src/components/Workspace.tsx`,
`src/renderer/src/timelineView.ts`.
**Tests:** `test/defectFilter.test.ts`, `test/filteredDefectAlpha.test.ts`.

## Panel map

Where each panel behaviour is specified; do not duplicate it here.

| Surface | Story |
|---|---|
| Deleted cards hidden unless `showDismissed` | [Story 3](01-settings.md) |
| Bulk confirm/delete of a selection | [Story 11](03-marks.md) |
| Panel width drag and hide/show | [Story 31](07-layout-history-visual.md) |
| CSV / JSON / video export buttons | [Stories 38, 39, 48](09-export.md) |
| In-panel snippet with editable cut handles | [Story 40](10-mini-timeline.md) |
| Card confirm/delete actions and compact rows | [Story 45](03-marks.md) |
| Revealed minimum-duration candidate card | [Story 46](02-defects.md) |
| Type chips as a display-only view filter | Story 55 (below) |

## Stories

### Story 55 — Type filter across the whole review surface

**Status:** Done · **Priority:** P1

As a user, I want the type chips in the right panel to focus the review, so the
timeline, the mini-timeline and the only-with-defects transcript all show the
same type I am working through.

- The filter is `store.filter`: `'all'` or one `DefectType`.
- `matchesDefectFilter(defect, filter)` in `src/shared/defects.ts` is the single
  predicate: `'all'`, the defect's own type, or any type in `groupTypes`.
- The right panel, the main timeline, the mini-timeline neighbours and the
  transcript in «только с дефектами» mode use it.
- **Display only.** The filter never changes detection, cuts, skip intervals,
  padding, playback or export; those stay driven by every non-deleted defect.
- Timeline: matching defects draw normally. Non-matching defects remain as a
  faint boundary hint that fades in only at close zoom
  (`filteredDefectAlpha`), so the user can still tell a border sits nearby.
  Their hatching is muted by the same alpha. Hit-testing and cut-handle drags
  only pick matching defects.
- The transcript applies the filter only while «только с дефектами» is on, so
  a segment stays only because of a matching defect.
- When the active card stops matching the filter, `activeDefectId` is cleared.
- The `manual` chip works like any other type; it is a filter, not the
  detection switch in `rules.enabledTypes`.
- The filter is not persisted and not part of undo/redo.

## Acceptance criteria

### Story 55

- [ ] Chip «филлер» shows only filler markers/underlays in the main timeline.
- [ ] Non-matching timeline markers are invisible at an overview and a faint
      boundary hint at close zoom.
- [ ] Skip mode still cuts every type regardless of the filter.
- [ ] The mini-timeline neighbours follow the filter.
- [ ] With «только с дефектами» on, only segments with a matching defect stay.
- [ ] With «только с дефектами» off, the transcript is unchanged.
- [ ] Choosing a type that hides the active card clears the active item.
- [ ] Exported CSV/JSON and video cuts do not depend on the filter.
- [ ] Transcript rows never overlap after filtering rows in or out.
