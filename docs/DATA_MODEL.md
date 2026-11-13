# Data Model and Persistence

This document describes what is stored where, which identifiers are used, and which rules must not be broken when making changes.

## 1. Data locations

Everything lives in Electron `userData` (on macOS — `~/Library/Application Support/Speech Review/`):

```
Speech Review/
├── settings.json
├── models/
│   └── CrisperWhisper2.0-GGUF/
│       ├── crisperwhisper-2-large-q8_0.gguf
│       ├── crisperwhisper-2-large-q8_0.gguf.sha256
│       └── …
├── projects/
│   └── <uuid>/
│       ├── project.json
│       ├── transcript.json
│       └── peaks.json
└── tmp/
    └── jobs/<jobId>/
        ├── audio.wav
        ├── chunk-000.wav
        ├── chunk-000.txt
        └── chunk-000.json
```

- The video file is not copied or modified. The project stores an absolute path.
- The job's temporary folder is removed after completion or cancellation.
- Deleting a project in the app deletes its folder entirely.
- Models can be deleted in settings; the `.sha256` marker and `.part` file are removed with the model.

## 2. Settings (`settings.json`)

`Settings` type:

| Field | Default | Meaning |
|---|---|---|
| `language` | `ru` | transcription language |
| `modelId` | `q8_0` | `q8_0` / `bf16` / `q4_k` |
| `backend` | `metal` | `metal` / `cpu` |
| `rules` | `DEFAULT_RULES` | defect rules |
| `chunkTargetSec` | `600` | target chunk length, 120–900 s |
| `export` | see below | CSV fields and format |
| `playback` | see below | skip mode and padding |
| `miniTimelinePadSec` | `3` | context on each side of the selected defect in the mini timeline |
| `waveformContrast` | `55` | display-only waveform contrast, 0 = linear |
| `showDismissed` | `true` | show deleted defects as thin cards with restore |

`DEFAULT_RULES` (`src/shared/defects.ts`):

```ts
{
  fillerWords: ['э', 'ээ', 'эээ', 'эм', 'мм', 'м', 'ну', 'вот',
                'типа', 'короче', 'значит', 'собственно', 'ага', 'угу'],
  multiWordFillers: [['как', 'бы'], ['в', 'общем'], ['это', 'самое'], ['так', 'сказать']],
  excludePauseAfterSentenceEnd: true,
  repetitionWindowSec: 2.0,
  elongationMinRepeats: 3,
  detectLexicalFillers: true,
  lowConfidenceThreshold: 0.45,
  minDurationByType: { filler: 0, pause: 1.2, repetition: 0, elongation: 0,
                       false_start: 0, vocal_sound: 0, unclear: 0, manual: 0 },
  enabledTypes: { filler: true, pause: true, repetition: true, elongation: true,
                  false_start: true, vocal_sound: true, unclear: false, manual: true },
  autoGroupEnabled: false,
  autoGroupGapSec: 0
}
```

`minDurationByType` sets the shortest reported defect for each type. For `pause` it is the silence length and the only pause threshold: shorter gaps are not defects and do not become candidates. For `repetition` it is the shorter of the two repeated words; `0` means no limit, except for `pause`, where `0`/missing normalizes to 1.2 s and the range is 0.3–10 s. `enabledTypes` turns a whole automatic type off for the project; missing entries mean on, and `manual` is never filtered. `autoGroupEnabled` is the grouping switch; `autoGroupGapSec` is the largest gap at which neighbouring automatic defects become one group. The gap value is kept while grouping is off, and `0` also disables grouping at the data level.

`export`:

- `fields` — CSV field order; all fields by default;
- `delimiter` — `;` or `,`;
- `includeHeader` — `true` by default.

`playback`:

- `skipEnabled` — `false` by default;
- `skipBeforeSec` / `skipAfterSec` — global fallback, 0–5 s, defaults 0.15 / 0.35;
- `pauseKeepSec` — room tone kept inside a standalone pause, 0–3 s, default 0.4; split evenly between both edges, `0` removes the whole silence;
- `paddingByType` — `Record<DefectType, { before, after }>`; defaults give a pause `0/0` and a filler `0.1/0.2`;
- `groupPadding` — `{ before, after }` for a logical group, default 0.15 / 0.35.

For a pause the keep is applied as negative padding, so the cut shrinks by
`pauseKeepSec`; the pause type padding still adds on top. A cut shorter than
0.2 s is skipped instead of performed.

Padding is resolved when skip intervals are built and does not depend on `skipEnabled`: the controls stay editable even when skip mode is off.

`loadSettings` is tolerant of old or broken files:

- an unknown `modelId`/`backend` is replaced with the default;
- `rules` is merged with missing `DEFAULT_RULES` fields;
- `chunkTargetSec` is rounded and clamped to 120–900;
- `export.fields` is filtered to known fields; an empty list is replaced with the full list; the legacy `reviewed` field is migrated to `confirmed`;
- `playback` is normalized by `normalizePlaybackSettings`: every per-type padding entry is filled from the defaults, padding values are clamped to 0–5 s and `pauseKeepSec` is clamped to 0–3 s;
- `miniTimelinePadSec` is clamped to 0–15 s (`normalizeMiniTimelinePad`);
- `waveformContrast` is rounded and clamped to 0–100 (`normalizeWaveformContrast`);
- `rules` is normalized by `normalizeRules`: missing `minDurationByType` entries and `autoGroupGapSec` are added, values are clamped (pause 0.3–10 s, with 0/missing becoming 1.2 s), missing `enabledTypes` entries default to on, obsolete `pauseThresholdSec`/`pauseHighSec` keys are dropped, and old rules with a positive gap migrate to `autoGroupEnabled: true`.

`saveSettings` writes `settings.json.tmp`, then renames it to `settings.json`. Format — JSON with 2-space indentation.

## 3. Project (`project.json`)

`project.json` stores metadata and editable state. The transcript is **not** included: `metaOf()` strips the `transcript` field before writing.

| Field | Type | Description |
|---|---|---|
| `id` | string | project folder UUID |
| `name` | string | file name without extension |
| `video` | `MediaInfo` | `path`, `name`, `size`, `mtimeMs` |
| `duration` | number | duration from ffmpeg, seconds |
| `language` | string | language at creation/transcription time |
| `modelId` | `ModelId` | selected model |
| `backend` | `Backend` | `metal` or `cpu` |
| `createdAt` | ISO string | creation time |
| `updatedAt` | ISO string | last write |
| `marks` | `ManualMark[]` | manual marks |
| `rules` | `DefectRules` | rules at project time |
| `defectOverrides` | `Record<string, {start,end}>` | edited automatic defect boundaries |
| `confirmedDefectIds` | string[] | defects/marks confirmed as real |
| `dismissedDefectIds` | string[] | automatic defects deleted as false positives |
| `dismissedMarks` | `ManualMark[]` | deleted manual marks kept for restore |
| `defectNotes` | `Record<string, string>` | notes by defect ID |
| `bookmarks` | `Bookmark[]` | navigation markers: `id`, `time`, `note`, `createdAt` |
| `transcriptComplete` | boolean | whether the transcript is final |
| `transcript` | `Transcript?` | **in memory only**, loaded from `transcript.json` |

Project creation:

1. `projects:create` checks ffmpeg, the audio track and the duration;
2. name is `basename(path, extname(path))`;
3. `rules`, `language`, `modelId`, `backend` come from current settings;
4. `marks`, `defectOverrides`, `confirmedDefectIds`, `dismissedDefectIds`, `dismissedMarks`, `defectNotes` and `bookmarks` are empty;
5. `transcriptComplete: false`.

Loading:

- missing `marks`, `defectOverrides`, `confirmedDefectIds`, `dismissedDefectIds`, `dismissedMarks`, `defectNotes`, `bookmarks`, `transcriptComplete` are filled with safe values;
- a project written before this lifecycle change has `reviewedDefectIds` and no new fields. Those ids migrate to `dismissedDefectIds` (automatic) and `dismissedMarks` (manual) because the old checkmark meant "checked and considered not a defect"; `confirmedDefectIds` starts empty;
- manual ids that were stored in `dismissedDefectIds` by an intermediate build are moved to `dismissedMarks`;
- `rules` is merged with `DEFAULT_RULES`;
- `transcript.json` is read separately; if it is missing or broken, `transcript` is not set and `transcriptComplete` is forced to `false`;
- `peaks.json` is read separately; on error `peaks = null`.

`listProjects` reads all subdirectories, ignores broken/unrelated directories and sorts by `updatedAt` descending.

## 4. Transcript (`transcript.json`)

```ts
interface Transcript {
  version: 1
  language: string
  sampleRate: number      // 16000
  duration: number
  words: Word[]
  segments: Segment[]
  text: string
}
```

`Word`:

| Field | Description |
|---|---|
| `id` | dense index assigned after sorting by time |
| `index` | same value as `id` |
| `text` | original word/event text |
| `normalized` | lowercase, `ё → е`, punctuation removed |
| `start`, `end`, `duration` | seconds |
| `kind` | `word`, `filler`, `vocal_sound`, `event` |
| `confidence` | number or `null` |

`confidence` is `null` if the engine response contains no positive value at all. This matters: `audiocpp_cli` currently writes `0`, and `0` means "no data", not "poor recognition".

`Segment` is built by `groupSegments`:

- gap greater than 0.8 s;
- previous lexical word ends with `.`, `?`, `!` or `…`;
- more than 70 words;
- segment duration greater than 25 s.

`parseRawWords`:

- accepts an array or an object `{ words: [...] }`;
- strips BOM and a trailing comma before `]`/`}` (without touching strings);
- requires numeric `start_sample`/`end_sample` and a string `word`;
- rounds samples and clamps negative values to 0.

`transcribeChunk` adds the chunk offset to samples: `offsetSec * 16000`. This puts every word on the global recording timeline.

## 5. Waveform (`peaks.json`)

```ts
interface Peaks {
  peaksPerSecond: number   // 20
  duration: number
  min: number[]            // -1…1
  max: number[]            // -1…1
}
```

`computePeaks` supports 16-bit WAV only. Empty buckets are written as `0/0`. Peaks are non-critical: if they cannot be built, transcription continues and the timeline shows only markers and words.

## 6. Defects

`Defect` is a computed representation and is not stored in `project.json`. It is assembled in the renderer:

```ts
detectDefectsWithCandidates(transcript, rules, marks, {
  dismissedIds: project.dismissedDefectIds,
  dismissedMarks: project.dismissedMarks,
  promotedIds // overrides + review ids + note keys, automatic IDs only
})
  → applyDefectOverrides(defectResult.defects, project.defectOverrides)
  → inject confirmed/dismissed/note from the project sets
  → append the active minimum-duration candidate as `candidate: true`
```

`detectDefects` remains a thin wrapper that returns only `defects`.

Fields:

| Field | Description |
|---|---|
| `id` | `auto-${type}-${sequence}` or `manual-${markId}` / `manual-group-${groupId}` |
| `type` | `filler`, `pause`, `repetition`, `elongation`, `false_start`, `vocal_sound`, `unclear`, `manual` |
| `start`, `end` | seconds |
| `wordIds` | words the defect refers to |
| `markIds` | manual only: IDs of all marks in the logical group |
| `groupIds` | automatic grouping only: IDs of the underlying automatic defects |
| `groupTypes` | automatic grouping only: every type inside the group |
| `text` | defect text/note |
| `severity` | `low`, `medium`, `high` |
| `source` | `auto` or `manual` |
| `confirmed` | confirmed as a real defect; does not affect skip |
| `dismissed` | deleted as a false positive; excluded from skip and export |
| `candidate` | computed only: a suppressed minimum-duration detection is revealed for preview; never persisted |
| `note` | filled in by the renderer |

Automatic IDs are **not stable**: `sequence` is the global insertion order. Changing rules or re-transcribing can shift the numbering. This is a known limitation; see `docs/BACKLOG.md`.

`dismissedDefectIds` and `dismissedMarks` are applied inside `detectDefects`. Active automatic defects are grouped without dismissed members; deleted automatic and manual items are returned separately with `dismissed: true` so their thin cards can be restored and focused from the transcript. A deleted automatic group stores both the group ID and member IDs.

A minimum-duration candidate is a rule match that did not pass the per-type filter. It keeps the same `auto-${type}-${sequence}` ID as it would have at a lower threshold. The renderer reveals one candidate at a time when `activeDefectId` matches it and computes `candidate: true`; the candidate is not persisted. Any explicit edit or review action (bounds override, confirmation, deletion, note) puts the ID into `promotedIds`, so the next detection pass returns it as a normal defect and it survives a switch or reload.

`applyDefectOverrides`:

- returns the same array if overrides are empty;
- replaces only matching IDs;
- normalizes reversed bounds (`start = min`, `end = max`).

## 7. Manual marks

```ts
interface ManualMark {
  id: string          // UUID
  type: DefectType    // currently always 'manual'
  start: number
  end: number
  wordIds?: number[]  // exact selected words; may be missing on old marks
  groupId?: string    // shared group for a logical mark
  note: string
  createdAt: string
}
```

Rules:

- When added, a mark gets the exact `wordIds` and boundaries of the selected words. If there is no selection, the playhead position and a 1.5 s range are used.
- `mergeMarkNeighbours` merges only **changed** marks with those they touch within a gap of ≤ 0.2 s. Merging happens on add and on boundary move.
- If a changed mark no longer touches its group, it leaves the group (`groupId = undefined`). Old adjacent marks that the user explicitly split do not merge by themselves.
- `splitManualGroup` removes `groupId` from every mark in the group. The group note is copied to each single mark.
- `removeDefect` moves all marks in a manual group to `dismissedMarks`, removes their confirmation IDs and clears their notes map entry (the mark itself keeps `note`). Deleting an automatic defect adds its ID (and group member IDs) to `dismissedDefectIds`.
- `groupManualMarks` groups by `groupId` and computes combined `start`, `end`, `wordIds`, `note`.
- Automatic defects are grouped by `groupAutoDefects` before manual defects are appended. A group gets the id `auto-group-${firstDefectId}`, combined bounds/words and `groupTypes`. It is used by the list, the transcript, confirmation state and skip mode (which applies `playback.groupPadding`).
- Old marks without `wordIds` use strict interval overlap: a word that only touches the boundary is not included.

## 8. Confirmation, dismissal and note IDs

| Entity | ID |
|---|---|
| Automatic defect | `auto-${type}-${sequence}` |
| Automatically grouped defect | `auto-group-${firstDefectId}` |
| Single manual mark | `manual-${mark.id}` |
| Logical manual mark | `manual-group-${groupId}` |
| Note | key in `Project.defectNotes` by defect ID |

Details:

- `confirmedDefectIds` stores both automatic and manual IDs.
- `dismissedDefectIds` stores automatic IDs only; deleted manual marks live in `dismissedMarks`.
- A manual mark's note is written to both `defectNotes` and `ManualMark.note` on every mark in the group. This keeps export and reload consistent.
- `reconcileConfirmedIds(before, after, confirmedIds)`:
  - removes all old `manual-*` IDs;
  - leaves automatic IDs untouched;
  - adds a group confirmation ID only if **every** mark in it was confirmed before the change;
  - a new mark never becomes confirmed automatically.
- When a confirmed logical mark is split, all parts remain confirmed. When a confirmed and an unconfirmed mark are merged, the new group is considered unconfirmed.
- Skip mode produces intervals for every non-dismissed item; confirmation does not affect playback.
- Restoring removes the id from the appropriate dismissed store; restoring a manual mark moves it from `dismissedMarks` back to `marks`.

## 9. Action history

History is stored only in renderer memory and is reset when a project is opened or closed.

`EditableProjectState`:

```ts
{
  marks: ManualMark[]
  confirmedDefectIds: string[]
  dismissedDefectIds: string[]
  dismissedMarks: ManualMark[]
  defectNotes: Record<string, string>
  defectOverrides: Record<string, DefectBoundsOverride>
  rules: DefectRules
  playback: {
    skipBeforeSec: number
    skipAfterSec: number
    pauseKeepSec: number
    paddingByType?: Partial<Record<DefectType, SkipPadding>>
    groupPadding?: SkipPadding
  }
}
```

`HistoryEntry` contains `id`, `label`, `at`, `before`, `after` and an optional `mergeKey`. `HistoryState` is an array of entries plus the index of the last applied one.

- A new entry after undo truncates the redo branch.
- Entries with the same `mergeKey` within 2 seconds are coalesced (for example, note typing or boundary dragging).
- `undo`/`redo`/`jumpHistory` apply a snapshot to the project and the global
  settings copy (`rules` and padding fields), then save both. `skipEnabled`
  stays untouched.
- While the settings dialog is open, every settings entry carries a
  `settingsSession` id. Undo/redo ignores entries from before the dialog was
  opened, so project edits can never be rolled back from the dialog.
- History does not include: skip mode, playhead position, speed, loop, selection
  (word or time range), filters, bookmarks, transcript, model/language/export or
  UI-only settings.

## 10. Writes and defect-state reset

- `store.scheduleSave()` uses a 500 ms debounce; `flushSave()` is called when switching or closing a project.
- Settings without a model/language/backend change are saved with a 450 ms debounce; a model/language/backend change is saved immediately and refreshes engine status.
- `project.json`, `transcript.json`, `peaks.json` and `settings.json` are written atomically: `*.tmp` + `rename`.
- `writeTranscript(id, transcript, complete, resetReview)`:
  - always writes `transcript.json`;
  - updates `transcriptComplete` and `updatedAt` in `project.json`;
  - when `resetReview = true`, clears `confirmedDefectIds`, `dismissedDefectIds`, `defectNotes` and `defectOverrides`; `marks` and `dismissedMarks` survive.
- During transcription, the first partial result is written with `resetReview = true` because automatic IDs may have changed. Later partial results use `resetReview = false` so the user's edits in the already visible prefix are not lost. Manual marks are never reset.
- On the first partial, the renderer replaces automatic confirmation state with the on-disk state and resets history; on later partials and `done`, it keeps local `marks`, `dismissedMarks`, `confirmedDefectIds`, `dismissedDefectIds`, `defectNotes`, `defectOverrides`.

## 11. Backward compatibility

There is no explicit project schema version. Compatibility is provided by defaults at load time:

- missing `marks`, `defectOverrides`, `confirmedDefectIds`, `dismissedDefectIds`, `dismissedMarks`, `defectNotes`, `bookmarks` → empty objects/arrays;
- a legacy project with `reviewedDefectIds` and no new fields migrates automatic IDs to `dismissedDefectIds` and manual marks to `dismissedMarks`; `confirmedDefectIds` starts empty;
- missing `rules` fields, including `minDurationByType`, `enabledTypes`, `autoGroupEnabled` and `autoGroupGapSec` → values from `normalizeRules`/`DEFAULT_RULES`;
- old marks without `wordIds` → strict time overlap;
- old marks without `groupId` → single marks;
- missing/broken `transcript.json` → project without a transcript, `transcriptComplete = false`;
- missing/broken `peaks.json` → `peaks = null`;
- old settings are normalized in `loadSettings`, including every per-type skip padding entry;

When adding new fields to `Project` or `Settings`:

1. add a default at load time;
2. keep reading old files working;
3. add a normalization test if the logic is non-trivial.

## 12. Export

CSV (`buildCsv`):

- BOM `\uFEFF`, lines separated by `\r\n`;
- fields in `ExportSettings.fields` order;
- values containing `"`, `;`, `,` or a newline are quoted;
- timecodes `HH:MM:SS.mmm`, seconds with three decimal places;
- type and severity labels are Russian.

JSON:

```json
{
  "exportedAt": "ISO",
  "project": {
    "id": "…",
    "name": "…",
    "video": "/absolute/path.mp4",
    "duration": 123.4,
    "language": "ru",
    "modelId": "q8_0",
    "createdAt": "ISO"
  },
  "counts": { "filler": 6, "pause": 3, "repetition": 0, "false_start": 1, "unclear": 0 },
  "defects": [ … ],
  "marks": [ … ]
}
```

JSON always contains the full set of defect fields and the original manual marks; field settings apply only to CSV. `counts` contains every defect type, including zeros, and a grouped defect is counted once per type in `groupTypes`.
