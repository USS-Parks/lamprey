import { create } from 'zustand'

// Track 2 / E2 — renderer chapters store. One snapshot per active
// conversation; ChatView's mount triggers `loadForConversation`, and the
// store subscribes to `chat:chapter-marked` so live mark_chapter calls
// reach the sidebar without polling. The IPC payload is mirrored 1:1 —
// keep the shape in lockstep with `electron/services/chapters-store.ts`.

export interface Chapter {
  id: string
  conversationId: string
  title: string
  summary: string | null
  anchorMessageId: string
  createdAt: number
}

interface ChaptersState {
  chapters: Chapter[]
  conversationId: string | null

  loadForConversation: (conversationId: string) => Promise<void>
  applyMarked: (event: { conversationId: string; chapter: Chapter }) => void
  clear: () => void
}

export const useChaptersStore = create<ChaptersState>((set, get) => ({
  chapters: [],
  conversationId: null,

  loadForConversation: async (conversationId: string) => {
    if (!window.api?.session?.listChapters) {
      set({ conversationId, chapters: [] })
      return
    }
    set({ conversationId, chapters: [] })
    const r = await window.api.session.listChapters(conversationId)
    // Drop the result silently if the active conversation has changed in
    // the meantime.
    if (get().conversationId !== conversationId) return
    if (r.success) set({ chapters: r.data as Chapter[] })
  },

  applyMarked: ({ conversationId, chapter }) => {
    const active = get().conversationId
    if (active && active !== conversationId) return
    set((s) => ({
      chapters: [...s.chapters, chapter].sort(
        (a, b) => a.createdAt - b.createdAt
      )
    }))
  },

  clear: () => set({ chapters: [], conversationId: null })
}))
