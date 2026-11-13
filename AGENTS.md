# AGENTS.md

Instructions for coding agents working in this repository. Read this file before changing code.

## What this project is

**Speech Review** is a local Electron app for reviewing webinar recordings. It extracts audio, transcribes it with **CrisperWhisper 2.0** through the native **audio.cpp** runtime on Metal, detects speech defects, and provides a review workflow: click a word to seek, confirm real defects or delete false positives, add manual marks, loop, skip, and export.

The current MVP targets **macOS 13+ on Apple Silicon** and Russian speech. The UI is in Russian and the theme is dark-only.

User-facing documentation is available in English (`README.md`) and Russian (`README.RU.md`); requested features and bugs are consolidated in `docs/SPEC.md`; deferred work is in `docs/BACKLOG.md`.

## Read first

| Document | Purpose |
|---|---|
| `README.md` | English user overview, features, setup, troubleshooting |
| `README.RU.md` | Russian user overview (same content) |
| `docs/SPEC.md` | Spec index: ordered story files, status triage, acceptance criteria |
| `docs/spec/` | One feature per file: stories + acceptance criteria |
| `docs/ARCHITECTURE.md` | Processes, modules, transcription pipeline, IPC and UI flow |
| `docs/DATA_MODEL.md` | Project/transcript/defect/mark persistence and ID rules |
| `docs/DEVELOPMENT.md` | Setup, scripts, resources, packaging, debugging |
| `docs/TESTING.md` | Test layout, coverage, fixtures, platform limits |
| `docs/BACKLOG.md` | Explicitly deferred features |

**Before changing a feature, find its story in `docs/SPEC.md` and read only that file from `docs/spec/`. Do not regress a `Done` story, and do not pull a `Backlog` story into scope without updating the spec. If a story grows, split a logically autonomous part into a `docs/spec/NNa-...` file and link it from the parent story; the sub-file links back and keeps the parent's story number.**

## Non-negotiable constraints

- **Target platform:** macOS on Apple Silicon. Do not assume Windows/Linux runtime support; the code has partial cross-platform paths, but only macOS arm64 is verified.
- **Fully local:** recording, transcript, project data and model inference stay on the machine. The only network access is the one-time model download from Hugging Face and the engine/ffmpeg download at setup.
- **No Python/torch at runtime.** `resources/engine/tools/*.py` may exist in the downloaded engine bundle, but the app must not invoke Python. The runtime path is `audiocpp_cli` + GGUF + ffmpeg.
- **`node_modules` is the macOS arm64 install.** It is kept in the repository workspace for packaging. Do **not** run `npm install`, `npm ci`, or replace `node_modules` in the Linux development container. `node_modules_linux/` is a stale Linux tree; it is gitignored and excluded from Vitest. If a dependency must change, edit `package.json`/`package-lock.json` and ask the user to install on the Mac.
- **Dark theme only.** Do not add a light theme or a theme switcher unless the task explicitly asks for it.
- **Word confidence / `unclear` is backlog.** `audiocpp_cli` currently writes `confidence: 0`. The parser stores `null` when no positive confidence exists and the `unclear` rule is disabled. Do not enable it by default or treat `0` as a low-confidence signal.
- **Skip mode cuts every defect and manual mark except dismissed ones.** Confirmation is a review marker only and does not affect playback. See `src/renderer/src/skip.ts`.
- **Do not silently change defect-lifecycle semantics.** Automatic defect IDs are order-based; manual marks have explicit group IDs; confirmed state is reconciled when marks merge/split; deleted manual marks live in `dismissedMarks`, deleted automatic IDs in `dismissedDefectIds`. See `docs/DATA_MODEL.md`.
- **History is for editable project state only:** marks, confirmed IDs, dismissed IDs, dismissed marks, notes, defect overrides. Do not put playback position, filters, selection or transcript data into undo/redo snapshots.
- **Do not commit generated or binary artifacts:** `out/`, `dist/`, `resources/engine/`, `resources/ffmpeg/`, `node_modules/`, `node_modules_linux/` are ignored.

## Repository map

```
src/
├── main/                 Electron main process
│   ├── index.ts          app lifecycle, window, menu, app-media protocol
│   ├── ipc.ts            IPC handlers, engine status, dialogs, projects, export
│   ├── jobs.ts           transcription manager and chunk pipeline
│   ├── projects.ts       project persistence (project/transcript/peaks)
│   ├── settings.ts       settings load/save and normalization
│   ├── paths.ts          userData, resources, models, projects, tmp paths
│   ├── mediaServer.ts    app-media:// protocol with HTTP Range support
│   ├── export.ts         CSV/JSON save dialog and file writing
│   └── engine/
│       ├── chunks.ts     silence-aware chunk planner
│       ├── crisperwhisper.ts  audiocpp_cli invocation and words.json parsing
│       ├── ffmpeg.ts     probe, audio extraction, silencedetect
│       ├── models.ts     model download, SHA-256, delete, state
│       ├── proc.ts       child-process wrapper with abort support
│       └── wav.ts        WAV header parsing, slicing, peaks
├── preload/index.ts      contextBridge API
├── shared/               pure code used by main and renderer
│   ├── types.ts          canonical data model
│   ├── ipc.ts            IPC channel names
│   ├── api.ts            preload API contract
│   ├── settings.ts       defaults and export/settings normalization helpers
│   ├── models.ts         model specs (Q8_0/BF16/Q4_K, sizes, SHA-256, URLs)
│   ├── transcript.ts     words.json parsing, transcript building, segments
│   ├── defects.ts        automatic defect rules, overrides, ordering
│   ├── marks.ts          logical manual marks, confirmation reconciliation
│   ├── exportCsv.ts      CSV formatting
│   └── format.ts         timecodes, bytes, clamp
└── renderer/src/         React renderer
    ├── store.ts          zustand app state, persistence orchestration, history
    ├── history.ts        undo/redo snapshots and action log
    ├── player.ts         video element control, seek, loop, skip bypass
    ├── skip.ts           skip interval calculation
    ├── selection.ts      word selection and manual-mark ranges
    ├── timelineView.ts   zoom/pan/LOD/boundary math
    ├── defectsUi.ts      labels, colors, ordering
    ├── hooks/useHotkeys.ts
    └── components/       Welcome, Workspace, Player, Timeline, Transcript,
                          DefectPanel, SettingsDialog, DefectRulesSection,
                          SettingsRangeField, HistoryDialog
scripts/                  engine/ffmpeg fetch, platform/resource checks, after-pack
test/                     Vitest suites and fixtures
```

## Commands

| Command | What it does | Works in this Linux container? |
|---|---|---|
| `npm run typecheck` | `tsc --noEmit` for node and web configs | Yes |
| `npm test` | Vitest run (150 tests / 12 files) | Yes |
| `npm run test:watch` | Vitest watch mode | Yes |
| `npm run build` | electron-vite production build into `out/` | Yes |
| `npm run dev` | electron-vite dev + Electron | **No** (needs macOS + macOS Electron) |
| `npm start` | electron-vite preview | **No** |
| `npm run fetch:engine` | downloads audio.cpp and ffmpeg into `resources/` | **No** — it would replace the macOS binaries with Linux ones; run it on the Mac |
| `npm run check:resources` | verifies engine and ffmpeg exist | Yes if resources are present |
| `npm run check:platform` | verifies Electron/native modules match the host | Fails on Linux with macOS `node_modules` |
| `npm run package:mac` | platform check + resources check + build + electron-builder DMG | **No** (macOS only) |

## Verification before finishing

Always run:

```bash
npm run typecheck
npm test
npm run build
```

If you changed UI behavior or runtime code, also state clearly that Electron, `audiocpp_cli`, ffmpeg and real media playback were **not** verified in this container and ask the user to test on the Mac. Never claim a runtime check that did not happen.

## Coding conventions

- TypeScript strict mode; no semicolons; single quotes; 2-space indentation; trailing commas where the surrounding code uses them.
- Keep `src/shared` free of Electron, Node-only APIs and renderer imports. Shared code must stay testable in Vitest.
- Renderer state goes through the zustand store in `src/renderer/src/store.ts`; components should select state and call actions rather than duplicate project mutation logic.
- Put pure business logic in `src/shared` or a renderer helper (`skip.ts`, `selection.ts`, `timelineView.ts`) and test it. Do not bury testable rules in JSX.
- Use the existing aliases: `@shared` in main/preload/renderer, `@renderer` in the renderer.
- IPC changes require all of: `src/shared/ipc.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, and the renderer caller. Keep the preload surface minimal; never expose `ipcRenderer` directly.
- File writes that can be interrupted should stay atomic: write `*.tmp`, then `rename`.
- Russian strings for UI and user-facing errors; follow the existing English style for code comments. Do not introduce a UI framework or icon library without a concrete need.
- Avoid new dependencies. The macOS `node_modules` constraint makes dependency changes expensive.
- Preserve user work: do not delete or rewrite unrelated files, tests or docs.

## Data invariants to preserve

- **Word IDs** are dense indexes assigned in transcript order by `buildTranscript`.
- **Automatic defect IDs** are `auto-${type}-${sequence}`, where `sequence` is the global detection order. They are not stable across rule or transcript changes.
- **Manual mark IDs** are UUIDs. A logical mark is a set of marks sharing `groupId`; its defect ID is `manual-group-${groupId}`, otherwise `manual-${markId}`.
- **Confirmed state** lives in `Project.confirmedDefectIds`. For manual marks the confirm ID is `manual-group-${groupId}` or `manual-${markId}`. `reconcileConfirmedIds` keeps a logical mark confirmed only when every underlying mark was confirmed before the change.
- **Dismissed state** lives in `Project.dismissedDefectIds` for automatic defects and `Project.dismissedMarks` for manual marks. Active defects are grouped without dismissed members; dismissed items are returned separately with `dismissed: true` so the card can be restored and focused. Deleted manual marks never participate in `mergeMarkNeighbours`.
- **Notes** live in `Project.defectNotes` keyed by defect ID. Manual marks also store the note on each underlying `ManualMark` so exports/reloads stay consistent.
- **Boundary edits:** automatic defects use `Project.defectOverrides[defectId]`; manual marks update `mark.start`/`mark.end` and recompute `wordIds` with strict overlap.
- **Manual grouping is explicit.** `mergeMarkNeighbours` runs only when a mark is added or a boundary moves. Do not regroup all marks on every render; that would undo an intentional split.
- **First partial transcript resets defect lifecycle state** (`confirmedDefectIds`, `dismissedDefectIds`, notes, overrides) because automatic IDs may change. Later partials preserve the user's local edits to the already visible prefix. `marks` and `dismissedMarks` survive.
- **Skip intervals** use every defect except `dismissed`, clamp to duration, and merge overlapping padded ranges. Padding is resolved per defect type, and a logical group (manual or automatic) uses `playback.groupPadding` instead of per-member padding. There is no skip scope: automatic defects and manual marks are cut together.
- **Automatic grouping** is opt-in through `rules.autoGroupEnabled` plus `rules.autoGroupGapSec` (and a gap of 0 disables it at the data level). Neighbouring automatic defects merge only when the gap is within the limit and no real spoken word sits inside the gap. The result carries `groupIds` / `groupTypes` and the id `auto-group-${firstId}`.
- **Defect types can be switched off** with `rules.enabledTypes`. A disabled type produces no defects, but the detection sequence still advances, so the ids of the other types stay stable. `manual` is never filtered.
- **Minimum duration** is a per-type rule (`rules.minDurationByType`). For pauses it measures the silence, for repetitions the shorter repeated word. A match below the limit is returned as a hidden `DefectCandidate` with the same automatic ID; it is not a defect until `promotedIds` contains it.
- **A revealed candidate is transient.** The renderer adds it to `defects` only while `activeDefectId` matches, so it gets the normal controls, timeline markers and skip intervals. Bounds, confirmation, deletion or a note promote it through existing project state; switching away drops it.
- **Timeline Shift+drag selects exact time.** The transcript keeps word-based selection; `M` / «＋ метка» turns a time range into a normal `ManualMark` with exact `start`/`end`, then `mergeMarkNeighbours` and `reconcileConfirmedIds` run as before.
- **Bookmarks** (`Project.bookmarks`) are navigation markers, not defects. They persist with the project but stay out of undo/redo, skip intervals and exports.

## Testing rules

- Tests live in `test/**/*.test.ts`; Vitest includes only that pattern and excludes `node_modules_linux`.
- Add regression tests for every pure rule change: defect detection, automatic grouping, per-type minimum duration, chunk planning, marks/groups, confirmation reconciliation, overrides, selection, timeline math, skip intervals and padding, settings normalization, CSV.
- Tests may import renderer helpers by relative path (for example `../src/renderer/src/skip`); the only configured alias is `@shared`.
- Do not add e2e or Electron launch tests. If behavior depends on Electron, extract the pure part and test that.
- Keep the sample fixture expectations intact unless the fixture itself is intentionally replaced: the current `test/fixtures/chunk.json` produces 6 fillers, 3 pauses and 1 false start (10 defects).

## Runtime and platform caveats

- This development container is Linux. Electron cannot launch here, and `audiocpp_cli` is a macOS arm64 binary. Real playback, transcription, model download and packaging must be verified on the user's Mac.
- `npm run package:mac` produces an ad-hoc signed but **not notarized** DMG. First launch may require `xattr -cr "/Applications/Speech Review.app"` or right-click → Open.
- Models are stored under Electron `userData/models/CrisperWhisper2.0-GGUF/`; projects under `userData/projects/<uuid>/`; temporary jobs under `userData/tmp/jobs/`.
- The model is licensed under the Nyra Health Non-Commercial Research License. Do not imply commercial usage rights.
