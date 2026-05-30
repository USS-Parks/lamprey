import { app, BrowserWindow, ipcMain, session, shell, screen, clipboard } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { registerAllIpcHandlers } from './ipc'
import { closeDb } from './services/database'
import { destroy as destroyArtifactSandbox } from './services/artifact-sandbox'
import { mcpManager } from './services/mcp-manager'
import { initializeSkillLoader, shutdownSkillLoader } from './services/skill-loader'
import { destroyTray, handleWindowClose, initializeTray, refreshTrayMenu } from './services/tray'
import { registerGlobalShortcuts } from './services/shortcuts'
import { initializeUpdater, quitAndInstall, checkNow } from './services/updater'
import { readSettings, patchSettings } from './services/settings-helper'

let mainWindow: BrowserWindow | null = null
let suppressBoundsPersist = false
let boundsPersistTimer: NodeJS.Timeout | null = null

const DEFAULT_BOUNDS = { x: undefined as number | undefined, y: undefined as number | undefined, width: 1280, height: 800 }
const MIN_WIDTH = 800
const MIN_HEIGHT = 600

function clampBoundsToScreen(bounds: { x?: number; y?: number; width: number; height: number }) {
  const displays = screen.getAllDisplays()
  // Find a display whose workArea overlaps the saved bounds.
  const target =
    displays.find((d) => {
      if (bounds.x === undefined || bounds.y === undefined) return false
      const wa = d.workArea
      const inside =
        bounds.x + bounds.width > wa.x &&
        bounds.x < wa.x + wa.width &&
        bounds.y + bounds.height > wa.y &&
        bounds.y < wa.y + wa.height
      return inside
    }) ?? screen.getPrimaryDisplay()
  const wa = target.workArea
  const width = Math.min(Math.max(MIN_WIDTH, bounds.width), wa.width)
  const height = Math.min(Math.max(MIN_HEIGHT, bounds.height), wa.height)
  const x = bounds.x === undefined ? undefined : Math.min(Math.max(bounds.x, wa.x), wa.x + wa.width - width)
  const y = bounds.y === undefined ? undefined : Math.min(Math.max(bounds.y, wa.y), wa.y + wa.height - height)
  return { x, y, width, height }
}

function readSavedBounds(): typeof DEFAULT_BOUNDS {
  const settings = readSettings() as {
    windowBounds?: { x?: number; y?: number; width?: number; height?: number }
  }
  const raw = settings.windowBounds
  if (!raw || typeof raw.width !== 'number' || typeof raw.height !== 'number') {
    return DEFAULT_BOUNDS
  }
  return clampBoundsToScreen({
    x: typeof raw.x === 'number' ? raw.x : undefined,
    y: typeof raw.y === 'number' ? raw.y : undefined,
    width: raw.width,
    height: raw.height
  })
}

function schedulePersistBounds(win: BrowserWindow): void {
  if (suppressBoundsPersist) return
  if (boundsPersistTimer) clearTimeout(boundsPersistTimer)
  boundsPersistTimer = setTimeout(() => {
    if (win.isDestroyed()) return
    if (win.isMinimized() || win.isMaximized() || win.isFullScreen()) return
    const b = win.getBounds()
    patchSettings({ windowBounds: { x: b.x, y: b.y, width: b.width, height: b.height } })
  }, 500)
}

function createWindow(): void {
  const bounds = readSavedBounds()

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    backgroundColor: '#0d0d0d',
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.on('move', () => mainWindow && schedulePersistBounds(mainWindow))
  mainWindow.on('resize', () => mainWindow && schedulePersistBounds(mainWindow))

  mainWindow.on('close', (e) => {
    if (!mainWindow) return
    handleWindowClose(mainWindow, e)
  })

  mainWindow.on('show', () => refreshTrayMenu())
  mainWindow.on('hide', () => refreshTrayMenu())
  mainWindow.on('minimize', () => refreshTrayMenu())
  mainWindow.on('restore', () => refreshTrayMenu())

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.url.includes('lamprey-artifact')) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': ["default-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; img-src 'self' data:;"]
        }
      })
    } else {
      callback({ responseHeaders: details.responseHeaders })
    }
  })

  ipcMain.handle('ping', () => 'pong')
  ipcMain.handle('shell:openExternal', (_event, url: string) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      shell.openExternal(url)
    }
  })

  ipcMain.handle('update:restart', async () => {
    await quitAndInstall()
    return { success: true, data: null }
  })

  ipcMain.handle('update:check', async () => {
    const result = await checkNow()
    return result.ok ? { success: true, data: null } : { success: false, error: result.error }
  })

  ipcMain.handle('clipboard:writeText', (_event, text: string) => {
    if (typeof text !== 'string') return { success: false, error: 'text must be a string' }
    clipboard.writeText(text)
    return { success: true, data: null }
  })

  registerAllIpcHandlers()

  try {
    initializeSkillLoader()
  } catch (err) {
    console.error('[main] Skill loader init error:', (err as Error).message)
  }

  mcpManager.initialize().catch((err) => {
    console.error('[main] MCP initialization error:', err.message)
  })

  createWindow()

  initializeTray({ getWindow: getMainWindow })
  registerGlobalShortcuts({ getWindow: getMainWindow })
  initializeUpdater({ getWindow: getMainWindow }).catch((err) => {
    console.error('[main] Updater init failed:', err?.message)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  if (boundsPersistTimer) {
    clearTimeout(boundsPersistTimer)
    boundsPersistTimer = null
  }
  suppressBoundsPersist = true
  mcpManager.shutdown().catch(() => {})
  shutdownSkillLoader()
  destroyArtifactSandbox()
  destroyTray()
  closeDb()
})
