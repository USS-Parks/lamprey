import { ipcMain } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import * as keychain from '../services/keychain'
import { deepseekClient } from '../services/deepseek'
import {
  PROVIDERS,
  resetProviderClient,
  validateProviderKeyDetailed,
  type ProviderId
} from '../services/providers/registry'
import { recordEvent } from '../services/event-log'

const getSettingsPath = () => join(app.getPath('userData'), 'settings.json')

const defaultSettings = {
  theme: 'dark' as const,
  themePreset: 'arcgis-blue' as const,
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
  agentMode: 'single' as 'single' | 'multi',
  // Prompt 14: agentic coding mode. Off by default; existing settings.json
  // files migrate cleanly via the readSettings shallow-merge below.
  agenticCodingMode: false,
  agenticCodingSkills: ['codex-plan', 'codex-context', 'codex-verify'] as string[],
  agenticCodingComposer: 'auto' as 'auto' | 'always' | 'never'
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
      emitSettingsUpdated(current, updated, partial)
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
      const result = await validateProviderKeyDetailed(provider)
      return { success: true, data: result }
    } catch (err: any) {
      // validateProviderKeyDetailed already swallows provider errors into
      // { ok: false, reason }, so reaching here is genuinely unexpected.
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

  // SEC-10: record explicit user consent to plaintext storage for this
  // session. The renderer calls this after surfacing a `window.confirm`
  // dialog the user accepted; subsequent setKey calls (across every IPC
  // handler that persists a credential) succeed without re-prompting.
  ipcMain.handle('settings:grantPlaintextConsent', async () => {
    try {
      keychain.grantPlaintextConsent()
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('settings:hasPlaintextConsent', async () => {
    try {
      return { success: true, data: keychain.hasPlaintextConsent() }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}

// Settings keys that can carry credentials. Even though `settings:set` is
// keys-only on the event row, names like `apiKey` are still suggestive — flag
// them explicitly so a future log reader knows the change is sensitive
// without having to read the value (we never log the value either way).
const SENSITIVE_SETTING_KEYS = new Set(['apiKey'])

/**
 * Emit a `settings.updated` event recording ONLY the names of the keys that
 * changed. Values never leave this function — even non-sensitive keys are
 * stripped because settings.json can grow new credential-shaped fields that
 * the spine writer is unaware of.
 *
 * Comparison is shallow (top-level keys) because that's the granularity
 * `settings:set` operates at. A change inside `modelConfig['x'].temperature`
 * still produces one `modelConfig` entry — good enough for an audit trail of
 * "this is the moment something model-config-shaped moved" without
 * micro-diffing the JSON.
 */
function emitSettingsUpdated(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  partial: unknown
): void {
  try {
    const changedKeys: string[] = []
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)])
    for (const k of allKeys) {
      const a = (before as Record<string, unknown>)[k]
      const b = (after as Record<string, unknown>)[k]
      if (!shallowEqual(a, b)) changedKeys.push(k)
    }
    if (changedKeys.length === 0) return
    const sensitiveChanged = changedKeys.filter((k) => SENSITIVE_SETTING_KEYS.has(k))
    recordEvent({
      type: 'settings.updated',
      actorKind: 'user',
      payload: {
        changedKeys,
        sensitiveChanged,
        partialKeys:
          partial && typeof partial === 'object'
            ? Object.keys(partial as Record<string, unknown>)
            : undefined
      }
    })
  } catch (err) {
    console.error('[settings] settings.updated event failed:', err)
  }
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}
