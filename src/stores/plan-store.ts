import { create } from 'zustand'
import type { PlanSnapshot } from '@/lib/types'

// Plan checklist store. One snapshot per active conversation; chat-store's
// selectConversation triggers a load, and useChat wires the plan:updated
// stream so live tool calls refresh the UI without polling.

interface PlanState {
  // null = no plan recorded for the active conversation yet.
  snapshot: PlanSnapshot | null
  // The conversation the snapshot belongs to. Used to drop stale events when
  // the user switches conversations mid-stream.
  conversationId: string | null

  loadForConversation: (conversationId: string) => Promise<void>
  applyUpdate: (snapshot: PlanSnapshot) => void
  clear: () => void
}

export const usePlanStore = create<PlanState>((set, get) => ({
  snapshot: null,
  conversationId: null,

  loadForConversation: async (conversationId: string) => {
    if (!window.api) return
    set({ conversationId, snapshot: null })
    const result = await window.api.plan.get(conversationId)
    // The user may have switched conversations again while this fetch was in
    // flight; drop the result silently if so.
    if (get().conversationId !== conversationId) return
    if (result.success) {
      set({ snapshot: result.data as PlanSnapshot })
    }
  },

  applyUpdate: (snapshot: PlanSnapshot) => {
    const active = get().conversationId
    if (active && snapshot.conversationId !== active) return
    set({ snapshot })
  },

  clear: () => {
    set({ snapshot: null, conversationId: null })
  }
}))
