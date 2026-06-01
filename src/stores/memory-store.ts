import { create } from 'zustand'
import type { MemoryEntry } from '@/lib/types'

interface MemoryState {
  memories: MemoryEntry[]
  // Per-conversation pinned memory IDs. Drives the Sources section in the
  // Environment card. Not persisted across app restarts in v1 — that would
  // need a schema migration.
  pinnedByConversation: Record<string, number[]>
  loadMemories: () => Promise<void>
  receiveMemory: (entry: MemoryEntry) => void
  addMemory: (content: string) => Promise<MemoryEntry | null>
  updateMemory: (id: number, content: string) => Promise<void>
  deleteMemory: (id: number) => Promise<MemoryEntry | null>
  restoreMemory: (entry: MemoryEntry) => Promise<void>
  clearAll: () => Promise<void>
  exportMemories: () => Promise<string | null>
  importMemories: (json: string) => Promise<void>
  toggleMemoryPin: (conversationId: string, memoryId: number) => void
  isPinned: (conversationId: string, memoryId: number) => boolean
  pinnedForConversation: (conversationId: string) => MemoryEntry[]
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  memories: [],
  pinnedByConversation: {},

  loadMemories: async () => {
    if (!window.api) return
    const result = await window.api.memory.list()
    if (result.success) {
      set({ memories: (result.data as MemoryEntry[]) ?? [] })
    }
  },

  receiveMemory: (entry: MemoryEntry) => {
    set((state) => {
      if (state.memories.some((m) => m.id === entry.id)) return state
      return { memories: [...state.memories, entry] }
    })
  },

  addMemory: async (content: string) => {
    if (!window.api) return null
    const trimmed = content.trim()
    if (!trimmed) return null
    const result = await window.api.memory.add(trimmed)
    if (!result.success) return null
    const entry = result.data as MemoryEntry
    set((state) =>
      state.memories.some((m) => m.id === entry.id)
        ? state
        : { memories: [...state.memories, entry] }
    )
    return entry
  },

  updateMemory: async (id: number, content: string) => {
    if (!window.api) return
    const trimmed = content.trim()
    if (!trimmed) return
    const result = await window.api.memory.update(id, trimmed)
    if (!result.success) return
    const entry = result.data as MemoryEntry
    set((state) => ({
      memories: state.memories.map((m) => (m.id === id ? entry : m))
    }))
  },

  deleteMemory: async (id: number) => {
    if (!window.api) return null
    const removed = get().memories.find((m) => m.id === id) ?? null
    set((state) => ({ memories: state.memories.filter((m) => m.id !== id) }))
    const result = await window.api.memory.delete(id)
    if (!result.success) {
      await get().loadMemories()
      return null
    }
    return removed
  },

  restoreMemory: async (entry: MemoryEntry) => {
    if (!window.api) return
    const result = await window.api.memory.add(entry.content)
    if (!result.success) return
    await get().loadMemories()
  },

  clearAll: async () => {
    if (!window.api) return
    set({ memories: [] })
    await window.api.memory.clear()
  },

  exportMemories: async () => {
    if (!window.api) return null
    const result = await window.api.memory.export()
    return result.success ? (result.data as string) : null
  },

  importMemories: async (json: string) => {
    if (!window.api) return
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) throw new Error('Import JSON must be an array')
    await window.api.memory.import(parsed)
    await get().loadMemories()
  },

  toggleMemoryPin: (conversationId: string, memoryId: number) => {
    set((state) => {
      const current = state.pinnedByConversation[conversationId] ?? []
      const next = current.includes(memoryId)
        ? current.filter((id) => id !== memoryId)
        : [...current, memoryId]
      return {
        pinnedByConversation: { ...state.pinnedByConversation, [conversationId]: next }
      }
    })
  },

  isPinned: (conversationId: string, memoryId: number) => {
    return (get().pinnedByConversation[conversationId] ?? []).includes(memoryId)
  },

  pinnedForConversation: (conversationId: string) => {
    const ids = get().pinnedByConversation[conversationId] ?? []
    if (ids.length === 0) return []
    const memMap = new Map(get().memories.map((m) => [m.id, m]))
    return ids.map((id) => memMap.get(id)).filter((m): m is MemoryEntry => Boolean(m))
  }
}))
