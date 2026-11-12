# Development

A practical guide to setting up the environment, running the app, building a DMG and debugging common issues.

## 1. Requirements

- macOS 13+ on Apple Silicon (M1/M2/M3/M4/M5).
- Node.js 20+ and npm.
- ~3 GB of free space: engine ~100 MB, ffmpeg ~80 MB, model ~1.6 GB.
- 8 GB RAM or more.
- Xcode Command Line Tools (`codesign`) for building the DMG.

The app is designed for local processing. Python and torch are not required at runtime.

## 2. First setup

On a **Mac**:

```bash
npm install
npm run fetch:engine
npm run dev
```

`npm run fetch:engine` downloads:

- `resources/engine/` — `audiocpp_cli` from audio.cpp v0.9.4 (macOS arm64 Metal);
- `resources/ffmpeg/ffmpeg` — static ffmpeg 6.1.1.

Then in the app: **Settings → General → Download model**. The Q8_0 model (~1.6 GB) is downloaded from Hugging Face, verified by SHA-256 and stored in `userData/models/CrisperWhisper2.0-GGUF/`.

### Important: `node_modules`

In this repository workspace, `node_modules` is the **macOS arm64** install prepared for packaging. Do not run `npm install`, `npm ci` or replace the directory in the Linux container: that would break the macOS dependencies.

- `node_modules_linux/` is a stale Linux tree. It is not used by the app and is excluded from Vitest.
- If a dependency must be added/updated, edit `package.json` and `package-lock.json`, then ask the user to install on the Mac.
- The container supports `npm run typecheck`, `npm test` and `npm run build`; launching Electron and the engine is not possible.

## 3. Scripts

| Script | What it does |
|---|---|
| `npm run dev` | `electron-vite dev`; `predev` checks the platform first |
| `npm start` | `electron-vite preview` of the built app |
| `npm run build` | production build of main/preload/renderer into `out/` |
| `npm run typecheck` | `tsc --noEmit` for `tsconfig.node.json` and `tsconfig.web.json` |
| `npm test` | single Vitest run |
| `npm run test:watch` | Vitest in watch mode |
| `npm run fetch:engine` | download audio.cpp and ffmpeg into `resources/` |
| `npm run check:resources` | verify `audiocpp_cli` and `ffmpeg` exist |
| `npm run check:platform` | verify Electron and native modules match the host |
| `npm run package:mac` | platform check → resources check → build → electron-builder DMG |

`npm run fetch:engine` supports several platforms in its `ENGINE_ASSETS` table, but the target and verified configuration is `darwin-arm64`. The script does not verify SHA-256 of the downloaded binaries; this is a known limitation (see backlog).

## 4. Development mode

```bash
npm run dev
```

- `electron-vite` starts the renderer dev server and launches Electron.
- Main and preload rebuild on change; the renderer updates via HMR.
- Aliases: `@shared` → `src/shared`, `@renderer` → `src/renderer/src`.
- In dev mode `resourcesRoot()` points to `resources/` in the project root.
- In production `resourcesRoot()` is `process.resourcesPath`; electron-builder places `engine/` and `ffmpeg/` there.

Useful points:

- DevTools: menu **View → Toggle Developer Tools**.
- Main-process logs — in the terminal running `npm run dev`.
- ASR logs (`[asr N] …`) are printed in the main process when `NODE_ENV !== 'production'`.
- Progress and errors arrive in the renderer through IPC events; see `src/main/jobs.ts` and `src/renderer/src/store.ts`.

## 5. Resources and model

### Engine and ffmpeg

```
resources/
├── engine/audiocpp_cli
└── ffmpeg/ffmpeg
```

Both directories are in `.gitignore`; obtain them via `npm run fetch:engine`.

- audio.cpp: `https://github.com/0xShug0/audio.cpp/releases/download/v0.9.4/audio-v0.9.4-bin-macos-arm64-metal.tar.gz`
- ffmpeg: static `ffmpeg-static` b6.1.1 build.

`check-resources.mjs` only checks that files exist and prints their sizes. It does not check executability or checksums.

### Model

Specifications live in `src/shared/models.ts`:

| ID | File | Size | Purpose |
|---|---|---|---|
| `q8_0` | `crisperwhisper-2-large-q8_0.gguf` | 1,716,306,528 B | recommended balance |
| `bf16` | `crisperwhisper-2-large-bf16.gguf` | 3,092,563,712 B | maximum quality |
| `q4_k` | `crisperwhisper-2-large-q4_k.gguf` | 982,302,624 B | lightest |

The model is downloaded to `userData/models/CrisperWhisper2.0-GGUF/`. After successful verification, a `<file>.sha256` marker is created next to it so gigabytes are not hashed on every launch. An incomplete download stays as `<file>.part` and can be resumed via HTTP Range.

## 6. Building a DMG

```bash
npm run package:mac
```

Order:

1. `check-platform.mjs` — checks `node_modules`, Electron and native modules;
2. `check-resources.mjs` — checks `resources/engine` and `resources/ffmpeg`;
3. `npm run build` — builds `out/`;
4. `electron-builder --mac --arm64` — builds the `.app` and DMG in `dist/`.

Configuration — `electron-builder.yml`:

- `extraResources` places `resources/engine` and `resources/ffmpeg` inside the bundle;
- `asar: true`;
- `afterPack` performs ad-hoc signing with `codesign --force --deep --sign -`;
- no notarization, `hardenedRuntime: false`, `identity: null`.

The first launch on another machine may require:

```bash
xattr -cr "/Applications/Speech Review.app"
open "/Applications/Speech Review.app"
```

or right-click → **Open** → **Open**.

## 7. Debugging

### The app cannot find the engine or ffmpeg

Check:

```bash
npm run check:resources
```

Settings has "check" and "reveal" buttons for the paths. In dev mode the paths point to `resources/`; in the built app they point inside `.app/Contents/Resources/`.

### The model fails SHA-256 verification

Delete the model file in settings (or manually together with `.sha256` and `.part`) and download it again. After an interruption the download resumes from `.part`, but if the hash does not match, the file is deleted.

### Video does not play

Chromium does not support some codecs (certain MKV/HEVC/AV1 files). Transcription still works because ffmpeg extracts the audio. To play the file, re-encode it to MP4/H.264:

```bash
ffmpeg -i input.mkv -c:v libx264 -c:a aac -movflags +faststart output.mp4
```

### `check:platform` fails in the Linux container

This is expected: `node_modules` was built for macOS, and Electron/native modules do not match Linux. Do not "fix" this by replacing `node_modules` with `node_modules_linux`. To check logic, use `npm test`, `npm run typecheck` and `npm run build`.

### Transcription is slow

Reference for M4 Pro: 10 minutes of audio ≈ 1.5 minutes of transcription (RTF ≈ 0.15). M5 Air may be slower. The Q4_K model is faster and lighter, but quality is lower. The model is reloaded for each chunk — a known MVP limitation.

### Unfinished transcription

If the app crashes, the job starts over. Completed projects and partial transcripts are saved, but you cannot resume from the last chunk.

## 8. Development rules

- Do not add e2e/Electron tests; extract pure logic and cover it in Vitest.
- Do not modify `node_modules` in the container.
- Do not enable `unclear` by default until audio.cpp provides real confidence values.
- Do not add a light theme without a separate task.
- Keep Russian UI strings and the existing code style.
- When changing IPC, update `src/shared/ipc.ts`, `src/shared/api.ts`, `src/preload/index.ts` and `src/main/ipc.ts` together.
- Detailed invariants — in `AGENTS.md` and `docs/DATA_MODEL.md`.

## 9. Checklist before handing off changes

```bash
npm run typecheck
npm test
npm run build
```

If UI, playback, ffmpeg, model or packaging changed:

- [ ] changes verified on macOS arm64;
- [ ] `npm run fetch:engine` run on the Mac;
- [ ] model downloads and passes SHA-256;
- [ ] a real file is transcribed; partial and final transcripts appear;
- [ ] word click, boundaries, skip, undo/redo and export work;
- [ ] `npm run package:mac` builds a DMG;
- [ ] first launch of the DMG verified (ad-hoc signing).

These items cannot be verified in the Linux container; do not mark them done without a real run.
