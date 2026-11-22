import { app, BrowserWindow, dialog, Menu, protocol, shell } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { translate, type UiLanguage } from '@shared/i18n'
import { cacheDir, isDev, modelsDir, projectsDir, tempDir } from './paths'
import { registerMediaProtocol } from './mediaServer'
import { registerIpc } from './ipc'
import { cancelVideoExport } from './videoExport'
import { loadSettings } from './settings'
import { currentUiLanguage } from './uiLanguage'
import type { TranscriptionManager } from './jobs'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  }
])

let mainWindow: BrowserWindow | null = null
let manager: TranscriptionManager | null = null

app.setName('Speech Review')

function sendMenu(action: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('menu:action', action)
  }
}

function buildMenu(lang: UiLanguage = currentUiLanguage()): void {
  const t = (key: Parameters<typeof translate>[1]): string => translate(lang, key)
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: t('menu.settings'),
                accelerator: 'Cmd+,',
                click: () => sendMenu('settings')
              },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: t('menu.file'),
      submenu: [
        {
          label: t('menu.openRecording'),
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenu('open-video')
        },
        {
          label: t('menu.settings'),
          accelerator: isMac ? undefined : 'Ctrl+,',
          visible: !isMac,
          click: () => sendMenu('settings')
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: t('menu.edit'),
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: t('menu.view'),
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: t('menu.help'),
      submenu: [
        {
          label: t('menu.modelLicense'),
          click: () => {
            void shell.openExternal(
              'https://huggingface.co/audio-cpp/audio.cpp-gguf/blob/main/CrisperWhisper2.0-GGUF/LICENSE.md'
            )
          }
        },
        {
          label: t('menu.audioCppGithub'),
          click: () => {
            void shell.openExternal('https://github.com/0xShug0/audio.cpp')
          }
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#0b0e14',
    title: 'Speech Review',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 18 } : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL() ?? ''
    if (url !== current && /^https?:/i.test(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (isDev && devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    if (process.platform === 'darwin' && isDev) {
      app.dock?.setIcon(join(__dirname, '../../build/icon.png'))
    }

    // Load settings before building the menu so the first render already has
    // the persisted UI language.
    const settings = await loadSettings()
    const lang = settings.uiLanguage
    app.setAboutPanelOptions({
      applicationName: 'Speech Review',
      applicationVersion: app.getVersion(),
      credits: translate(lang, 'menu.aboutCredits')
    })

    await Promise.all([
      mkdir(modelsDir(), { recursive: true }),
      mkdir(projectsDir(), { recursive: true }),
      mkdir(cacheDir(), { recursive: true }),
      mkdir(tempDir(), { recursive: true })
    ])

    registerMediaProtocol()
    manager = registerIpc({
      getWindow: () => mainWindow,
      onUiLanguageChange: (next) => {
        buildMenu(next)
        app.setAboutPanelOptions({
          applicationName: 'Speech Review',
          applicationVersion: app.getVersion(),
          credits: translate(next, 'menu.aboutCredits')
        })
      }
    })
    buildMenu(lang)
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox(
      translate(currentUiLanguage(), 'menu.startupError'),
      message
    )
    app.quit()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    manager?.cancelAll()
    cancelVideoExport()
  })
}
