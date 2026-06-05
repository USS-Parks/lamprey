import { create } from 'zustand'

// Renderer-side store for the SnipSettings dashboard (K11) and the
// Discover panel (K12). Pulls from window.api.snip.* via IPC; falls
// back to empty defaults when the API isn't bound (browser dev mode,
// per the project's `window.api guard` convention in CLAUDE.md).

export interface SnipStats {
  enabled: boolean
  totalEvents: number
  totalBytesBefore: number
  totalBytesAfter: number
  totalTokensBefore: number
  totalTokensAfter: number
  avgSavings: number
  topByTokens: Array<{
    filter: string
    runs: number
    tokensSaved: number
    savingsRatio: number
  }>
  sparkline: number[]
}

export interface SnipRecentRow {
  ts: number
  filter: string
  command: string
  tokensBefore: number
  tokensAfter: number
  durationMs: number
}

export interface SnipFilterListEntry {
  name: string
  description: string
  source: 'built-in' | 'user'
  path: string
  overriddenByUser: boolean
}

export interface SnipDiscoverSuggestion {
  commandPattern: string
  runs: number
  estimatedTokens: number
  sampleCommand: string
  suggestedCategory: string
}

export interface SnipDiscoverPayload {
  suggestions: SnipDiscoverSuggestion[]
  sinceMs: number
  scannedCommandHeads: number
}

interface SnipState {
  stats: SnipStats | null
  recent: SnipRecentRow[]
  filters: SnipFilterListEntry[]
  discover: SnipDiscoverPayload | null
  loading: boolean
  error: string | null
  loadAll: () => Promise<void>
  loadDiscover: (sinceDays?: number) => Promise<void>
  setEnabled: (enabled: boolean) => Promise<void>
  setVerbose: (verbose: boolean) => Promise<void>
  reloadFilters: () => Promise<void>
  clearHistory: () => Promise<void>
  openFilterDir: () => Promise<void>
}

const EMPTY_STATS: SnipStats = {
  enabled: true,
  totalEvents: 0,
  totalBytesBefore: 0,
  totalBytesAfter: 0,
  totalTokensBefore: 0,
  totalTokensAfter: 0,
  avgSavings: 0,
  topByTokens: [],
  sparkline: new Array<number>(14).fill(0)
}

export const useSnipStore = create<SnipState>((set, get) => ({
  stats: null,
  recent: [],
  filters: [],
  discover: null,
  loading: false,
  error: null,

  loadAll: async () => {
    set({ loading: true, error: null })
    try {
      if (!window.api?.snip) {
        set({ stats: EMPTY_STATS, recent: [], filters: [], loading: false })
        return
      }
      const [statsRes, recentRes, filtersRes] = await Promise.all([
        window.api.snip.stats(),
        window.api.snip.recent({ limit: 20 }),
        window.api.snip.listFilters()
      ])
      set({
        stats: statsRes?.success ? (statsRes.data as SnipStats) : EMPTY_STATS,
        recent: recentRes?.success ? (recentRes.data as SnipRecentRow[]) : [],
        filters: filtersRes?.success ? (filtersRes.data as SnipFilterListEntry[]) : [],
        loading: false
      })
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
        stats: EMPTY_STATS
      })
    }
  },

  loadDiscover: async (sinceDays = 7) => {
    try {
      if (!window.api?.snip) {
        set({ discover: { suggestions: [], sinceMs: 0, scannedCommandHeads: 0 } })
        return
      }
      const res = await window.api.snip.discover({ sinceDays, limit: 20 })
      if (res?.success) {
        set({ discover: res.data as SnipDiscoverPayload })
      } else {
        set({ discover: { suggestions: [], sinceMs: 0, scannedCommandHeads: 0 } })
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  setEnabled: async (enabled) => {
    if (!window.api?.snip) return
    await window.api.snip.setEnabled({ enabled })
    // Refresh stats so the header card reflects the new state.
    await get().loadAll()
  },

  setVerbose: async (verbose) => {
    if (!window.api?.snip) return
    await window.api.snip.setVerbose({ verbose })
  },

  reloadFilters: async () => {
    if (!window.api?.snip) return
    await window.api.snip.reloadFilters()
    await get().loadAll()
  },

  clearHistory: async () => {
    if (!window.api?.snip) return
    await window.api.snip.clearHistory()
    await get().loadAll()
    await get().loadDiscover()
  },

  openFilterDir: async () => {
    if (!window.api?.snip) return
    await window.api.snip.openFilterDir()
  }
}))

/**
 * Format a count like `1234 → "1.2k"`, `1000000 → "1.0M"`. Used by the
 * dashboard header card AND the K13 status-line slot — exported so K13
 * stays consistent.
 */
export function formatCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}
