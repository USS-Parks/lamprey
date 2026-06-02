import { create } from 'zustand'
import type { LampreyToolCall, LampreyToolDescriptor } from '@/lib/types'

// Renderer-side tools store. Exposes the descriptor list and the recent-calls
// buffer so any component can subscribe without each one rolling its own fetch.

interface ToolsState {
  descriptors: LampreyToolDescriptor[]
  recentCalls: LampreyToolCall[]
  conversationCalls: LampreyToolCall[]
  loaded: boolean
  loadDescriptors: () => Promise<void>
  loadRecentCalls: (limit?: number) => Promise<void>
  loadCallsForConversation: (conversationId: string, limit?: number) => Promise<void>
}

export const useToolsStore = create<ToolsState>((set) => ({
  descriptors: [],
  recentCalls: [],
  conversationCalls: [],
  loaded: false,

  loadDescriptors: async () => {
    if (!window.api) return
    const result = await window.api.tools.list()
    if (result.success) {
      set({ descriptors: result.data, loaded: true })
    }
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
