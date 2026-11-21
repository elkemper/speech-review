# 11 — Model update discovery

[Index](../SPEC.md) · Related: [01 — Settings](01-settings.md) (story 2)

**Files:** `src/shared/models.ts`, `src/main/engine/models.ts`,
`src/main/ipc.ts`, `src/renderer/src/components/SettingsDialog.tsx`,
`scripts/update-model-manifest.mjs`, `model-manifest.json`.
**Tests:** `test/modelManifest.test.ts`.

## Story

### Story 49 — Model update discovery through a runtime manifest

**Status:** Done (verification on macOS pending) · **Priority:** P2

As a user, I want the app to tell me when a newer CrisperWhisper build is
available, so I can upgrade the model without waiting for an app release.

- Model versions are published in `model-manifest.json` at the repository
  root and fetched at runtime from `raw.githubusercontent.com`. The git
  history of that file is the version history; no extra infrastructure.
- The manifest carries `formatVersion`, an informational ISO `generatedAt`
  timestamp (dating the raw file; the app does not track it anywhere) and
  one entry per model variant: calendar `version`, `releasedAt`, `file`,
  `size`, `sha256`, `url`.
- Update discovery happens **only** when the user clicks «проверить
  обновления» in Settings → «Модель распознавания». No network access at
  startup or in the background.
- A manifest entry overrides the built-in `MODEL_SPECS` entry only when its
  sha256 differs; entries without a valid sha256/size/https-url are dropped
  by `parseManifest`, so a broken manifest can never point downloads at an
  unverifiable file.
- Installed versions are stored in `settings.json` under `modelVersions`.
  For installs made before version tracking, the version is recovered by
  matching the on-disk sha256 marker against the manifest. A ready model
  whose hash matches nothing published reports «доступна новая версия».
- The `.sha256` marker next to each model file now stores JSON
  (`{ sha256, version, size }`); the older bare-hex format is still read.
  Verification (`ensureModel`) picks the spec whose hash matches the marker,
  so a model downloaded from a newer manifest still verifies after an app
  restart with an empty manifest cache.
- The update row offers «Обновить», which runs the existing resumable
  download pipeline (`Range`, streaming SHA-256, `*.part` → rename) against
  the manifest URL and records the new version on success.
- The maintainer regenerates the manifest with `npm run models:update`
  (`scripts/update-model-manifest.mjs`, zero deps). It reads sizes and
  SHA-256 digests from the Hugging Face tree API — GGUF files are stored via
  Git LFS and the LFS oid equals the file's sha256, so nothing is
  downloaded. It diffs live metadata against the current manifest, offers
  additions/removals with a suggested `YYYY.M.patch` version through a
  minimal readline prompt, refreshes `generatedAt` and writes the file
  atomically.

### Acceptance criteria

1. Offline or with the manifest unreachable, the built-in specs are used and
   the check reports a distinct "could not check" message (the result carries
   `reachable: false`), never "everything is up to date".
2. When the manifest describes a newer build for a downloaded model, the
   model card shows «доступна v…» and the update row offers «Обновить».
3. Downloading a model records its version in `settings.json`; deleting the
   model clears the stale check result.
4. A model file whose hash matches no manifest entry and no built-in spec is
   reported as an available update (unknown installed version), never as
   silently fine.
