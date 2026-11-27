import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { translate, type UiLanguage } from '@shared/i18n'
import { IPC } from '@shared/ipc'
import type { DefectTableCommand, DefectTableState } from '@shared/defectTable'
import type {
  EngineStatus,
  ExportRequest,
  MediaInfo,
  MediaStreamInfo,
  ModelId,
  Settings,
  TranscribeRequest,
  VideoExportRequest
} from '@shared/types'
import { engineBinary, ffmpegBinary } from './paths'
import { probeMedia } from './engine/ffmpeg'
import {
  checkModelUpdates,
  downloadModel,
  deleteModel,
  modelState,
  modelStates
} from './engine/models'
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
import { cancelVideoExport, exportVideo } from './videoExport'
import { loadSettings, saveSettings } from './settings'
import { currentUiLanguage } from './uiLanguage'

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
  if (!info.isFile()) throw new Error(translate(currentUiLanguage(), 'error.notAFile'))
  if (!MEDIA_EXTENSIONS.has(extname(absolute).toLowerCase())) {
    throw new Error(translate(currentUiLanguage(), 'error.unsupportedMedia'))
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
  /** The defect table mirror window, when it is open. */
  getTableWindow: () => BrowserWindow | null
  openTableWindow: () => void
  closeTableWindow: () => void
  /** Rebuilds the native menu and other main-process chrome after a switch. */
  onUiLanguageChange?: (lang: UiLanguage) => void
}

export function registerIpc(dependencies: IpcDependencies): TranscriptionManager {
  const { getWindow, getTableWindow, openTableWindow, closeTableWindow, onUiLanguageChange } =
    dependencies
  const t = (key: Parameters<typeof translate>[1]): string =>
    translate(currentUiLanguage(), key)

  const send = (channel: string, payload: unknown): void => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
  }

  const isMainSender = (event: Electron.IpcMainEvent): boolean => {
    const window = getWindow()
    return Boolean(window && !window.isDestroyed() && event.sender === window.webContents)
  }

  const isTableSender = (event: Electron.IpcMainEvent): boolean => {
    const window = getTableWindow()
    return Boolean(window && !window.isDestroyed() && event.sender === window.webContents)
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
    const previous = currentUiLanguage()
    await saveSettings(settings)
    if (settings.uiLanguage !== previous) onUiLanguageChange?.(settings.uiLanguage)
  })

  ipcMain.handle(IPC.mediaOpen, async (): Promise<MediaInfo | null> => {
    const window = getWindow()
    const options = {
      title: t('dialog.openRecording'),
      properties: ['openFile' as const],
      filters: [
        { name: t('dialog.mediaFilter'), extensions: [...MEDIA_EXTENSIONS].map((ext) => ext.slice(1)) },
        { name: t('dialog.allFiles'), extensions: ['*'] }
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

  // The export dialog builds the same plan as the export to show the exact
  // mixed length; it needs only the stream rates. A source that cannot be
  // probed returns null and the dialog keeps its cut-list fallback.
  ipcMain.handle(
    IPC.mediaProbe,
    async (_event, path: string): Promise<MediaStreamInfo | null> => {
      if (!path) return null
      const ffmpeg = ffmpegBinary()
      if (!(await executable(ffmpeg))) return null
      try {
        const probe = await probeMedia(ffmpeg, path)
        return {
          hasVideo: probe.hasVideo,
          hasAudio: probe.hasAudio,
          fps: probe.fps,
          sampleRate: probe.sampleRate
        }
      } catch {
        return null
      }
    }
  )

  ipcMain.handle(IPC.mediaRegister, async (_event, path: string) => {
    const info = await stat(path).catch(() => null)
    if (!info || !info.isFile()) throw new Error(t('error.fileNotFound'))
    return registerMedia(path)
  })

  ipcMain.handle(IPC.projectsList, async () => listProjects())

  ipcMain.handle(IPC.projectsCreate, async (_event, media: MediaInfo) => {
    const settings = await loadSettings()
    const ffmpeg = ffmpegBinary()
    if (!(await executable(ffmpeg))) {
      throw new Error(t('error.ffmpegMissing'))
    }
    const probe = await probeMedia(ffmpeg, media.path)
    if (!probe.hasAudio) throw new Error(t('error.noAudioTrack'))
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
  ipcMain.handle(IPC.modelsState, async () => modelStates())
  ipcMain.handle(IPC.modelsDelete, async (_event, id: ModelId) => {
    await deleteModel(id)
  })
  ipcMain.handle(IPC.modelsCheckUpdates, async () => checkModelUpdates())

  ipcMain.handle(IPC.exportProject, async (_event, request: ExportRequest) => {
    return exportProject(getWindow(), request)
  })

  ipcMain.handle(IPC.exportVideo, async (_event, request: VideoExportRequest) => {
    return exportVideo(getWindow(), request, (progress) =>
      send(IPC.videoExportProgress, progress)
    )
  })
  ipcMain.handle(IPC.exportVideoCancel, async () => {
    cancelVideoExport()
  })

  ipcMain.handle(IPC.tableOpen, async () => {
    openTableWindow()
  })
  ipcMain.handle(IPC.tableClose, async () => {
    closeTableWindow()
  })

  // The main window owns the project; the table window is a passive mirror.
  // Both directions cross the main process, so neither renderer receives the
  // other's webContents and the preload surface stays a narrow typed API.
  ipcMain.on(IPC.tableSync, (event, state: DefectTableState) => {
    if (!isMainSender(event)) return
    const table = getTableWindow()
    if (table && !table.isDestroyed()) table.webContents.send(IPC.tableState, state)
  })
  ipcMain.on(IPC.tableReady, (event) => {
    if (!isTableSender(event)) return
    send(IPC.tableReady, undefined)
  })
  ipcMain.on(IPC.tableCommand, (event, command: DefectTableCommand) => {
    if (!isTableSender(event)) return
    send(IPC.tableCommand, command)
  })

  ipcMain.handle(IPC.shellShowItem, async (_event, path: string) => {
    shell.showItemInFolder(path)
  })

  return manager
}
