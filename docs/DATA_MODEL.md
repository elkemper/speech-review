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
| `language` | `ru` | transcription (ASR) language |
| `uiLanguage` | `ru`* | interface language; `ru` / `en`; a missing field in an existing file migrates to `ru`, a missing file takes `app.getLocale()` when it is `ru` or `en` |
| `modelId` | `q8_0` | `q8_0` / `bf16` / `q4_k` |
| `backend` | `metal` | `metal` / `cpu` |
| `rules` | `DEFAULT_RULES` | defect rules |
| `chunkTargetSec` | `600` | target chunk length, 120–900 s |
| `export` | see below | CSV fields and format |
| `videoExport` | see below | video export resolution, quality and encoder |
| `playback` | see below | skip mode and padding |
| `miniTimelinePadSec` | `3` | context on each side of the selected defect in the mini timeline |
| `waveformContrast` | `55` | display-only waveform contrast, 0 = linear |
| `showDismissed` | `true` | show deleted defects as thin cards with restore |

`DEFAULT_RULES` (`src/shared/defects.ts`) shows the Russian lexicon; the filler lists follow the recognition language:

```ts
{
  // RU lexicon shown; the EN lexicon lives in FILLER_LEXICONS.en
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

**Filler lexicons follow the recognition language.** `FILLER_LEXICONS` in `src/shared/defects.ts` holds the Russian and English word/phrase lists (`fillerLanguage()` maps `en*` → English, everything else → Russian). The lists are recognition data, not interface copy: they depend on `Settings.language` / `Project.language`, never on `Settings.uiLanguage`, and are never translated.

- A new project copies `settings.rules`; a fresh settings file fills missing lists from `settings.language`.
- `loadSettings` and `loadProject` pass the recognition language to `normalizeRules(value, language)`, so a rules object without filler lists gets the lexicon of its own language.
- Changing the recognition language runs `adoptFillerLanguage`: an untouched default list is swapped for the new language's list; a list the user edited (`usesAnyDefaultFillers` is false) is preserved. The "reset rules" button uses `defaultRulesForLanguage(language)`.
- Switching `uiLanguage` never touches the filler lists.


`minDurationByType` sets the shortest reported defect for each type. For `pause` it is the silence length and the only pause threshold: shorter gaps are not defects and do not become candidates. For `repetition` it is the shorter of the two repeated words; `0` means no limit, except for `pause`, where `0`/missing normalizes to 1.2 s and the range is 0.3–10 s. `enabledTypes` turns a whole automatic type off for the project; missing entries mean on, and `manual` is never filtered. `autoGroupEnabled` is the grouping switch; `autoGroupGapSec` is the largest gap at which neighbouring automatic defects become one group. The gap value is kept while grouping is off, and `0` also disables grouping at the data level.

`export`:

- `fields` — CSV field order; the base fields are the final cut bounds
  (`start_tc`/`end_tc`/`start_sec`/`end_sec`/`duration_sec`); the original
  defect bounds are optional (`defect_start_*`/`defect_end_*`) and `cut` says
  whether the row is removed at all;
- `delimiter` — `;` or `,`;
- `includeHeader` — `true` by default.

`videoExport`:

- `resolution` — `source` / `1080` / `720` / `480`;
- `quality` — `high` / `balanced` / `compact`;
- `encoder` — `h264` / `hevc` / `h264_videotoolbox` / `hevc_videotoolbox`.
  The software encoders use CRF; VideoToolbox uses `-q:v`.

`playback`:

- `skipEnabled` — `false` by default;
- `skipBeforeSec` / `skipAfterSec` — global fallback, 0–5 s, defaults 0.15 / 0.35;
- `pauseKeepSec` — room tone kept inside a standalone pause, 0–3 s, default 0.4; split evenly between both edges, `0` removes the whole silence;
- `paddingByType` — `Record<DefectType, { before, after }>`; defaults give a pause `0/0` and a filler `0.1/0.2`;
- `groupPadding` — `{ before, after }` for a logical group, default 0.15 / 0.35.

For a pause the keep is applied as negative padding, so the derived cut shrinks
by `pauseKeepSec`; the pause type padding still adds on top. A derived cut
shorter than 0.2 s is skipped instead of performed.

Padding is resolved when the cut list is built and does not depend on `skipEnabled`: the controls stay editable even when skip mode is off. An explicit `Project.cutOverrides[defectId]` wins over every padding field; double-clicking a timeline handle deletes that override and restores the derived cut.

`loadSettings` is tolerant of old or broken files:

- an unknown `modelId`/`backend` is replaced with the default;
- `rules` is merged with missing `DEFAULT_RULES` fields;
- `chunkTargetSec` is rounded and clamped to 120–900;
- `export.fields` is filtered to known fields; an empty list is replaced with the default base fields; the legacy `reviewed` field is migrated to `confirmed`;
- `videoExport` is normalized by `normalizeVideoExportSettings`: unknown resolution, quality or encoder values fall back to `source` / `balanced` / `h264`;
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
| `cutOverrides` | `Record<string, {start,end}>` | final cut ranges keyed by defect ID; the original defect/mark span stays unchanged |
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
4. `marks`, `cutOverrides`, `confirmedDefectIds`, `dismissedDefectIds`, `dismissedMarks`, `defectNotes` and `bookmarks` are empty;
5. `transcriptComplete: false`.

Loading:

- missing `marks`, `cutOverrides`, `confirmedDefectIds`, `dismissedDefectIds`, `dismissedMarks`, `defectNotes`, `bookmarks`, `transcriptComplete` are filled with safe values; an old `defectOverrides` map is read as `cutOverrides` so existing boundary edits survive the rename;
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
  promotedIds // cut overrides + review ids + note keys, automatic IDs only
})
  → inject confirmed/dismissed/note from the project sets
  → append the active minimum-duration candidate as `candidate: true`
  → cutRangeFor(defect, playback, duration, project.cutOverrides[id])
     for playback, the timeline and export
```

`detectDefects` remains a thin wrapper that returns only `defects`. The cut is a
separate derived layer: `Defect.start/end` is always the detected or marked span.

Fields:

| Field | Description |
|---|---|
| `id` | `auto-${type}-w${wordIds.join('_')}` or `manual-${markId}` / `manual-group-${groupId}` |
| `type` | `filler`, `pause`, `repetition`, `elongation`, `false_start`, `vocal_sound`, `unclear`, `manual` |
| `start`, `end` | original detected/marked span in seconds; the final cut is derived separately |
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

Automatic IDs are **stable**: they depend on the defect type and the words it
covers, not on detection order. Changing rules or re-transcribing keeps an
existing id as long as the same words still produce a defect of the same type.
When one word produces two defects of the same type, the second gets a `-2`
suffix in detection order. Files written before this scheme are migrated on
load (see §11).

`dismissedDefectIds` and `dismissedMarks` are applied inside `detectDefects`. Active automatic defects are grouped without dismissed members; deleted automatic and manual items are returned separately with `dismissed: true` so their thin cards can be restored and focused from the transcript. A deleted automatic group stores both the group ID and member IDs.

A minimum-duration candidate is a rule match that did not pass the per-type filter. It keeps the same `auto-${type}-w…` ID as it would have at a lower threshold. The renderer reveals one candidate at a time when `activeDefectId` matches it and computes `candidate: true`; the candidate is not persisted. Any explicit edit or review action (cut edit, confirmation, deletion, note) puts the ID into `promotedIds`, so the next detection pass returns it as a normal defect and it survives a switch or reload.

`cutRangeFor`:

- returns an explicit `cutOverrides[defectId]` when present, normalized and clamped to the recording;
- otherwise applies per-type padding and the pause keep;
- returns `null` when the derived pause cut is shorter than 0.2 s; an explicit override is honoured even when shorter.

An override carries `pinned: true` when it was written by confirmation. A pinned range is frozen: padding changes do not move it. Removing the confirmation deletes pinned overrides only, so a range dragged by hand stays. Double-clicking a handle on a confirmed defect re-pins the derived range instead of deleting the override.

`buildCutList` merges every non-dismissed cut and does **not** depend on `skipEnabled`; `buildSkipIntervals` is `skipEnabled ? buildCutList : []`. `buildCutMap` returns the per-defect cut for drawing. `cutView` splits a defect into the original fill, the final cut, `outer` padding and `inner` kept room tone. The shared module is `src/shared/cuts.ts`; the renderer re-exports it from `src/renderer/src/skip.ts`.

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
- The defect table adds a mark from typed start/end bounds through the shared `addManualMark` core. The same merge, confirmation reconciliation and pin reconciliation run; the typed range is also stored as an explicit cut override unless the mark merged into a group (then the group padding applies).
- `mergeMarkNeighbours` merges only **changed** marks with those they touch within a gap of ≤ 0.2 s. Merging happens when a mark is added.
- A cut drag does not move the mark. `mergeMarksAtSpan` uses the dragged **cut** span for adjacency: if the cut handle reaches a neighbour, the marks join a logical group, the handle becomes the group cut, and every nested cut override is dropped. The marks keep their original `start`/`end`.
- If a changed mark no longer touches its group, it leaves the group (`groupId = undefined`). Old adjacent marks that the user explicitly split do not merge by themselves.
- `splitManualGroup` removes `groupId` from every mark in the group and clears the group cut override. The group note is copied to each single mark.
- `removeDefect` moves all marks in a manual group to `dismissedMarks`, removes their confirmation IDs and clears their notes map entry (the mark itself keeps `note`). Deleting an automatic defect adds its ID (and group member IDs) to `dismissedDefectIds`.
- `groupManualMarks` groups by `groupId` and computes combined `start`, `end`, `wordIds`, `note`.
- Automatic defects are grouped by `groupAutoDefects` before manual defects are appended. A group gets the id `auto-group-${firstDefectId}`, combined bounds/words and `groupTypes`. It is used by the list, the transcript, confirmation state and skip mode (which applies `playback.groupPadding`).
- Old marks without `wordIds` use strict interval overlap: a word that only touches the boundary is not included.

## 8. Confirmation, dismissal and note IDs

| Entity | ID |
|---|---|
| Automatic defect | `auto-${type}-w${wordIds.join('_')}` |
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
- Skip mode produces intervals for every non-dismissed item; confirmation does not decide whether an item is cut, but it freezes the cut range (story 50).
- Deleting an automatic defect stays effective across rule changes because automatic ids are stable (story 51).
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
  cutOverrides: Record<string, DefectBoundsOverride>
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
- Entries with the same `mergeKey` within 2 seconds are coalesced (for example, note typing or cut dragging).
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
- Settings without a model/language/backend/interface-language change are saved with a 450 ms debounce; a model/language/backend/interface-language change is saved immediately and refreshes engine status (an interface-language change also rebuilds the native menu).
- `project.json`, `transcript.json`, `peaks.json` and `settings.json` are written atomically: `*.tmp` + `rename`.
- `writeTranscript(id, transcript, complete, resetReview)`:
  - always writes `transcript.json`;
  - updates `transcriptComplete` and `updatedAt` in `project.json`;
  - when `resetReview = true`, clears `confirmedDefectIds`, `dismissedDefectIds`, `defectNotes` and `cutOverrides`; `marks` and `dismissedMarks` survive.
- During transcription, the first partial result is written with `resetReview = true` because the transcript was rebuilt. Later partial results use `resetReview = false` so the user's edits in the already visible prefix are not lost. Manual marks are never reset. Automatic ids are stable, but a rebuilt transcript can split or drop the words a decision referred to, so review state is still cleared on a full rebuild.
- On the first partial, the renderer replaces automatic confirmation state with the on-disk state and resets history; on later partials and `done`, it keeps local `marks`, `dismissedMarks`, `confirmedDefectIds`, `dismissedDefectIds`, `defectNotes`, `cutOverrides`.

## 11. Schema versions and migrations

`project.json` and `settings.json` carry `schemaVersion`. A file without one is
treated as version 0. `runMigrations` (`src/shared/migrations.ts`) applies named,
pure, idempotent steps in ascending order up to the target version and stamps
the new version. Each format keeps its own step list next to it.

**Project** (`src/shared/projectMigrations.ts`, current version 2):

- v1 folds the legacy fields: `reviewedDefectIds` → `dismissedDefectIds` /
  `dismissedMarks`, `defectOverrides` → `cutOverrides`, and archives deleted
  manual marks.
- v2 rewrites order-based automatic ids (`auto-${type}-${sequence}`,
  `auto-group-…`) to stable ids in `confirmedDefectIds`, `dismissedDefectIds`,
  `defectNotes` and `cutOverrides`. The old counter included disabled types and
  below-threshold candidates, so detection is re-run with those filters
  neutralised; `detectDefectsWithCandidates().matches` supplies the order.
  Ids that cannot be resolved are kept unchanged, never dropped.
- `loadProject` runs the migration once, then writes the upgraded file back. A
  project whose rules were edited after detection may not reproduce its old
  numbering; unresolved ids stay as they are.

**Settings** (`src/shared/settingsMigrations.ts`, current version 1):

- v1 renames the legacy `reviewed` CSV column to `confirmed`.
- Filling missing fields with defaults and clamping values is **not** a
  migration: it stays in `normalizeRules` / `normalizePlaybackSettings` and runs
  on every load.

Compatibility by defaults still covers the rest:

- missing `marks`, `cutOverrides`, `confirmedDefectIds`, `dismissedDefectIds`, `dismissedMarks`, `defectNotes`, `bookmarks` → empty objects/arrays;
- missing `rules` fields, including `minDurationByType`, `enabledTypes`, `autoGroupEnabled` and `autoGroupGapSec` → values from `normalizeRules`/`DEFAULT_RULES`;
- old marks without `wordIds` → strict time overlap;
- old marks without `groupId` → single marks;
- missing/broken `transcript.json` → project without a transcript, `transcriptComplete = false`;
- missing/broken `peaks.json` → `peaks = null`;
- old settings are normalized in `loadSettings`, including every per-type skip padding entry.

When adding new fields to `Project` or `Settings`:

1. a new field that can be defaulted → add the default at load time;
2. a renamed or removed field, or a one-time conversion → add a numbered
   migration step, bump the version constant and add a test;
3. keep reading old files working;
4. add a normalization test if the logic is non-trivial.

## 12. Export

CSV (`buildCsv`):

- BOM `\uFEFF`, lines separated by `\r\n`;
- fields in `ExportSettings.fields` order;
- values containing `"`, `;`, `,` or a newline are quoted;
- timecodes `HH:MM:SS.mmm`, seconds with three decimal places;
- type and severity labels and the `cut`/`confirmed` values are English (`filler`, `yes`/`no`), independent of the interface language (story 54);
- the `text` of a manual mark with no words and no note is the English fallback label; otherwise `text` is user data and is exported unchanged.

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

Video export:

- takes the merged `cuts` from `buildCutList`, derives the kept ranges with
  `complementRanges` and never creates a second cut model;
- writes the result to a `.part-<uuid>` file in the destination directory and
  renames it only after ffmpeg exits successfully;
- stores only the last dialog choices in `settings.videoExport`, not in the
  project or history;
- does not modify the source file. Audio-only export is deferred.
