import { create } from 'zustand'
import { toast } from '@/stores/toast-store'
import type { Conversation } from '@/lib/types'

// Renderer-side store for the cross-session Sessions sidebar (E3).
//
// Owns the active tab (recent/pinned/archived), the search query, the
// paged list, and the archive/pin mutations. Hits the new `sessions.*`
// preload methods. The legacy `conversation.*` store stays untouched
// for the chat surface; this store is a parallel view.

export type SessionsTab = 'recent' | 'pinned' | 'archived'

export interface SessionEntry extends Conversation {
  archived?: boolean
  pinnedAt?: number | null
}

export interface SessionSearchHit {
  conversationId: string
  source: 'conversation' | 'message'
  messageId: string | null
  snippet: string
  rank: number
}

const PAGE_SIZE = 50
const PIN_ORDER_KEY = 'lamprey.sessions.pinOrder'

interface SessionsState {
  tab: SessionsTab
  query: string
  entries: SessionEntry[]
  hits: SessionSearchHit[]
  loading: boolean
  page: number
  hasMore: boolean
  unreadAgentResults: Record<string, number>
  pinOrder: string[]

  setTab: (tab: SessionsTab) => void
  setQuery: (query: string) => void
  loadFirstPage: () => Promise<void>
  loadMore: () => Promise<void>
  archive: (id: string, archived: boolean) => Promise<void>
  setPinned: (id: string, pinned: boolean) => Promise<void>
  duplicate: (id: string) => Promise<string | null>
  deleteSession: (id: string) => Promise<void>
  markUnreadAgentResult: (conversationId: string) => void
  clearUnread: (conversationId: string) => void
  reorderPinned: (orderedIds: string[]) => void
}

function getApi():
  | {
      sessions?: {
        list: (opts: {
          tab: SessionsTab
          query?: string
          limit?: number
          offset?: number
        }) => Promise<{ success: boolean; data?: SessionEntry[]; error?: string }>
        archive: (id: string, archived: boolean) => Promise<{ success: boolean; error?: string }>
        setPinned: (id: string, pinned: boolean) => Promise<{ success: boolean; error?: string }>
        search: (
          query: string,
          limit?: number
        ) => Promise<{ success: boolean; data?: SessionSearchHit[]; error?: string }>
      }
      conversation?: {
        fork: (id: string) => Promise<{ success: boolean; data?: SessionEntry; error?: string }>
        delete: (id: string) => Promise<{ success: boolean; error?: string }>
      }
    }
  | null {
  return (window as any).api ?? null
}

function readPinOrder(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage?.getItem(PIN_ORDER_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writePinOrder(order: string[]): void {
  try {
    window.localStorage?.setItem(PIN_ORDER_KEY, JSON.stringify(order))
  } catch {
    // ignore unavailable storage
  }
}

function applyPinnedOrder(entries: SessionEntry[], order: string[]): SessionEntry[] {
  if (order.length === 0) return entries
  const rank = new Map(order.map((id, index) => [id, index]))
  return [...entries].sort((a, b) => {
    const ar = rank.get(a.id)
    const br = rank.get(b.id)
    if (ar === undefined && br === undefined) return 0
    if (ar === undefined) return 1
    if (br === undefined) return -1
    return ar - br
  })
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  tab: 'recent',
  query: '',
  entries: [],
  hits: [],
  loading: false,
  page: 0,
  hasMore: true,
  unreadAgentResults: {},
  pinOrder: readPinOrder(),

  setTab: (tab) => {
    if (get().tab === tab) return
    set({ tab, page: 0, hasMore: true })
    void get().loadFirstPage()
  },

  setQuery: (query) => {
    set({ query, page: 0, hasMore: true })
    void get().loadFirstPage()
  },

  loadFirstPage: async () => {
    const api = getApi()?.sessions
    if (!api) return
    set({ loading: true, page: 0 })
    const { tab, query } = get()
    const res = await api.list({ tab, query: query || undefined, limit: PAGE_SIZE, offset: 0 })
    if (!res.success) {
      toast.error(`Failed to load sessions: ${res.error}`)
      set({ loading: false, entries: [], hasMore: false })
      return
    }
    const rawEntries = (res.data as SessionEntry[]) ?? []
    const entries = tab === 'pinned' ? applyPinnedOrder(rawEntries, get().pinOrder) : rawEntries
    set({
      loading: false,
      entries,
      page: 1,
      hasMore: rawEntries.length === PAGE_SIZE
    })

    // Run an FTS pass in parallel so the hit-snippet UI (renderer-side
    // typed-ahead surface) can show body matches alongside the bucket
    // list. Skipped when the query is empty so we don't run a no-op
    // search on every tab switch.
    if (query.trim()) {
      const hitsRes = await api.search(query.trim(), PAGE_SIZE)
      if (hitsRes.success) set({ hits: (hitsRes.data as SessionSearchHit[]) ?? [] })
    } else {
      set({ hits: [] })
    }
  },

  loadMore: async () => {
    const api = getApi()?.sessions
    if (!api) return
    const { tab, query, page, loading, hasMore } = get()
    if (loading || !hasMore) return
    set({ loading: true })
    const res = await api.list({
      tab,
      query: query || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE
    })
    if (!res.success) {
      toast.error(`Failed to load sessions: ${res.error}`)
      set({ loading: false })
      return
    }
    const rawNext = (res.data as SessionEntry[]) ?? []
    const next = tab === 'pinned' ? applyPinnedOrder(rawNext, get().pinOrder) : rawNext
    set((state) => ({
      loading: false,
      entries: [...state.entries, ...next],
      page: state.page + 1,
      hasMore: rawNext.length === PAGE_SIZE
    }))
  },

  archive: async (id, archived) => {
    const api = getApi()?.sessions
    if (!api) return
    const res = await api.archive(id, archived)
    if (!res.success) {
      toast.error(`Failed to archive: ${res.error}`)
      return
    }
    await get().loadFirstPage()
  },

  setPinned: async (id, pinned) => {
    const api = getApi()?.sessions
    if (!api) return
    const res = await api.setPinned(id, pinned)
    if (!res.success) {
      toast.error(`Failed to pin: ${res.error}`)
      return
    }
    await get().loadFirstPage()
  },

  duplicate: async (id) => {
    const api = getApi()?.conversation
    if (!api) return null
    const res = await api.fork(id)
    if (!res.success || !res.data) {
      toast.error(`Failed to duplicate: ${res.error}`)
      return null
    }
    await get().loadFirstPage()
    return res.data.id
  },

  deleteSession: async (id) => {
    const api = getApi()?.conversation
    if (!api) return
    const res = await api.delete(id)
    if (!res.success) {
      toast.error(`Failed to delete: ${res.error}`)
      return
    }
    await get().loadFirstPage()
  },

  markUnreadAgentResult: (conversationId) => {
    set((state) => ({
      unreadAgentResults: {
        ...state.unreadAgentResults,
        [conversationId]: (state.unreadAgentResults[conversationId] ?? 0) + 1
      }
    }))
  },

  clearUnread: (conversationId) => {
    set((state) => {
      if (!state.unreadAgentResults[conversationId]) return state
      const next = { ...state.unreadAgentResults }
      delete next[conversationId]
      return { unreadAgentResults: next }
    })
  },

  reorderPinned: (orderedIds) => {
    writePinOrder(orderedIds)
    set((state) => ({
      pinOrder: orderedIds,
      entries: state.tab === 'pinned' ? applyPinnedOrder(state.entries, orderedIds) : state.entries
    }))
  }
}))
