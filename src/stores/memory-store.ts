import { create } from 'zustand'
import { toast } from '@/stores/toast-store'
import type { BrokenMemoryLink, MemoryEntry, MemoryFile, MemoryType } from '@/lib/types'

interface WriteInput {
  name: string
  type: MemoryType
  description?: string
  body: string
  projectSlug?: string
}

interface MemoryState {
  // Legacy view — numeric ids, content-only. Drives the Sources/RAG
  // sidebars and pre-D3 panels that haven't been rebuilt yet.
  memories: MemoryEntry[]
  // D3 typed view — one entry per file with frontmatter shape.
  entries: MemoryFile[]
  brokenLinks: BrokenMemoryLink[]
  loading: boolean

  // Per-conversation pinned memory IDs. Drives the Sources section in the
  // Environment card. Not persisted across app restarts in v1 — that would
  // need a schema migration.
  pinnedByConversation: Record<string, number[]>

  loadMemories: () => Promise<void>
  loadBrokenLinks: () => Promise<void>
  receiveMemory: (entry: MemoryEntry) => void
  receiveChanged: (typed: MemoryFile[]) => void

  // Legacy add/update/delete — kept for pre-D3 callers.
  addMemory: (content: string) => Promise<MemoryEntry | null>
  updateMemory: (id: number, content: string) => Promise<void>
  deleteMemory: (id: number) => Promise<MemoryEntry | null>
  restoreMemory: (entry: MemoryEntry) => Promise<void>
  clearAll: () => Promise<void>
  exportMemories: () => Promise<string | null>
  importMemories: (json: string) => Promise<void>

  // D3 typed CRUD — the MemoryEditor calls these.
  writeMemory: (input: WriteInput) => Promise<MemoryFile | null>
  deleteEntry: (name: string) => Promise<boolean>
  duplicateEntry: (name: string) => Promise<MemoryFile | null>

  // Per-type/total counts surfaced on tabs + badges.
  countsByType: () => Record<MemoryType | 'all', number>

  toggleMemoryPin: (conversationId: string, memoryId: number) => void
  isPinned: (conversationId: string, memoryId: number) => boolean
  pinnedForConversation: (conversationId: string) => MemoryEntry[]
}

const EMPTY_COUNTS: Record<MemoryType | 'all', number> = {
  all: 0,
  user: 0,
  feedback: 0,
  project: 0,
  reference: 0
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  memories: [],
  entries: [],
  brokenLinks: [],
  loading: false,
  pinnedByConversation: {},

  loadMemories: async () => {
    if (!window.api) return
    set({ loading: true })
    // Load both shapes in parallel: the legacy list (numeric ids) for
    // pre-D3 panels and the typed file list for the new MemoryPanel.
    const [legacyRes, typedRes] = await Promise.all([
      window.api.memory.list(),
      window.api.memory.list({})
    ])
    if (legacyRes.success) {
      set({ memories: (legacyRes.data as MemoryEntry[]) ?? [] })
    } else {
      toast.error(`Failed to load memory: ${legacyRes.error}`)
    }
    if (typedRes.success) {
      set({ entries: (typedRes.data as MemoryFile[]) ?? [] })
    }
    set({ loading: false })
    await get().loadBrokenLinks()
  },

  loadBrokenLinks: async () => {
    if (!window.api?.memory?.listBrokenLinks) return
    const res = await window.api.memory.listBrokenLinks()
    if (res.success) {
      set({ brokenLinks: (res.data as BrokenMemoryLink[]) ?? [] })
    }
  },

  receiveMemory: (entry: MemoryEntry) => {
    set((state) => {
      if (state.memories.some((m) => m.id === entry.id)) return state
      return { memories: [...state.memories, entry] }
    })
  },

  receiveChanged: (typed: MemoryFile[]) => {
    set({ entries: typed })
    // Trigger a legacy reload too so numeric ids stay coherent with the
    // typed view. The broken-link refresh is debounced under the
    // loadMemories umbrella.
    void get().loadMemories()
  },

  addMemory: async (content: string) => {
    if (!window.api) return null
    const trimmed = content.trim()
    if (!trimmed) return null
    const result = await window.api.memory.add(trimmed)
    if (!result.success) {
      toast.error(`Failed to add memory: ${result.error}`)
      return null
    }
    const entry = result.data as MemoryEntry
    set((state) =>
      state.memories.some((m) => m.id === entry.id)
        ? state
        : { memories: [...state.memories, entry] }
    )
    // Refresh the typed view so the tab counts update immediately.
    void get().loadMemories()
    return entry
  },

  updateMemory: async (id: number, content: string) => {
    if (!window.api) return
    const trimmed = content.trim()
    if (!trimmed) return
    const result = await window.api.memory.update(id, trimmed)
    if (!result.success) {
      toast.error(`Failed to update memory: ${result.error}`)
      return
    }
    const entry = result.data as MemoryEntry
    set((state) => ({
      memories: state.memories.map((m) => (m.id === id ? entry : m))
    }))
    void get().loadMemories()
  },

  deleteMemory: async (id: number) => {
    if (!window.api) return null
    const removed = get().memories.find((m) => m.id === id) ?? null
    set((state) => ({ memories: state.memories.filter((m) => m.id !== id) }))
    const result = await window.api.memory.delete(id)
    if (!result.success) {
      toast.error(`Failed to delete memory: ${result.error}`)
      await get().loadMemories()
      return null
    }
    void get().loadMemories()
    return removed
  },

  restoreMemory: async (entry: MemoryEntry) => {
    if (!window.api) return
    const result = await window.api.memory.add(entry.content)
    if (!result.success) {
      toast.error(`Failed to restore memory: ${result.error}`)
      return
    }
    await get().loadMemories()
  },

  clearAll: async () => {
    if (!window.api) return
    const previous = get().memories
    set({ memories: [], entries: [], brokenLinks: [] })
    const result = await window.api.memory.clear()
    if (!result.success) {
      toast.error(`Failed to clear memory: ${result.error}`)
      set({ memories: previous })
    }
    await get().loadMemories()
  },

  exportMemories: async () => {
    if (!window.api) return null
    const result = await window.api.memory.export()
    if (!result.success) {
      toast.error(`Failed to export memory: ${result.error}`)
      return null
    }
    return result.data as string
  },

  importMemories: async (json: string) => {
    if (!window.api) return
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) throw new Error('Import JSON must be an array')
    const result = await window.api.memory.import(parsed)
    if (!result.success) throw new Error(result.error)
    await get().loadMemories()
  },

  writeMemory: async (input: WriteInput) => {
    if (!window.api?.memory?.write) return null
    const res = await window.api.memory.write(input)
    if (!res.success) {
      toast.error(`Failed to write memory: ${res.error}`)
      return null
    }
    await get().loadMemories()
    return res.data as MemoryFile
  },

  deleteEntry: async (name: string) => {
    if (!window.api) return false
    const res = await window.api.memory.delete(name)
    if (!res.success) {
      toast.error(`Failed to delete memory: ${res.error}`)
      return false
    }
    await get().loadMemories()
    return true
  },

  duplicateEntry: async (name: string) => {
    const source = get().entries.find((e) => e.name === name)
    if (!source) return null
    // Synthesize a unique name suffix so the user doesn't overwrite the
    // original. The backend will further slug-normalize.
    const base = `${source.name}_copy`
    let suffix = 1
    let candidate = base
    while (get().entries.some((e) => e.name === candidate)) {
      suffix += 1
      candidate = `${base}_${suffix}`
    }
    return get().writeMemory({
      name: candidate,
      type: source.type,
      description: source.description,
      body: source.body
    })
  },

  countsByType: () => {
    const counts: Record<MemoryType | 'all', number> = { ...EMPTY_COUNTS }
    for (const entry of get().entries) {
      counts.all += 1
      counts[entry.type] = (counts[entry.type] ?? 0) + 1
    }
    return counts
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
