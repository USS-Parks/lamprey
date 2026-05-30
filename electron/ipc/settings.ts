import { ipcMain } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import * as keychain from '../services/keychain'
import { deepseekClient } from '../services/deepseek'

const getSettingsPath = () => join(app.getPath('userData'), 'settings.json')

const defaultSettings = {
  theme: 'dark' as const,
  fontSize: 14,
  defaultModel: 'deepseek-chat',
  sidebarCollapsed: false,
  artifactPanelWidth: 420,
  minimizeToTray: false,
  autoCheckUpdates: true
}

function readSettings() {
  const settingsPath = getSettingsPath()
  if (!existsSync(settingsPath)) return { ...defaultSettings }
  try {
    const data = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    return { ...defaultSettings, ...data }
  } catch {
    return { ...defaultSettings }
  }
}

function writeSettings(settings: Record<string, unknown>): void {
  writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get', async () => {
    try {
      return { success: true, data: readSettings() }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('settings:set', async (_event, partial) => {
    try {
      const current = readSettings()
      const updated = { ...current, ...partial }
      writeSettings(updated)
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('settings:saveApiKey', async (_event, key) => {
    try {
      keychain.setKey('deepseek', key)
      deepseekClient.resetClient()
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('settings:hasApiKey', async () => {
    try {
      return { success: true, data: keychain.hasKey('deepseek') }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('settings:testApiKey', async () => {
    try {
      const valid = await deepseekClient.validateKey()
      return { success: true, data: valid }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('settings:saveGoogleCredentials', async (_event, clientId, clientSecret) => {
    try {
      keychain.setKey('google-client-id', clientId)
      keychain.setKey('google-client-secret', clientSecret)
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
