import { ipcMain } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import * as keychain from '../services/keychain'
import { deepseekClient } from '../services/deepseek'
import {
  PROVIDERS,
  resetProviderClient,
  validateProviderKey,
  type ProviderId
} from '../services/providers/registry'

const getSettingsPath = () => join(app.getPath('userData'), 'settings.json')

const defaultSettings = {
  theme: 'dark' as const,
  themePreset: 'lamprey-default' as const,
  themeMode: 'dark' as 'light' | 'dark',
  fontSize: 14,
  defaultModel: 'deepseek-v4-pro',
  sidebarCollapsed: false,
  artifactPanelWidth: 420,
  minimizeToTray: false,
  autoCheckUpdates: true,
  aiGeneratedTitles: false,
  modelConfig: {} as Record<string, unknown>,
  customModels: [] as unknown[],
  agentRoster: {
    planner: 'deepseek-v4-pro',
    coder: 'deepseek-v4-flash',
    reviewer: 'deepseek-v4-pro',
    coworker: 'qwen3-coder-plus'
  } as Record<string, string>,
  agentMode: 'single' as 'single' | 'multi'
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

function isProvider(id: unknown): id is ProviderId {
  return typeof id === 'string' && id in PROVIDERS
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

  // Multi-provider key API. Keys are keyed by provider id (deepseek/google/dashscope).
  ipcMain.handle('settings:saveProviderKey', async (_event, provider, key) => {
    try {
      if (!isProvider(provider)) return { success: false, error: `Unknown provider: ${provider}` }
      keychain.setKey(provider, String(key))
      resetProviderClient(provider)
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('settings:hasProviderKey', async (_event, provider) => {
    try {
      if (!isProvider(provider)) return { success: false, error: `Unknown provider: ${provider}` }
      return { success: true, data: keychain.hasKey(provider) }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('settings:testProviderKey', async (_event, provider) => {
    try {
      if (!isProvider(provider)) return { success: false, error: `Unknown provider: ${provider}` }
      const valid = await validateProviderKey(provider)
      return { success: true, data: valid }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('settings:deleteProviderKey', async (_event, provider) => {
    try {
      if (!isProvider(provider)) return { success: false, error: `Unknown provider: ${provider}` }
      keychain.deleteKey(provider)
      resetProviderClient(provider)
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('settings:listProviderKeys', async () => {
    try {
      const data = Object.values(PROVIDERS).map((p) => ({
        id: p.id,
        label: p.label,
        docsUrl: p.docsUrl,
        hasKey: keychain.hasKey(p.id)
      }))
      return { success: true, data }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Legacy single-key handlers, retained so existing UI surfaces keep working.
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

  ipcMain.handle('settings:deleteApiKey', async () => {
    try {
      keychain.deleteKey('deepseek')
      deepseekClient.resetClient()
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('settings:isEncryptionAvailable', async () => {
    try {
      return { success: true, data: keychain.isEncryptionAvailable() }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
