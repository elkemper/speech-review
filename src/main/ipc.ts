import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { IPC } from '@shared/ipc'
import type {
  EngineStatus,
  ExportRequest,
  MediaInfo,
  ModelId,
  Settings,
  TranscribeRequest
} from '@shared/types'
import { engineBinary, ffmpegBinary } from './paths'
import { probeMedia } from './engine/ffmpeg'
import { downloadModel, modelState } from './engine/models'
import { registerMedia } from './mediaServer'
import { TranscriptionManager } from './jobs'
import {
  createProject,
  deleteProject,
  listProjects,
  loadProject,
  saveProject
} from './projects'
import { exportProject } from './export'
import { loadSettings, saveSettings } from './settings'

const MEDIA_EXTENSIONS = new Set([
  '.mp4',
  '.m4v',
  '.mov',
  '.webm',
  '.mkv',
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.ogg',
  '.opus'
])

async function executable(path: string): Promise<boolean> {
  if (!path) return false
  return access(path, constants.X_OK)
    .then(() => true)
    .catch(() => false)
}

async function mediaInfo(path: string): Promise<MediaInfo> {
  const absolute = resolve(path)
  const info = await stat(absolute)
  if (!info.isFile()) throw new Error('Это не файл')
  if (!MEDIA_EXTENSIONS.has(extname(absolute).toLowerCase())) {
    throw new Error('Поддерживаются видео и аудио: MP4, MOV, WebM, MKV, MP3, WAV, M4A, OGG')
  }
  return {
    path: absolute,
    name: basename(absolute),
    size: info.size,
    mtimeMs: info.mtimeMs
  }
}

export interface IpcDependencies {
  getWindow: () => BrowserWindow | null
}

export function registerIpc(dependencies: IpcDependencies): TranscriptionManager {
  const { getWindow } = dependencies

  const send = (channel: string, payload: unknown): void => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
  }

  const manager = new TranscriptionManager({
    progress: (progress) => send(IPC.transcribeProgress, progress),
    partial: (partial) => send(IPC.transcribePartial, partial),
    done: (done) => send(IPC.transcribeDone, done),
    error: (error) => send(IPC.transcribeError, error)
  })

  ipcMain.handle(IPC.engineStatus, async (): Promise<EngineStatus> => {
    const settings = await loadSettings()
    const cli = engineBinary()
    const ffmpeg = ffmpegBinary()
    const model = await modelState(settings.modelId)
    return {
      enginePath: cli,
      engineReady: await executable(cli),
      ffmpegPath: ffmpeg || null,
      ffmpegReady: await executable(ffmpeg),
      modelPath: model.path,
      modelReady: model.ready,
      modelId: settings.modelId,
      modelBytes: model.bytes,
      backend: settings.backend,
      platform: `${process.platform}-${process.arch}`,
      appVersion: app.getVersion()
    }
  })

  ipcMain.handle(IPC.settingsGet, async (): Promise<Settings> => loadSettings())
  ipcMain.handle(IPC.settingsSave, async (_event, settings: Settings): Promise<void> => {
    await saveSettings(settings)
  })

  ipcMain.handle(IPC.mediaOpen, async (): Promise<MediaInfo | null> => {
    const window = getWindow()
    const options = {
      title: 'Открыть запись вебинара',
      properties: ['openFile' as const],
      filters: [
        { name: 'Видео и аудио', extensions: [...MEDIA_EXTENSIONS].map((ext) => ext.slice(1)) },
        { name: 'Все файлы', extensions: ['*'] }
      ]
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return mediaInfo(result.filePaths[0])
  })

  ipcMain.handle(IPC.mediaOpenPath, async (_event, path: string): Promise<MediaInfo | null> => {
    if (!path) return null
    return mediaInfo(path)
  })

  ipcMain.handle(IPC.mediaRegister, async (_event, path: string) => {
    const info = await stat(path).catch(() => null)
    if (!info || !info.isFile()) throw new Error('Файл не найден')
    return registerMedia(path)
  })

  ipcMain.handle(IPC.projectsList, async () => listProjects())

  ipcMain.handle(IPC.projectsCreate, async (_event, media: MediaInfo) => {
    const settings = await loadSettings()
    const ffmpeg = ffmpegBinary()
    if (!(await executable(ffmpeg))) {
      throw new Error('ffmpeg не найден. Запустите npm run fetch:engine и перезапустите приложение.')
    }
    const probe = await probeMedia(ffmpeg, media.path)
    if (!probe.hasAudio) throw new Error('В выбранном файле нет аудиодорожки')
    return createProject(media, probe.duration, settings)
  })

  ipcMain.handle(IPC.projectsLoad, async (_event, id: string) => loadProject(id))
  ipcMain.handle(IPC.projectsSave, async (_event, project) => saveProject(project))
  ipcMain.handle(IPC.projectsDelete, async (_event, id: string) => {
    manager.cancelProject(id)
    await deleteProject(id)
  })

  ipcMain.handle(IPC.transcribeStart, async (_event, request: TranscribeRequest) => {
    return manager.start(request)
  })
  ipcMain.handle(IPC.transcribeCancel, async (_event, jobId: string) => manager.cancel(jobId))

  ipcMain.handle(IPC.modelsDownload, async (_event, id: ModelId) => {
    const path = await downloadModel(id, {
      onProgress: (percent, message) => send(IPC.modelProgress, { modelId: id, percent, message })
    })
    return { path }
  })

  ipcMain.handle(IPC.exportProject, async (_event, request: ExportRequest) => {
    return exportProject(getWindow(), request)
  })

  ipcMain.handle(IPC.shellShowItem, async (_event, path: string) => {
    shell.showItemInFolder(path)
  })

  return manager
}
