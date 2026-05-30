import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { registerAllIpcHandlers } from './ipc'
import { closeDb } from './services/database'
import { destroy as destroyArtifactSandbox } from './services/artifact-sandbox'
import { mcpManager } from './services/mcp-manager'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
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

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
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
  registerAllIpcHandlers()

  mcpManager.initialize().catch((err) => {
    console.error('[main] MCP initialization error:', err.message)
  })

  createWindow()

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
  mcpManager.shutdown().catch(() => {})
  destroyArtifactSandbox()
  closeDb()
})
