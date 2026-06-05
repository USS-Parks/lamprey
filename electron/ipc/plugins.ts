import { ipcMain, dialog, BrowserWindow } from 'electron'
import {
  listPlugins,
  getPlugin,
  setPluginEnabled,
  removePlugin,
  installFromDirectory
} from '../services/plugin-loader'

export function registerPluginsHandlers(): void {
  ipcMain.handle('plugins:list', async () => {
    try {
      return { success: true, data: listPlugins() }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('plugins:get', async (_event, id: string) => {
    try {
      const plugin = getPlugin(id)
      if (!plugin) return { success: false, error: `Plugin not found: ${id}` }
      return { success: true, data: plugin }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('plugins:enable', async (_event, id: string) => {
    try {
      const ok = setPluginEnabled(id, true)
      if (!ok) return { success: false, error: `Plugin not found: ${id}` }
      return { success: true, data: null }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('plugins:disable', async (_event, id: string) => {
    try {
      const ok = setPluginEnabled(id, false)
      if (!ok) return { success: false, error: `Plugin not found: ${id}` }
      return { success: true, data: null }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('plugins:remove', async (_event, id: string) => {
    try {
      const ok = removePlugin(id)
      if (!ok) return { success: false, error: `Plugin not found or could not be removed: ${id}` }
      return { success: true, data: null }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('plugins:installFromDirectory', async (_event, srcPath: string) => {
    try {
      if (typeof srcPath !== 'string' || !srcPath.trim()) {
        return { success: false, error: 'srcPath is required' }
      }
      const result = installFromDirectory(srcPath.trim())
      if (!result.ok) return { success: false, error: result.error }
      return { success: true, data: { id: result.id } }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('plugins:installFromUrl', async (_event, _url: string) => {
    // C10 wires the real URL-fetch + extract + validate flow. C8 ships
    // the stub so the preload bridge + store can be exercised end-to-end.
    return { success: false, error: 'URL install lands in C10' }
  })

  ipcMain.handle('plugins:pickDirectory', async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const opts = {
        title: 'Select plugin directory',
        properties: ['openDirectory'] as Array<'openDirectory'>
      }
      const res = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts)
      if (res.canceled || res.filePaths.length === 0) {
        return { success: true, data: null }
      }
      return { success: true, data: res.filePaths[0] }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}
