# Product Spec — Index

Speech Review requirements, split into small feature files so an agent can load
only the area it is working on.

**Rules for this spec**

1. Files are ordered; stories are numbered continuously across the whole spec.
2. A story lives in exactly one file. Other files link to it instead of copying
   it.
3. Acceptance criteria live at the bottom of the story's file.
4. If a story grows, split a logically autonomous part into a sub-file
   (`04a-...`, `06a-...`) and link it from the parent. The sub-file links back.
   A sub-file does not restart numbering: it details the parent story number.
5. Before changing a feature, read its file. Do not regress `Done` stories.
   Do not pull a `Backlog` story into scope without updating the spec.

**Status legend**

| Status | Meaning |
|---|---|
| `Done` | Implemented; changes must preserve it |
| `Fix now` | P0 bug or regression |
| `Next` | P1, planned after P0 |
| `Backlog` | P2/P3, not current scope |
| `Decision needed` | Blocked on product approval or a conflict |

**Priority**

- **P0:** wrong data, broken playback, regression.
- **P1:** requested UX improvement with a clear path.
- **P2:** larger feature or design work.
- **P3:** nice to have.

## Story order

| File | Stories | Area |
|---|---|---|
| [`01-settings.md`](spec/01-settings.md) | 1–3, 43 | Tabs, sliders, rows, show-dismissed |
| [`02-defects.md`](spec/02-defects.md) | 4–7, 44, 46 | Detection, minimum duration, candidates, auto-grouping, toggles, sentence pauses |
| [`03-marks.md`](spec/03-marks.md) | 8–13, 45 | Manual marks, selection, logical marks, boundaries, confirmation state |
| [`04-timeline.md`](spec/04-timeline.md) | 14–17 | Zoom/pan, LOD, overlays, timeline selection |
| [`04a-waveform-selection.md`](spec/04a-waveform-selection.md) | 17 detail | Exact time selection + manual marks; pause tokens deferred |
| [`04b-word-underlays.md`](spec/04b-word-underlays.md) | 41 | Colored word underlays in both timelines |
| [`04c-waveform-contrast.md`](spec/04c-waveform-contrast.md) | 42 | Readable waveform across a wide dynamic range |
| [`05-transcript.md`](spec/05-transcript.md) | 18–24 | Seeking, sync, follow, pause rows, skipping style, partials |
| [`06-playback.md`](spec/06-playback.md) | 25–30 | Skip rules, padding, listen, robustness, clean playback, bookmarks |
| [`06a-clean-playback.md`](spec/06a-clean-playback.md) | 29 detail | Playback without marked places |
| [`07-layout-history-visual.md`](spec/07-layout-history-visual.md) | 31–34, 47 | Panels, undo/redo, visual direction, dark theme, settings history |
| [`07a-visual-refresh.md`](spec/07a-visual-refresh.md) | 33 detail | Photoshop/Audacity-style refresh |
| [`08-processing-progress.md`](spec/08-processing-progress.md) | 35–37 | Progress semantics, chunk length, streaming |
| [`08a-streaming-asr.md`](spec/08a-streaming-asr.md) | 37 detail | Streaming recognition |
| [`09-export.md`](spec/09-export.md) | 38–39 | CSV and JSON |
| [`10-mini-timeline.md`](spec/10-mini-timeline.md) | 40 | Selected defect snippet with editable boundaries |

## Product invariants

Applies to every story.

1. **Fully local.** Recording, transcript, project data and inference stay on
   the machine. Network is used only for the model and engine/ffmpeg downloads.
2. **No Python or torch at runtime.** `audiocpp_cli` + GGUF + ffmpeg only.
3. **macOS on Apple Silicon is the only verified target.**
4. **Dark theme only.** No light theme or theme switcher without an explicit
   task.
5. **`unclear` / word confidence stays disabled** while the engine writes
   `confidence: 0`.
6. **Skip mode cuts every defect and manual mark except dismissed ones.**
   Confirmation is a review marker only. A different playback mode is allowed
   only as a separate, explicitly named mode (story 29 / `06a`).
7. **The exact selected words define a manual mark.** Logical grouping may
   expand a *group's* span, but each underlying mark keeps its exact `wordIds`.
8. **History is editable project state only:** marks, confirmed/dismissed ids, dismissed marks, notes,
   defect overrides, project defect rules and skip padding. Not skip mode,
   playback position, speed, loop, selection, filters, bookmarks, transcript,
   model/language/export or UI-only settings. While the settings dialog is open,
   undo is limited to settings changes made since it was opened.
9. **Manual grouping is explicit.** Group on add or boundary move; do not
   regroup every render.
10. **ID rules stay stable.** Automatic `auto-${type}-${sequence}`; manual
    UUIDs; logical manual `manual-group-${groupId}`; automatic group
    `auto-group-${firstDefectId}`.
11. **First partial transcript resets defect lifecycle state** because automatic ids may
    change. Later partials preserve edits to the visible prefix. Marks and
    bookmarks survive.
12. **Atomic writes** (`*.tmp` + `rename`) for project, transcript, peaks and
    settings.
13. **Do not replace `node_modules`** in the Linux container.

## Decisions

- **Settings tabs:** General (engine, model download/delete, language, backend,
  chunk length), Defects (show-dismissed at the top, per-type rows with
  enable/min-duration/padding/specific controls, auto-grouping, timeline and
  mini-timeline), Export (CSV fields/format). Skip mode is controlled in the
  player, not in Settings; there is no scope selector. The earlier "Recognition" tab
  wording is superseded; recognition settings live in General.
- **Clean playback** (story 29) is a separate mode from review skip. It must
  not weaken invariant 6.
- **Partial recognition** is chunk-by-chunk. No intra-chunk streaming yet
  (story 37).
- **Arbitrary time selection** is implemented in `04a`: `Shift`+drag selects
  exact bounds and `M` creates a normal manual mark. Generated pause tokens
  remain deferred because `ManualMark` already stores exact start/end.
- **Visual refresh** is a separate track (`07a`); it does not change behaviour.

## Triage

### Fix now (P0)

| Story | Problem |
|---|---|
| 8 | Manual mark grabs a neighbouring word |
| 18 | Selecting a word/mark highlights the previous word |
| 19 | Selecting a word does not reliably select/scroll the matching defect in the list |
| 27 | "прослушать" only seeks |
| 28 | Fast-forward can freeze on overlapping/adjacent intervals |

### Next (P1)

| Story | Problem |
|---|---|
| 14 | Trackpad-friendly timeline zoom/pan |
| 15 | Progressive timeline detail (markers → words → labels) |
| 22 | Sentence pause rows; ordinary pauses not special |
| 23 | Dim items skipped by fast-forward |
| 35 | Honest progress only for transcription |
| 36 | Shorter default chunks (3 min) |
| 9 | Verify multi-word selection end to end |
| 24 | Verify partial chunks remain reviewable |

### Backlog (P2/P3)

| Story | Item |
|---|---|
| 17 / `04a` follow-up | Generated pause tokens for non-word-aligned edges |
| 29 / `06a` | Clean playback without marked places (needs approval) |
| 33 / `07a` | Visual refresh toward Photoshop/Audacity 3 |
| 37 / `08a` | Streaming ASR |

### Done — do not regress

Stories 1–7, 10–13, 16–17, 20–21, 25–26, 30–32, 34, 38–47.
Verification only (implemented, needs a pass): 9, 24.

## Related documents

- `AGENTS.md` — repository rules and invariants.
- `docs/ARCHITECTURE.md` — current implementation.
- `docs/DATA_MODEL.md` — persistence and ids.
- `docs/TESTING.md` — test layout and limits.
- `docs/BACKLOG.md` — long-term deferred work.