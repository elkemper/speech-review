import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

/**
 * Opt-in suite that runs the real export pipeline against real ffmpeg. Kept
 * apart from `vitest.config.mts` so `npm test` stays fast and does not need a
 * working ffmpeg on the host.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared')
    }
  },
  test: {
    include: ['test/integration/**/*.int.test.ts'],
    exclude: ['**/node_modules/**', '**/node_modules_linux/**', '**/dist/**', '**/out/**'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // One file, but the encoders would otherwise compete for cores with the
    // next scenario and make the timing-sensitive assertions flaky.
    fileParallelism: false
  }
})
