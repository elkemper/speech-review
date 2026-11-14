// The cut model lives in `src/shared/cuts.ts` so the main process can reuse the
// exact same list for a future video export. Renderer code keeps importing from
// here to avoid touching every call site.
export {
  buildCutList,
  buildCutMap,
  buildSkipIntervals,
  complementRanges,
  cutRangeFor,
  cutView,
  intervalAt,
  isGroupedDefect,
  mergeRanges,
  MIN_PAUSE_CUT_SEC,
  paddingFor,
  subtractRanges
} from '@shared/cuts'
export type { CutRange, CutView } from '@shared/cuts'
