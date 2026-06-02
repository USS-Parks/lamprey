import { getKey, hasKey } from './keychain'
import { readSettings, patchSettings } from './settings-helper'

// Current-information tools. Three small adapter families:
//   - finance_quote -> Finnhub or Alpha Vantage
//   - weather_lookup -> Open-Meteo (free, no key) or OpenWeatherMap
//   - sports_lookup -> TheSportsDB (free, no key)
//
// Each executor is a pure function (network in, text out). Settings live in
// userData/settings.json under `currentInfo`. API keys live in the keychain
// under `finance:finnhub`, `finance:alphavantage`, `weather:openweather`.
// Keys do NOT cross the IPC boundary - the renderer only sees `hasKey` booleans.

const FETCH_TIMEOUT_MS = 15_000

export type FinanceProvider = 'finnhub' | 'alphavantage'
export type WeatherProvider = 'open-meteo' | 'openweather'
export type CurrentInfoKind = 'finance' | 'weather' | 'sports'

export interface CurrentInfoSettings {
  financeProvider: FinanceProvider
  weatherProvider: WeatherProvider
}

const DEFAULT_SETTINGS: CurrentInfoSettings = {
  financeProvider: 'finnhub',
  weatherProvider: 'open-meteo'
}

const FINANCE_KEY: Record<FinanceProvider, string> = {
  finnhub: 'finance:finnhub',
  alphavantage: 'finance:alphavantage'
}

const WEATHER_KEY: Record<WeatherProvider, string | null> = {
  'open-meteo': null,
  openweather: 'weather:openweather'
}

// ──────────────────────── settings helpers ────────────────────────

export function readCurrentInfoSettings(): CurrentInfoSettings {
  const raw = readSettings()
  const stored = (raw.currentInfo as Partial<CurrentInfoSettings> | undefined) || {}
  return {
    financeProvider:
      stored.financeProvider === 'alphavantage' || stored.financeProvider === 'finnhub'
        ? stored.financeProvider
        : DEFAULT_SETTINGS.financeProvider,
    weatherProvider:
      stored.weatherProvider === 'openweather' || stored.weatherProvider === 'open-meteo'
        ? stored.weatherProvider
        : DEFAULT_SETTINGS.weatherProvider
  }
}

export function writeCurrentInfoSettings(patch: Partial<CurrentInfoSettings>): CurrentInfoSettings {
  const current = readCurrentInfoSettings()
  const next: CurrentInfoSettings = {
    financeProvider: patch.financeProvider ?? current.financeProvider,
    weatherProvider: patch.weatherProvider ?? current.weatherProvider
  }
  patchSettings({ currentInfo: next })
  return next
}

export function currentInfoProviderStatus(): {
  finance: { provider: FinanceProvider; hasKey: boolean }
  weather: { provider: WeatherProvider; hasKey: boolean; keyRequired: boolean }
  sports: { provider: 'thesportsdb'; hasKey: boolean; keyRequired: boolean }
} {
  const settings = readCurrentInfoSettings()
  const weatherKey = WEATHER_KEY[settings.weatherProvider]
  return {
    finance: {
      provider: settings.financeProvider,
      hasKey: hasKey(FINANCE_KEY[settings.financeProvider])
    },
    weather: {
      provider: settings.weatherProvider,
      hasKey: weatherKey ? hasKey(weatherKey) : true,
      keyRequired: weatherKey !== null
    },
    sports: { provider: 'thesportsdb', hasKey: true, keyRequired: false }
  }
}

// ──────────────────────── fetch helper ────────────────────────

async function fetchJsonWithTimeout(
  url: string,
  init?: RequestInit
): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} ${res.statusText}` }
    }
    const data = await res.json()
    return { ok: true, data }
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { ok: false, error: `Request timed out after ${FETCH_TIMEOUT_MS}ms` }
    }
    return { ok: false, error: err?.message ?? 'Network error' }
  } finally {
    clearTimeout(timer)
  }
}

// ──────────────────────── finance_quote ────────────────────────

export interface FinanceQuoteArgs {
  symbol?: string
  provider?: FinanceProvider
}

function fmtNum(n: unknown, digits = 2): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'n/a'
  return n.toFixed(digits)
}

export async function executeFinanceQuote(args: FinanceQuoteArgs): Promise<string> {
  const symbol = typeof args?.symbol === 'string' ? args.symbol.trim() : ''
  if (!symbol) {
    return 'Error: finance_quote requires a non-empty "symbol" argument (e.g. "AAPL").'
  }
  const settings = readCurrentInfoSettings()
  const provider: FinanceProvider =
    args?.provider === 'alphavantage' || args?.provider === 'finnhub'
      ? args.provider
      : settings.financeProvider

  const key = getKey(FINANCE_KEY[provider])
  if (!key) {
    return `Error: finance_quote provider "${provider}" requires an API key. Configure it in Settings → Current Info.`
  }

  if (provider === 'finnhub') {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`
    const res = await fetchJsonWithTimeout(url)
    if (!res.ok) return `Error: finance_quote (finnhub) ${res.error}`
    const q = res.data as { c?: number; h?: number; l?: number; o?: number; pc?: number }
    if (typeof q?.c !== 'number' || q.c === 0) {
      return `Error: finance_quote (finnhub) — no data for symbol "${symbol}". The symbol may be unknown or your key may not cover it.`
    }
    const change = typeof q.pc === 'number' ? q.c - q.pc : NaN
    const changePct =
      typeof q.pc === 'number' && q.pc !== 0 ? ((q.c - q.pc) / q.pc) * 100 : NaN
    return `${symbol.toUpperCase()}: $${fmtNum(q.c)} (Δ ${fmtNum(change)} / ${fmtNum(changePct)}%) [open $${fmtNum(q.o)} high $${fmtNum(q.h)} low $${fmtNum(q.l)} prev $${fmtNum(q.pc)}] — Source: finnhub.io`
  }

  // alphavantage
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`
  const res = await fetchJsonWithTimeout(url)
  if (!res.ok) return `Error: finance_quote (alphavantage) ${res.error}`
  const q = res.data?.['Global Quote'] as Record<string, string> | undefined
  if (!q || Object.keys(q).length === 0 || !q['05. price']) {
    const note = res.data?.['Note'] || res.data?.['Information']
    if (typeof note === 'string') {
      return `Error: finance_quote (alphavantage) — ${note}`
    }
    return `Error: finance_quote (alphavantage) — no data for symbol "${symbol}".`
  }
  const price = Number(q['05. price'])
  const open = Number(q['02. open'])
  const high = Number(q['03. high'])
  const low = Number(q['04. low'])
  const prevClose = Number(q['08. previous close'])
  const change = Number(q['09. change'])
  const changePct = parseFloat(String(q['10. change percent'] || '0').replace('%', ''))
  return `${symbol.toUpperCase()}: $${fmtNum(price)} (Δ ${fmtNum(change)} / ${fmtNum(changePct)}%) [open $${fmtNum(open)} high $${fmtNum(high)} low $${fmtNum(low)} prev $${fmtNum(prevClose)}] — Source: alphavantage.co`
}

// ──────────────────────── weather_lookup ────────────────────────

export interface WeatherLookupArgs {
  location?: string
  units?: 'metric' | 'imperial'
}

// WMO weather code → short label (Open-Meteo).
function wmoCodeLabel(code: number): string {
  if (code === 0) return 'Clear'
  if (code >= 1 && code <= 3) return 'Partly cloudy'
  if (code >= 45 && code <= 48) return 'Fog'
  if (code >= 51 && code <= 67) return 'Rain'
  if (code >= 71 && code <= 77) return 'Snow'
  if (code >= 80 && code <= 82) return 'Showers'
  if (code >= 95 && code <= 99) return 'Thunderstorm'
  return 'Unknown'
}

// Parse "lat,lon" → {lat, lon} if the input is two finite numbers.
function parseLatLon(input: string): { lat: number; lon: number } | null {
  const parts = input.split(',').map((p) => p.trim())
  if (parts.length !== 2) return null
  const lat = Number(parts[0])
  const lon = Number(parts[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
  return { lat, lon }
}

export async function executeWeatherLookup(args: WeatherLookupArgs): Promise<string> {
  const location = typeof args?.location === 'string' ? args.location.trim() : ''
  if (!location) {
    return 'Error: weather_lookup requires a non-empty "location" argument (city, "lat,lon", or place name).'
  }
  const units: 'metric' | 'imperial' = args?.units === 'imperial' ? 'imperial' : 'metric'
  const settings = readCurrentInfoSettings()

  if (settings.weatherProvider === 'open-meteo') {
    // 1. Resolve location → lat/lon. Accept "lat,lon" verbatim.
    let lat: number
    let lon: number
    let resolvedName = location
    const parsed = parseLatLon(location)
    if (parsed) {
      lat = parsed.lat
      lon = parsed.lon
    } else {
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`
      const geoRes = await fetchJsonWithTimeout(geoUrl)
      if (!geoRes.ok) return `Error: weather_lookup (open-meteo geocoding) ${geoRes.error}`
      const hit = geoRes.data?.results?.[0]
      if (!hit || typeof hit.latitude !== 'number' || typeof hit.longitude !== 'number') {
        return `Error: weather_lookup — could not geocode "${location}". Try a more specific name or "lat,lon".`
      }
      lat = hit.latitude
      lon = hit.longitude
      const parts = [hit.name, hit.admin1, hit.country].filter(
        (p: unknown) => typeof p === 'string' && p
      )
      resolvedName = parts.join(', ') || location
    }

    const tempUnit = units === 'imperial' ? 'fahrenheit' : 'celsius'
    const windUnit = units === 'imperial' ? 'mph' : 'kmh'
    const tempLabel = units === 'imperial' ? 'F' : 'C'
    const windLabel = units === 'imperial' ? 'mph' : 'km/h'

    const wUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&temperature_unit=${tempUnit}&wind_speed_unit=${windUnit}`
    const wRes = await fetchJsonWithTimeout(wUrl)
    if (!wRes.ok) return `Error: weather_lookup (open-meteo) ${wRes.error}`
    const cur = wRes.data?.current
    if (!cur || typeof cur.temperature_2m !== 'number') {
      return `Error: weather_lookup (open-meteo) — no current observation for ${resolvedName}.`
    }
    const label = wmoCodeLabel(Number(cur.weather_code))
    return `${resolvedName}: ${fmtNum(cur.temperature_2m, 1)}°${tempLabel}, ${label}, humidity ${fmtNum(cur.relative_humidity_2m, 0)}%, wind ${fmtNum(cur.wind_speed_10m, 1)} ${windLabel}. — Source: open-meteo.com`
  }

  // openweather
  const apiKey = getKey('weather:openweather')
  if (!apiKey) {
    return 'Error: weather_lookup provider "openweather" requires an API key. Configure it in Settings → Current Info.'
  }
  const owUnits = units === 'imperial' ? 'imperial' : 'metric'
  const tempLabel = units === 'imperial' ? 'F' : 'C'
  const windLabel = units === 'imperial' ? 'mph' : 'm/s'
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&units=${owUnits}&appid=${encodeURIComponent(apiKey)}`
  const res = await fetchJsonWithTimeout(url)
  if (!res.ok) return `Error: weather_lookup (openweather) ${res.error}`
  const d = res.data
  if (!d || d.cod && Number(d.cod) !== 200) {
    return `Error: weather_lookup (openweather) — ${d?.message ?? 'unknown error'}.`
  }
  const name = [d.name, d.sys?.country].filter(Boolean).join(', ') || location
  const cond = d.weather?.[0]?.description ?? d.weather?.[0]?.main ?? 'unknown'
  return `${name}: ${fmtNum(d.main?.temp, 1)}°${tempLabel}, ${cond}, humidity ${fmtNum(d.main?.humidity, 0)}%, wind ${fmtNum(d.wind?.speed, 1)} ${windLabel}. — Source: openweathermap.org`
}

// ──────────────────────── sports_lookup ────────────────────────

export interface SportsLookupArgs {
  query?: string
  kind?: 'team' | 'league' | 'next' | 'last'
}

function fmtSportsEvent(ev: Record<string, any>): string {
  const date = ev.dateEvent || ev.dateEventLocal || ''
  const time = ev.strTime || ev.strTimeLocal || ''
  const venue = ev.strVenue ? ` @ ${ev.strVenue}` : ''
  const league = ev.strLeague ? ` [${ev.strLeague}]` : ''
  const name = ev.strEvent || `${ev.strHomeTeam || '?'} vs ${ev.strAwayTeam || '?'}`
  const scoreParts: string[] = []
  if (ev.intHomeScore != null && ev.intHomeScore !== '') scoreParts.push(`${ev.strHomeTeam}: ${ev.intHomeScore}`)
  if (ev.intAwayScore != null && ev.intAwayScore !== '') scoreParts.push(`${ev.strAwayTeam}: ${ev.intAwayScore}`)
  const score = scoreParts.length ? ` — ${scoreParts.join(' · ')}` : ''
  return `${name}${league} on ${date}${time ? ' ' + time : ''}${venue}${score}`.trim()
}

export async function executeSportsLookup(args: SportsLookupArgs): Promise<string> {
  const query = typeof args?.query === 'string' ? args.query.trim() : ''
  if (!query) {
    return 'Error: sports_lookup requires a non-empty "query" argument (team or league name).'
  }
  const kind: NonNullable<SportsLookupArgs['kind']> =
    args?.kind === 'team' || args?.kind === 'league' || args?.kind === 'last' || args?.kind === 'next'
      ? args.kind
      : 'next'

  if (kind === 'league') {
    const url = `https://www.thesportsdb.com/api/v1/json/3/search_all_leagues.php?s=${encodeURIComponent(query)}`
    const res = await fetchJsonWithTimeout(url)
    if (!res.ok) return `Error: sports_lookup (thesportsdb) ${res.error}`
    const leagues = res.data?.countries || res.data?.leagues || []
    if (!Array.isArray(leagues) || leagues.length === 0) {
      return `Error: sports_lookup — no leagues matched "${query}".`
    }
    // Best effort: pick the first match.
    const top = leagues[0]
    const name = top.strLeague || top.strLeagueAlternate || query
    const sport = top.strSport ? ` (${top.strSport})` : ''
    return `League: ${name}${sport}${top.strCountry ? ` — ${top.strCountry}` : ''}. — Source: thesportsdb.com`
  }

  // Search for team first; all of {team, next, last} need a teamId.
  const searchUrl = `https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(query)}`
  const searchRes = await fetchJsonWithTimeout(searchUrl)
  if (!searchRes.ok) return `Error: sports_lookup (thesportsdb) ${searchRes.error}`
  const teams = searchRes.data?.teams
  if (!Array.isArray(teams) || teams.length === 0) {
    return `Error: sports_lookup — no teams matched "${query}".`
  }
  const team = teams[0]
  const teamId = team.idTeam
  const teamName = team.strTeam || query

  if (kind === 'team') {
    const league = team.strLeague ? ` [${team.strLeague}]` : ''
    const sport = team.strSport ? ` (${team.strSport})` : ''
    const formed = team.intFormedYear ? ` · formed ${team.intFormedYear}` : ''
    const stadium = team.strStadium ? ` · stadium: ${team.strStadium}` : ''
    return `${teamName}${league}${sport}${formed}${stadium}. — Source: thesportsdb.com`
  }

  const endpoint = kind === 'last' ? 'eventslast.php' : 'eventsnext.php'
  const evUrl = `https://www.thesportsdb.com/api/v1/json/3/${endpoint}?id=${encodeURIComponent(teamId)}`
  const evRes = await fetchJsonWithTimeout(evUrl)
  if (!evRes.ok) return `Error: sports_lookup (thesportsdb) ${evRes.error}`
  const events = evRes.data?.results || evRes.data?.events
  if (!Array.isArray(events) || events.length === 0) {
    return `Error: sports_lookup — no ${kind === 'last' ? 'recent' : 'upcoming'} events for "${teamName}".`
  }
  const ev = events[0]
  const prefix = kind === 'last' ? 'Last' : 'Next'
  return `${prefix} event for ${teamName}: ${fmtSportsEvent(ev)}. — Source: thesportsdb.com`
}

// ──────────────────────── provider test helper ────────────────────────

/**
 * Lightweight provider check — exposed for the CurrentInfoSettings panel.
 * For finance/weather (when a key is required) we do a tiny live call to
 * confirm the key is accepted. For free providers (open-meteo, thesportsdb)
 * we hit a known-good endpoint.
 */
export async function testCurrentInfoProvider(
  kind: CurrentInfoKind
): Promise<{ ok: boolean; reason?: string }> {
  if (kind === 'finance') {
    const out = await executeFinanceQuote({ symbol: 'AAPL' })
    return out.startsWith('Error:') ? { ok: false, reason: out.slice(7).trim() } : { ok: true }
  }
  if (kind === 'weather') {
    const out = await executeWeatherLookup({ location: 'London' })
    return out.startsWith('Error:') ? { ok: false, reason: out.slice(7).trim() } : { ok: true }
  }
  // sports
  const out = await executeSportsLookup({ query: 'Arsenal', kind: 'team' })
  return out.startsWith('Error:') ? { ok: false, reason: out.slice(7).trim() } : { ok: true }
}
