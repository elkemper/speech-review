import { app } from 'electron'
import { join } from 'node:path'
import { getModelSpec } from '@shared/models'
import type { ModelId } from '@shared/types'

export const isDev = !app.isPackaged

export function resourcesRoot(): string {
  return isDev ? join(process.cwd(), 'resources') : process.resourcesPath
}

export function engineBinary(): string {
  const name = process.platform === 'win32' ? 'audiocpp_cli.exe' : 'audiocpp_cli'
  return join(resourcesRoot(), 'engine', name)
}

export function ffmpegBinary(): string {
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  return join(resourcesRoot(), 'ffmpeg', name)
}

export function userDataDir(): string {
  return app.getPath('userData')
}

export function modelsDir(): string {
  return join(userDataDir(), 'models')
}

export function modelPath(id: ModelId): string {
  return join(modelsDir(), 'CrisperWhisper2.0-GGUF', getModelSpec(id).file)
}

export function projectsDir(): string {
  return join(userDataDir(), 'projects')
}

export function cacheDir(): string {
  return join(userDataDir(), 'cache')
}

export function tempDir(): string {
  return join(userDataDir(), 'tmp')
}
