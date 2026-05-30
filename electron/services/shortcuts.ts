import { app, BrowserWindow, globalShortcut } from 'electron'

const TOGGLE = 'CommandOrControl+Shift+L'
const COPY_LAST = 'CommandOrControl+Shift+C'

let getWindowRef: (() => BrowserWindow | null) | null = null

function activeWindow(): BrowserWindow | null {
  return getWindowRef ? getWindowRef() : BrowserWindow.getAllWindows()[0] ?? null
}

function toggleWindow(): void {
  const win = activeWindow()
  if (!win) return
  if (win.isVisible() && !win.isMinimized() && win.isFocused()) {
    win.hide()
  } else {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

function copyLastAssistant(): void {
  const win = activeWindow()
  if (!win) return
  win.webContents.send('shortcut:copyLastAssistant')
}

export function registerGlobalShortcuts(opts: { getWindow: () => BrowserWindow | null }): void {
  getWindowRef = opts.getWindow

  if (!globalShortcut.register(TOGGLE, toggleWindow)) {
    console.warn('[shortcuts] failed to register', TOGGLE)
  }
  if (!globalShortcut.register(COPY_LAST, copyLastAssistant)) {
    console.warn('[shortcuts] failed to register', COPY_LAST)
  }

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
  })
}
