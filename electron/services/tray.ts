import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { readSettings } from './settings-helper'

let tray: Tray | null = null
let getWindowRef: (() => BrowserWindow | null) | null = null

function resolveIconPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'icon.png')
  return join(app.getAppPath(), 'resources', 'icon.png')
}

function buildIcon() {
  const img = nativeImage.createFromPath(resolveIconPath())
  if (img.isEmpty()) return img
  return img.resize({ width: 16, height: 16 })
}

function activeWindow(): BrowserWindow | null {
  return getWindowRef ? getWindowRef() : BrowserWindow.getAllWindows()[0] ?? null
}

function toggleWindow(): void {
  const win = activeWindow()
  if (!win) return
  if (win.isVisible() && !win.isMinimized()) {
    win.hide()
  } else {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

function showWindow(): void {
  const win = activeWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function startNewConversation(): void {
  showWindow()
  const win = activeWindow()
  win?.webContents.send('tray:newConversation')
}

function rebuildMenu(): void {
  if (!tray) return
  const settings = readSettings()
  const minimizeToTray = settings.minimizeToTray === true
  const win = activeWindow()
  const visible = !!win && win.isVisible() && !win.isMinimized()
  const menu = Menu.buildFromTemplate([
    {
      label: visible ? 'Hide Lamprey' : 'Show Lamprey',
      click: () => toggleWindow()
    },
    {
      label: 'New Conversation',
      accelerator: process.platform === 'darwin' ? 'Cmd+N' : 'Ctrl+N',
      click: () => startNewConversation()
    },
    { type: 'separator' },
    {
      label: minimizeToTray ? 'Quit Lamprey' : 'Quit',
      click: () => {
        ;(app as any).isQuittingFromTray = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
}

export function initializeTray(opts: { getWindow: () => BrowserWindow | null }): void {
  if (tray) return
  getWindowRef = opts.getWindow
  try {
    tray = new Tray(buildIcon())
    tray.setToolTip('Lamprey')
    tray.on('click', () => toggleWindow())
    tray.on('right-click', () => {
      rebuildMenu()
      tray?.popUpContextMenu()
    })
    rebuildMenu()
  } catch (err) {
    console.error('[tray] failed to create tray:', (err as Error).message)
    tray = null
  }
}

export function refreshTrayMenu(): void {
  rebuildMenu()
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}

/**
 * When a BrowserWindow's close event fires, decide between hiding-to-tray and quitting based on
 * the persisted `minimizeToTray` setting. Returns `true` if the close was intercepted (window
 * hidden), `false` if the window should proceed to close.
 */
export function handleWindowClose(win: BrowserWindow, e: Electron.Event): boolean {
  const settings = readSettings()
  const minimizeToTray = settings.minimizeToTray === true
  const quittingFromTray = (app as any).isQuittingFromTray === true
  if (minimizeToTray && tray && !quittingFromTray) {
    e.preventDefault()
    win.hide()
    rebuildMenu()
    return true
  }
  return false
}
