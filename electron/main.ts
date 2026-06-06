import { app, BrowserWindow, ipcMain, session, shell, screen, clipboard } from 'electron'
import { basename, extname, join } from 'path'
import { readFileSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import { registerAllIpcHandlers } from './ipc'
import { closeDb } from './services/database'
import { destroy as destroyArtifactSandbox } from './services/artifact-sandbox'
import { ptyKillAll } from './services/pty-manager'
import { destroyAll as destroyBrowserTabs } from './services/browser-manager'
import { destroyAllDevServers } from './services/dev-server-manager'
import { destroyAllBackgroundShells } from './services/shell-tool'
import { destroyAllMonitors } from './services/monitor-service'
import { fireHooks } from './services/hooks-runner'
import { setUserDataPathProvider as setProviderUserDataPath } from './services/providers/registry'
import { setPipelineUserDataPathProvider } from './services/agent-pipeline'
import {
  setDebugTraceUserDataPath,
  forceDebugTraceOn,
  trace,
  flushTrace
} from './services/debug-trace'
import { startAutomations, stopAutomations } from './services/automations-runner'
import { startLoopWakeups, stopLoopWakeups } from './services/loop-runner'
import { mcpManager } from './services/mcp-manager'
import { ensureNodeReplDefaultServer } from './services/node-repl-default-server'
import { initializeSkillLoader, shutdownSkillLoader } from './services/skill-loader'
import { initializePluginLoader, shutdownPluginLoader } from './services/plugin-loader'
import { initializeFilterLoader, shutdownFilterLoader } from './services/snip'
import { initializeMemoryStore, shutdownMemoryStore } from './services/memory-store'
import { backfillSessionsFts } from './services/conversation-store'
import {
  initializeSlashCommandLoader,
  shutdownSlashCommandLoader
} from './services/slash-commands'
import { shutdownReviewWatcher } from './ipc/review'
import { destroyTray, handleWindowClose, initializeTray, refreshTrayMenu } from './services/tray'
import { registerGlobalShortcuts } from './services/shortcuts'
import { initializeUpdater, quitAndInstall, checkNow } from './services/updater'
import { readSettings, patchSettings } from './services/settings-helper'
import {
  formatHeadlessResult,
  isHeadlessCliArgv,
  runHeadlessFromArgv
} from './services/headless-runner'

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
const splashStart = Date.now()
const SPLASH_MIN_MS = 3000
let suppressBoundsPersist = false
let boundsPersistTimer: NodeJS.Timeout | null = null

// Duplicate-launch protection. GUI launches must run as a single Electron
// process — two parallel processes would each open their own SQLite handle
// on lamprey.db, spin up their own MCP clients, and race on the same userData
// dirs. Headless CLI invocations (lamprey --headless ...) are exempted: each
// is a one-shot run that exits cleanly, and the user may legitimately fan
// them out in parallel from a shell. For GUI launches, the second process
// exits immediately and the existing window restores + focuses.
if (!isHeadlessCliArgv(process.argv)) {
  const gotTheLock = app.requestSingleInstanceLock()
  if (!gotTheLock) {
    app.quit()
    process.exit(0)
  }
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

function reportToRenderer(channel: 'app:error' | 'app:warning', message: string): void {
  try {
    mainWindow?.webContents.send(channel, { message })
  } catch {
    // window may already be destroyed during shutdown
  }
}

// electron-updater's internal HTTP path raises a secondary "write after end"
// stream error when a release is missing latest.yml — and the original 404
// itself can also escape its promise chain. Both surface here as unhandled
// rejections / exceptions, get forwarded to the renderer, and pop the
// scary stack trace in the right panel. None of it is actionable for the
// user: it just means "no update available right now." Suppress the
// renderer push for anything that originated in electron-updater or the
// known stream-close pattern; the log channel still records it.
function extractErrorMeta(reason: unknown): { msg: string; stack: string; code: string } {
  if (reason instanceof Error) {
    return {
      msg: reason.message ?? '',
      stack: reason.stack ?? '',
      code: (reason as { code?: unknown }).code === undefined ? '' : String((reason as { code?: unknown }).code)
    }
  }
  // Some libraries (electron-updater included) reject with plain objects that
  // carry .message / .code / .stack without being an Error instance. The old
  // version of this check fell back to String(reason) which yields
  // "[object Object]" and skipped the regex.
  if (reason && typeof reason === 'object') {
    const obj = reason as Record<string, unknown>
    const rawMsg = typeof obj.message === 'string' ? obj.message : ''
    return {
      msg: rawMsg || String(reason),
      stack: typeof obj.stack === 'string' ? obj.stack : '',
      code: typeof obj.code === 'string' ? obj.code : ''
    }
  }
  return { msg: String(reason ?? ''), stack: '', code: '' }
}

function isUpdaterNoise(reason: unknown): boolean {
  const { msg, stack, code } = extractErrorMeta(reason)
  // Stack-based: any frame that originated inside electron-updater, the
  // ElectronHttpExecutor (its HTTP adapter), or the SimpleURLLoaderWrapper
  // (Electron's net.request stream wrapper) is updater plumbing — never the
  // app's own code path.
  if (/electron-updater|ElectronHttpExecutor|SimpleURLLoaderWrapper|app-update\.yml|latest\.yml/i.test(stack)) {
    return true
  }
  // Message-based: the GitHub 404 emits a verbose blob that always contains
  // either the releases-download URL or the "double check your auth token"
  // canned message from createHttpError.
  if (/releases\/download\/v[\d.]+\/latest\.yml/i.test(msg)) return true
  if (/Please double check that your authentication token is correct/i.test(msg)) return true
  if (/HttpError:\s*\d+/i.test(msg)) return true
  // Stream lifecycle: the secondary error electron-updater emits when its
  // ClientRequest is destroyed during the 404 path. No application-layer
  // "write after end" exists in this app — every Node stream we use is one
  // we own, and we don't write to closed sockets. Anything matching is
  // library plumbing.
  if (/write after end/i.test(msg)) return true
  if (/Cannot call write after a stream was destroyed/i.test(msg)) return true
  if (code === 'ERR_STREAM_WRITE_AFTER_END' || code === 'ERR_STREAM_DESTROYED') return true
  // EPIPE on background HTTP from updater shouldn't kill the app either.
  if (code === 'EPIPE' && /electron-updater|update/i.test(stack)) return true
  return false
}

process.on('unhandledRejection', (reason) => {
  const { msg } = extractErrorMeta(reason)
  if (isUpdaterNoise(reason)) {
    console.warn('[updater] suppressed unhandled rejection:', msg)
    return
  }
  console.error('[main] unhandledRejection:', msg)
  reportToRenderer('app:error', `Unhandled error: ${msg}`)
})

process.on('uncaughtException', (err) => {
  const { msg } = extractErrorMeta(err)
  if (isUpdaterNoise(err)) {
    console.warn('[updater] suppressed uncaught exception:', msg)
    return
  }
  console.error('[main] uncaughtException:', msg)
  reportToRenderer('app:error', `Unhandled error: ${msg}`)
})

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

function resolveSplashPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'splash.png')
  return join(app.getAppPath(), 'ASSETS', 'Lamprey Desktop Icon-1.png')
}

function resolveAppIconPath(): string {
  // Prefer .ico on Windows — it carries multi-resolution sub-images and is
  // what the OS uses for taskbar / window-class icons.
  if (app.isPackaged) {
    return process.platform === 'win32'
      ? join(process.resourcesPath, 'icon.ico')
      : join(process.resourcesPath, 'icon.png')
  }
  if (process.platform === 'win32') {
    return join(app.getAppPath(), 'resources', 'icon.ico')
  }
  return join(app.getAppPath(), 'ASSETS', 'Lamprey Desktop Icon-1.png')
}

function createSplashWindow(): void {
  const splashPath = resolveSplashPath()
  splashWindow = new BrowserWindow({
    width: 540,
    height: 540,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // The splash HTML is served from a data: URL. Recent Chromium blocks
  // file:// requests originating from data: documents, so we can't reference
  // splashPath via <img src="file://..."> — it silently fails to load.
  // Inline the PNG bytes as a base64 data:image/png src instead.
  let imgSrc = ''
  try {
    const bytes = readFileSync(splashPath)
    const ext = extname(splashPath).toLowerCase().slice(1) || 'png'
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
    imgSrc = `data:${mime};base64,${bytes.toString('base64')}`
  } catch (err) {
    console.error('[main] splash image read failed:', (err as Error).message, splashPath)
  }

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
    html,body{margin:0;padding:0;background:transparent;overflow:hidden;height:100vh;width:100vw;display:flex;align-items:center;justify-content:center}
    img{max-width:100%;max-height:100%;object-fit:contain;animation:fade-in 600ms ease-out both}
    @keyframes fade-in{from{opacity:0;transform:scale(0.96)}to{opacity:1;transform:scale(1)}}
  </style></head><body>${imgSrc ? `<img src="${imgSrc}" alt="Lamprey"/>` : ''}</body></html>`
  splashWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  splashWindow.once('ready-to-show', () => splashWindow?.show())
}

function closeSplashWhenReady(): void {
  const elapsed = Date.now() - splashStart
  const wait = Math.max(0, SPLASH_MIN_MS - elapsed)
  setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close()
      splashWindow = null
    }
    mainWindow?.show()
  }, wait)
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
    icon: resolveAppIconPath(),
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
    closeSplashWhenReady()
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
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximizedChanged', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximizedChanged', false)
  })

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
  // Match electron-builder's appId so Windows associates pinned taskbar /
  // start-menu entries with this app's icon and JumpLists. Without this,
  // Windows can group the running window under a different AUMID and show
  // a stale cached icon.
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.lamprey.harness')
  }

  if (isHeadlessCliArgv(process.argv)) {
    void (async () => {
      let exitCode = 0
      try {
        initializeMemoryStore()
        const { result, json } = await runHeadlessFromArgv(process.argv)
        const text = formatHeadlessResult(result, json)
        if (result.success) {
          process.stdout.write(text + '\n')
        } else {
          exitCode = 1
          process.stderr.write(text + '\n')
        }
      } catch (err) {
        exitCode = 1
        const result = {
          success: false as const,
          error: err instanceof Error ? err.message : String(err)
        }
        process.stderr.write(formatHeadlessResult(result, process.argv.includes('--json')) + '\n')
      } finally {
        stopLoopWakeups()
        stopAutomations()
        shutdownMemoryStore()
        closeDb()
        app.exit(exitCode)
      }
    })()
    return
  }

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

  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize()
    return { success: true, data: null }
  })

  ipcMain.handle('window:maximizeToggle', () => {
    if (!mainWindow) return { success: true, data: false }
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return { success: true, data: mainWindow.isMaximized() }
  })

  ipcMain.handle('window:close', () => {
    mainWindow?.close()
    return { success: true, data: null }
  })

  ipcMain.handle('window:isMaximized', () => {
    return { success: true, data: mainWindow?.isMaximized() ?? false }
  })

  ipcMain.handle('window:reload', () => {
    mainWindow?.webContents.reload()
    return { success: true, data: null }
  })

  ipcMain.handle('window:toggleDevTools', () => {
    mainWindow?.webContents.toggleDevTools()
    return { success: true, data: null }
  })

  ipcMain.handle('app:getDataDir', () => {
    const userData = app.getPath('userData')
    return {
      success: true,
      data: {
        userData,
        dbPath: join(userData, 'lamprey.db')
      }
    }
  })

  ipcMain.handle('app:openPath', async (_event, p: string) => {
    try {
      const { shell } = await import('electron')
      const err = await shell.openPath(p)
      if (err) return { success: false, error: err }
      return { success: true, data: null }
    } catch (e: any) {
      return { success: false, error: e?.message ?? 'openPath failed' }
    }
  })

  ipcMain.handle('app:getWorkingFolder', () => {
    // In dev, app.getAppPath() returns the project root (e.g. "Lamprey Harness").
    // In a packaged build it returns the path to app.asar — fall back to the
    // executable's parent folder, which is the install directory the user sees.
    let raw = app.getAppPath()
    let name = basename(raw)
    if (name === 'app.asar' || name === 'app') {
      raw = join(app.getPath('exe'), '..')
      name = basename(raw)
      if (!name) name = app.getName()
    }
    return { success: true, data: { name, fullPath: raw } }
  })

  // T1 — let chatStream's inactivity watchdog read settings.json without
  // dragging an electron import into provider-layer tests.
  setProviderUserDataPath(() => app.getPath('userData'))
  // T3 — same trick for the pipeline's per-stage wall-clock budgets.
  setPipelineUserDataPathProvider(() => app.getPath('userData'))
  // DBG1 — wire the diagnostic trace writer + force it on for this debug
  // build so the user doesn't have to flip `debugTrace: true` themselves.
  // Remove `forceDebugTraceOn()` before shipping a non-debug build.
  setDebugTraceUserDataPath(() => app.getPath('userData'))
  forceDebugTraceOn()
  trace('main.boot', {
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
    userData: app.getPath('userData')
  })
  app.on('before-quit', () => {
    trace('main.before-quit')
    flushTrace()
  })

  registerAllIpcHandlers()

  try {
    createSplashWindow()
  } catch (err) {
    console.error('[main] Splash window init error:', (err as Error).message)
  }

  try {
    initializeSkillLoader()
  } catch (err) {
    console.error('[main] Skill loader init error:', (err as Error).message)
  }

  // Customize C7 — plugin manifest loader. Bootstraps bundled plugins
  // from resources/plugins/ into userData/plugins/ on first run; then
  // serves all subsequent reads from userData with chokidar hot-reload.
  try {
    initializePluginLoader()
  } catch (err) {
    console.error('[main] Plugin loader init error:', (err as Error).message)
  }

  // Snip Phase K10 — load YAML filters under resources/snip-filters/
  // (built-in) and userData/snip/filters/ (user); chokidar hot-reload.
  try {
    initializeFilterLoader()
  } catch (err) {
    console.error('[main] Snip filter loader init error:', (err as Error).message)
  }

  // Track 2 / C4 — slash commands. Watches userData/slash-commands for
  // live edits; bootstraps the bundled built-ins on first run.
  try {
    initializeMemoryStore()
  } catch (err) {
    console.error('[main] Memory store init error:', (err as Error).message)
  }

  try {
    const fts = backfillSessionsFts(false)
    if (fts.rebuilt) console.log(`[main] sessions FTS backfilled: ${fts.rows} rows`)
  } catch (err) {
    console.error('[main] Sessions FTS backfill error:', (err as Error).message)
  }

  try {
    initializeSlashCommandLoader()
  } catch (err) {
    console.error('[main] Slash-command loader init error:', (err as Error).message)
  }

  try {
    void fireHooks('sessionStart')
    startAutomations()
    startLoopWakeups()
  } catch (err) {
    console.error('[main] hooks/automations/loops init error:', (err as Error).message)
  }

  mcpManager.initialize()
    .then(() => ensureNodeReplDefaultServer())
    .catch((err) => {
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
  shutdownPluginLoader()
  shutdownFilterLoader()
  shutdownMemoryStore()
  shutdownSlashCommandLoader()
  destroyArtifactSandbox()
  destroyTray()
  ptyKillAll()
  destroyBrowserTabs()
  destroyAllDevServers()
  destroyAllBackgroundShells()
  destroyAllMonitors()
  stopAutomations()
  stopLoopWakeups()
  void shutdownReviewWatcher()
  closeDb()
})
