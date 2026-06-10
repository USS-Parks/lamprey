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
import {
  ALL_WEB_SEARCH_PROVIDERS,
  keychainProviderFor as searchKeychainKey,
  type WebSearchProviderId
} from '../services/web-search-adapters'
import { recordEvent } from '../services/event-log'
// SP-1 — single source of truth for defaults. The hand-maintained literal that
// used to live here drifted from the renderer copy (D1, SP_BASELINE.md §1);
// `default-app-settings.test.ts` now locks the renderer literal against this.
import { DEFAULT_APP_SETTINGS } from '../services/default-app-settings'

const getSettingsPath = () => join(app.getPath('userData'), 'settings.json')

const defaultSettings = DEFAULT_APP_SETTINGS

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
      const safePartial = sanitizeSettingsPartial(partial)
      const current = readSettings()
      const updated = { ...current, ...safePartial }
      writeSettings(updated)
      emitSettingsUpdated(current, updated, safePartial)
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

  // R4 — Search-provider key handlers. Distinct from AI-provider handlers
  // because they target the `web_search:<id>` keychain namespace and use a
  // different allowlist (Brave, Tavily, SerpAPI — anything in
  // ALL_WEB_SEARCH_PROVIDERS that requires a key). No validation endpoint:
  // search APIs charge per request, so we let the next research turn act as
  // the real test rather than burning a paid call on settings entry.
  const SEARCH_PROVIDER_DOCS_URLS: Partial<Record<WebSearchProviderId, string>> = {
    brave: 'https://api.search.brave.com/app/keys',
    tavily: 'https://app.tavily.com/home',
    serpapi: 'https://serpapi.com/manage-api-key'
  }
  function isSearchProviderWithKey(id: unknown): id is WebSearchProviderId {
    return (
      typeof id === 'string' &&
      ALL_WEB_SEARCH_PROVIDERS.some((p) => p.id === id && p.requiresKey)
    )
  }

  ipcMain.handle('settings:listSearchProviderKeys', async () => {
    try {
      const data = ALL_WEB_SEARCH_PROVIDERS.filter((p) => p.requiresKey).map((p) => ({
        id: p.id,
        label: p.label,
        docsUrl: SEARCH_PROVIDER_DOCS_URLS[p.id] ?? '',
        hasKey: keychain.hasKey(searchKeychainKey(p.id))
      }))
      return { success: true, data }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('settings:saveSearchProviderKey', async (_event, provider, key) => {
    try {
      if (!isSearchProviderWithKey(provider)) {
        return { success: false, error: `Unknown search provider: ${provider}` }
      }
      keychain.setKey(searchKeychainKey(provider), String(key))
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('settings:deleteSearchProviderKey', async (_event, provider) => {
    try {
      if (!isSearchProviderWithKey(provider)) {
        return { success: false, error: `Unknown search provider: ${provider}` }
      }
      keychain.deleteKey(searchKeychainKey(provider))
      return { success: true, data: null }
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

// Keys that `__proto__`-style prototype-pollution attacks would target. We
// reject these unconditionally so a malicious or buggy renderer can't
// inject inherited properties into the settings object.
const POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Sanitize a renderer-supplied settings partial. Drops non-object inputs,
 * dangerous keys (prototype pollution), and own-property `Object.prototype`
 * leak vectors. Returns an empty object for non-object input so the merge
 * is a no-op rather than a crash.
 *
 * **Recursive**: a nested object like `{modelConfig: {__proto__: {...}}}` is
 * also flattened — JSON.parse creates `__proto__` as an own property
 * (which is harmless on its own), but any downstream code that later does
 * `for (const k in obj) target[k] = obj[k]` would honor the special
 * `__proto__` semantics and pollute the prototype chain. Recursive
 * stripping closes that gap defensively, regardless of who reads the
 * value later.
 *
 * The settings shape is open by design (modelConfig can hold per-model
 * blocks the harness doesn't know about ahead of time), so we don't gate
 * unknown keys here — that's the responsibility of the schema layer in
 * `defaultSettings`. We only block dangerous keys.
 */
function sanitizeSettingsPartial(raw: unknown): Record<string, unknown> {
  const cleaned = stripPollutionKeys(raw)
  if (
    !cleaned ||
    typeof cleaned !== 'object' ||
    Array.isArray(cleaned)
  ) {
    return {}
  }
  return cleaned as Record<string, unknown>
}

function stripPollutionKeys(value: unknown, depth = 0): unknown {
  // Defensive recursion cap so a hostile renderer can't ship a 10⁴-deep
  // object and OOM the sanitizer. Settings is shallow by design; 16 is
  // more than enough headroom for modelConfig + nested theme objects.
  if (depth > 16) return undefined
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map((item) => stripPollutionKeys(item, depth + 1))
  }
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(value as Record<string, unknown>)) {
    if (POLLUTION_KEYS.has(k)) continue
    out[k] = stripPollutionKeys((value as Record<string, unknown>)[k], depth + 1)
  }
  return out
}

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
