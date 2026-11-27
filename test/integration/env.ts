import { accessSync, constants, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

/**
 * Finds an ffmpeg that can actually run on this host.
 *
 * Order: `SPEECH_REVIEW_FFMPEG`, the bundled `resources/ffmpeg/ffmpeg`, then
 * `ffmpeg` from PATH. A candidate that exists but cannot start (for example a
 * macOS arm64 build on Linux) is skipped, so the suite reports "no ffmpeg"
 * instead of an exec-format failure.
 */
export function resolveFfmpeg(): string | null {
  const candidates = [
    process.env.SPEECH_REVIEW_FFMPEG,
    resolve('resources/ffmpeg/ffmpeg'),
    'ffmpeg'
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    if (candidate === 'ffmpeg') {
      if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0) {
        return 'ffmpeg'
      }
      continue
    }
    if (!existsSync(candidate)) continue
    try {
      accessSync(candidate, constants.X_OK)
    } catch {
      continue
    }
    if (spawnSync(candidate, ['-version'], { stdio: 'ignore' }).status === 0) {
      return candidate
    }
  }
  return null
}
