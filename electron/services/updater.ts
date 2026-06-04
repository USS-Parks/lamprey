import { app, BrowserWindow } from 'electron'
import { readSettings } from './settings-helper'

let getWindowRef: (() => BrowserWindow | null) | null = null

function send(channel: string, payload: unknown): void {
  const win = getWindowRef ? getWindowRef() : BrowserWindow.getAllWindows()[0]
  win?.webContents.send(channel, payload)
}

export async function initializeUpdater(opts: {
  getWindow: () => BrowserWindow | null
}): Promise<void> {
  getWindowRef = opts.getWindow
  if (!app.isPackaged) return

  const settings = readSettings()
  if (settings.autoCheckUpdates === false) return

  try {
    const { autoUpdater } = await import('electron-updater')
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('update-available', (info) => {
      send('update:available', {
        version: info?.version ?? null,
        releaseDate: info?.releaseDate ?? null,
        releaseNotes:
          typeof info?.releaseNotes === 'string' ? info.releaseNotes : null
      })
    })
    autoUpdater.on('update-downloaded', (info) => {
      send('update:downloaded', { version: info?.version ?? null })
    })
    autoUpdater.on('error', (err) => {
      // Log only. Auto-update errors are never actionable for the end user:
      // they mean "no release manifest at the configured GitHub repo right
      // now," "transient network failure," or "version is already current and
      // some internal heuristic tripped." Pushing them as a renderer toast
      // spammed users on every startup whenever the repo lacked a published
      // latest.yml. Manual "Check for updates" still returns the error via
      // the IPC return value of update:check, where it IS surfaced.
      console.warn('[updater] background check error (suppressed from UI):', err?.message ?? err)
    })

    await autoUpdater.checkForUpdatesAndNotify()
  } catch (err) {
    console.error('[updater] initialization failed:', (err as Error).message)
  }
}

export async function quitAndInstall(): Promise<void> {
  if (!app.isPackaged) return
  try {
    const { autoUpdater } = await import('electron-updater')
    autoUpdater.quitAndInstall()
  } catch (err) {
    console.error('[updater] quitAndInstall failed:', (err as Error).message)
  }
}

export async function checkNow(): Promise<{ ok: boolean; error?: string }> {
  if (!app.isPackaged) {
    return { ok: false, error: 'Updater only runs in packaged builds.' }
  }
  try {
    const { autoUpdater } = await import('electron-updater')
    await autoUpdater.checkForUpdates()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
