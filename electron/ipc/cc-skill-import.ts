import { ipcMain, dialog, BrowserWindow } from 'electron'
import { discoverCcPlugins, type DiscoveredCcPlugin } from '../services/cc-skill-discovery'
import {
  ejectCcSkill,
  importCcPlugin,
  type ImportResponse
} from '../services/cc-skill-importer'
import { getPlugin } from '../services/plugin-loader'

// Skill Import Phase I3 — IPC bridge for discovery + install. Wraps
// cc-skill-discovery (read-only) and cc-skill-importer (writes into
// userData/plugins). The plugin-loader's chokidar watcher picks up the
// new install directory within ~250ms and broadcasts `plugins:changed`,
// so the renderer's plugin store refreshes without an explicit prod.

export interface DiscoverOptionsPayload {
  extraRoots?: string[]
}

export interface InstallPayload {
  sourcePath: string
  overwrite?: boolean
}

export function registerCcSkillImportHandlers(): void {
  ipcMain.handle('ccImport:discover', async (_event, payload?: DiscoverOptionsPayload) => {
    try {
      const extras = Array.isArray(payload?.extraRoots)
        ? payload!.extraRoots.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        : undefined
      const data: DiscoveredCcPlugin[] = await discoverCcPlugins(
        extras ? { extraRoots: extras } : {}
      )
      return { success: true, data }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('ccImport:install', async (_event, payload: InstallPayload) => {
    try {
      if (!payload || typeof payload !== 'object') {
        return { success: false, error: 'install payload is required' }
      }
      if (typeof payload.sourcePath !== 'string' || !payload.sourcePath.trim()) {
        return { success: false, error: 'sourcePath is required' }
      }
      const overwrite = payload.overwrite === true
      const result: ImportResponse = await importCcPlugin(payload.sourcePath.trim(), {
        overwrite
      })
      if (!result.ok) {
        return {
          success: false,
          error: result.error,
          ...(result.bundleSkippedReason
            ? { bundleSkippedReason: result.bundleSkippedReason }
            : {})
        }
      }
      return {
        success: true,
        data: {
          pluginId: result.pluginId,
          installPath: result.installPath,
          skillsImported: result.skillsImported,
          skipped: result.skipped
        }
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(
    'ccImport:eject',
    async (_event, payload: { pluginId: string; skillSlug: string; overwrite?: boolean }) => {
      try {
        if (!payload?.pluginId || !payload?.skillSlug) {
          return { success: false, error: 'pluginId and skillSlug are required' }
        }
        const plugin = getPlugin(payload.pluginId)
        if (!plugin) return { success: false, error: `Plugin not found: ${payload.pluginId}` }
        const result = ejectCcSkill(plugin.rootPath, payload.skillSlug, {
          ...(payload.overwrite ? { overwrite: true } : {})
        })
        if (!result.ok) return { success: false, error: result.error }
        return {
          success: true,
          data: {
            userSkillSlug: result.userSkillSlug,
            userSkillPath: result.userSkillPath
          }
        }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle('ccImport:pickExtraRoot', async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const opts = {
        title: 'Pick additional Claude Code skills root',
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
