import { create } from 'zustand'
import type {
  LampreyToolCall,
  LampreyToolDescriptor,
  LampreyToolStub
} from '@/lib/types'

// Renderer-side tools store. Exposes the descriptor list and the recent-calls
// buffer so any component can subscribe without each one rolling its own fetch.
//
// Track 2 / C1: `stubs` replaces the eager full-descriptor cache. The
// renderer pulls the lightweight list on mount; UI surfaces that need the
// full schema (settings inspector, tool detail dialog) call `resolveTools`
// or `searchTools` and the store caches the resulting descriptors in
// `resolved` keyed by tool name.

interface ToolsState {
  stubs: LampreyToolStub[]
  resolved: Record<string, LampreyToolDescriptor>
  recentCalls: LampreyToolCall[]
  conversationCalls: LampreyToolCall[]
  loaded: boolean
  loadStubs: () => Promise<void>
  resolveTools: (names: string[]) => Promise<LampreyToolDescriptor[]>
  searchTools: (
    query: string,
    maxResults?: number
  ) => Promise<LampreyToolDescriptor[]>
  loadRecentCalls: (limit?: number) => Promise<void>
  loadCallsForConversation: (conversationId: string, limit?: number) => Promise<void>
}

export const useToolsStore = create<ToolsState>((set, get) => ({
  stubs: [],
  resolved: {},
  recentCalls: [],
  conversationCalls: [],
  loaded: false,

  loadStubs: async () => {
    if (!window.api) return
    const result = await window.api.tools.list()
    if (result.success) {
      set({ stubs: result.data as LampreyToolStub[], loaded: true })
    }
  },

  resolveTools: async (names: string[]) => {
    if (!window.api || names.length === 0) return []
    const result = await window.api.tools.resolve(names)
    if (!result.success) return []
    const list = result.data as LampreyToolDescriptor[]
    // Merge into the resolved cache so repeat lookups can skip the IPC.
    const merged = { ...get().resolved }
    for (const d of list) merged[d.name] = d
    set({ resolved: merged })
    return list
  },

  searchTools: async (query: string, maxResults?: number) => {
    if (!window.api) return []
    const result = await window.api.tools.search({ query, maxResults })
    if (!result.success) return []
    const list = result.data as LampreyToolDescriptor[]
    const merged = { ...get().resolved }
    for (const d of list) merged[d.name] = d
    set({ resolved: merged })
    return list
  },

  loadRecentCalls: async (limit?: number) => {
    if (!window.api) return
    const result = await window.api.tools.getRecentCalls(limit)
    if (result.success) {
      set({ recentCalls: result.data })
    }
  },

  loadCallsForConversation: async (conversationId: string, limit?: number) => {
    if (!window.api) return
    const result = await window.api.tools.getCallsForConversation(conversationId, limit)
    if (result.success) {
      set({ conversationCalls: result.data })
    }
  }
}))
