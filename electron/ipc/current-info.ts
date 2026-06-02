import { ipcMain } from 'electron'
import {
  readCurrentInfoSettings,
  writeCurrentInfoSettings,
  currentInfoProviderStatus,
  testCurrentInfoProvider,
  type CurrentInfoKind,
  type FinanceProvider,
  type WeatherProvider
} from '../services/current-info-tools'
import { setKey, deleteKey } from '../services/keychain'

const VALID_KINDS = new Set<CurrentInfoKind>(['finance', 'weather', 'sports'])
const VALID_FINANCE = new Set<FinanceProvider>(['finnhub', 'alphavantage'])
const VALID_WEATHER = new Set<WeatherProvider>(['open-meteo', 'openweather'])

const FINANCE_KEY: Record<FinanceProvider, string> = {
  finnhub: 'finance:finnhub',
  alphavantage: 'finance:alphavantage'
}
const WEATHER_KEY: Record<WeatherProvider, string | null> = {
  'open-meteo': null,
  openweather: 'weather:openweather'
}

interface SetProviderOpts {
  apiKey?: string | null
}

export function registerCurrentInfoHandlers(): void {
  ipcMain.handle(
    'currentInfo:setProvider',
    async (_event, kind: CurrentInfoKind, provider: string, opts?: SetProviderOpts) => {
      try {
        if (!VALID_KINDS.has(kind)) {
          return { success: false, error: `Invalid kind: ${kind}` }
        }
        if (kind === 'sports') {
          // TheSportsDB only; no settings to change. Still allow no-op.
          return {
            success: true,
            data: { settings: readCurrentInfoSettings(), status: currentInfoProviderStatus() }
          }
        }
        if (kind === 'finance') {
          if (!VALID_FINANCE.has(provider as FinanceProvider)) {
            return { success: false, error: `Invalid finance provider: ${provider}` }
          }
          const p = provider as FinanceProvider
          writeCurrentInfoSettings({ financeProvider: p })
          if (opts && typeof opts.apiKey === 'string') {
            const trimmed = opts.apiKey.trim()
            if (trimmed) setKey(FINANCE_KEY[p], trimmed)
          } else if (opts && opts.apiKey === null) {
            deleteKey(FINANCE_KEY[p])
          }
        } else {
          // weather
          if (!VALID_WEATHER.has(provider as WeatherProvider)) {
            return { success: false, error: `Invalid weather provider: ${provider}` }
          }
          const p = provider as WeatherProvider
          writeCurrentInfoSettings({ weatherProvider: p })
          const keyId = WEATHER_KEY[p]
          if (keyId && opts && typeof opts.apiKey === 'string') {
            const trimmed = opts.apiKey.trim()
            if (trimmed) setKey(keyId, trimmed)
          } else if (keyId && opts && opts.apiKey === null) {
            deleteKey(keyId)
          }
        }
        return {
          success: true,
          data: { settings: readCurrentInfoSettings(), status: currentInfoProviderStatus() }
        }
      } catch (err: any) {
        return {
          success: false,
          error: err?.message ?? 'currentInfo:setProvider failed'
        }
      }
    }
  )

  ipcMain.handle('currentInfo:getProvider', async (_event, kind?: CurrentInfoKind) => {
    try {
      const settings = readCurrentInfoSettings()
      const status = currentInfoProviderStatus()
      if (kind && !VALID_KINDS.has(kind)) {
        return { success: false, error: `Invalid kind: ${kind}` }
      }
      if (kind) {
        return { success: true, data: { kind, settings, status: status[kind] } }
      }
      return { success: true, data: { settings, status } }
    } catch (err: any) {
      return {
        success: false,
        error: err?.message ?? 'currentInfo:getProvider failed'
      }
    }
  })

  ipcMain.handle('currentInfo:test', async (_event, kind: CurrentInfoKind) => {
    try {
      if (!VALID_KINDS.has(kind)) {
        return { success: false, error: `Invalid kind: ${kind}` }
      }
      const result = await testCurrentInfoProvider(kind)
      return { success: true, data: result }
    } catch (err: any) {
      return {
        success: false,
        error: err?.message ?? 'currentInfo:test failed'
      }
    }
  })
}
