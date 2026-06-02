import { ipcMain } from 'electron'
import { deleteKey, hasKey, setKey } from '../services/keychain'
import { patchSettings } from '../services/settings-helper'
import {
  ALL_WEB_SEARCH_PROVIDERS,
  keychainProviderFor,
  readWebToolsSettings,
  type WebSearchProviderId
} from '../services/web-search-adapters'
import { probeAdapter } from '../services/web-tools'

// IPC surface for web tools provider configuration.
//
// Three handlers:
//   webTools:setProvider — write the active provider into settings.json
//                          and (for key-based providers) store the API key
//                          in the keychain. For SearXNG, persist the
//                          endpoint URL into settings.json.
//   webTools:getProvider — return the current provider id, whether it has
//                          a configured key/endpoint, and the SearXNG
//                          endpoint string when applicable. Never returns
//                          raw key material.
//   webTools:testAdapter — run a single "hello world" query through the
//                          configured adapter and report ok / error.

function isProviderId(v: unknown): v is WebSearchProviderId {
  return v === 'brave' || v === 'tavily' || v === 'serpapi' || v === 'searxng'
}

export function registerWebToolsHandlers(): void {
  ipcMain.handle(
    'webTools:setProvider',
    async (
      _event,
      provider: unknown,
      opts: unknown
    ) => {
      try {
        if (!isProviderId(provider)) {
          return { success: false, error: `Unknown provider: ${String(provider)}` }
        }
        const o = (opts ?? {}) as { apiKey?: string; endpoint?: string }

        // Persist active provider choice + (optional) SearXNG endpoint.
        const settingsPatch: Record<string, unknown> = {
          webTools: {
            searchProvider: provider,
            searxngEndpoint:
              provider === 'searxng'
                ? (o.endpoint?.trim() || undefined)
                : readWebToolsSettings().searxngEndpoint
          }
        }
        patchSettings(settingsPatch)

        // For key-based providers, optionally write the key to the keychain.
        if (provider !== 'searxng' && typeof o.apiKey === 'string' && o.apiKey.trim()) {
          setKey(keychainProviderFor(provider), o.apiKey.trim())
        }

        return { success: true, data: { provider } }
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message ?? 'webTools:setProvider failed'
        }
      }
    }
  )

  ipcMain.handle('webTools:getProvider', async () => {
    try {
      const settings = readWebToolsSettings()
      const data = ALL_WEB_SEARCH_PROVIDERS.map((p) => ({
        id: p.id,
        label: p.label,
        requiresKey: p.requiresKey,
        requiresEndpoint: p.requiresEndpoint,
        hasKey: p.requiresKey ? hasKey(keychainProviderFor(p.id)) : false,
        active: settings.searchProvider === p.id
      }))
      return {
        success: true,
        data: {
          provider: settings.searchProvider,
          searxngEndpoint: settings.searxngEndpoint ?? null,
          providers: data
        }
      }
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message ?? 'webTools:getProvider failed'
      }
    }
  })

  ipcMain.handle('webTools:testAdapter', async () => {
    try {
      const result = await probeAdapter()
      return { success: true, data: result }
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message ?? 'webTools:testAdapter failed'
      }
    }
  })

  ipcMain.handle('webTools:deleteKey', async (_event, provider: unknown) => {
    try {
      if (!isProviderId(provider) || provider === 'searxng') {
        return {
          success: false,
          error: `webTools:deleteKey only valid for key-based providers (got ${String(provider)})`
        }
      }
      deleteKey(keychainProviderFor(provider))
      return { success: true }
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message ?? 'webTools:deleteKey failed'
      }
    }
  })
}
