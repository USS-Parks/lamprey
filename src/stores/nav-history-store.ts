import { create } from 'zustand'

const MAX_HISTORY = 50

interface NavHistoryState {
  stack: string[]
  index: number
  // Set to true while replaying back/forward, so selectConversation should
  // NOT push a new entry. Cleared once the next selection completes.
  replaying: boolean
  push: (conversationId: string) => void
  canGoBack: () => boolean
  canGoForward: () => boolean
  goBack: () => string | null
  goForward: () => string | null
  startReplay: () => void
  endReplay: () => void
  clear: () => void
}

export const useNavHistoryStore = create<NavHistoryState>((set, get) => ({
  stack: [],
  index: -1,
  replaying: false,

  push: (conversationId: string) => {
    if (get().replaying) return
    const { stack, index } = get()
    // Collapse no-op pushes.
    if (stack[index] === conversationId) return
    // Truncate any forward entries when pushing after a back.
    const truncated = stack.slice(0, index + 1)
    truncated.push(conversationId)
    const trimmed = truncated.length > MAX_HISTORY ? truncated.slice(-MAX_HISTORY) : truncated
    set({ stack: trimmed, index: trimmed.length - 1 })
  },

  canGoBack: () => get().index > 0,
  canGoForward: () => get().index >= 0 && get().index < get().stack.length - 1,

  goBack: () => {
    const { stack, index } = get()
    if (index <= 0) return null
    const nextIndex = index - 1
    set({ index: nextIndex })
    return stack[nextIndex]
  },

  goForward: () => {
    const { stack, index } = get()
    if (index < 0 || index >= stack.length - 1) return null
    const nextIndex = index + 1
    set({ index: nextIndex })
    return stack[nextIndex]
  },

  startReplay: () => set({ replaying: true }),
  endReplay: () => set({ replaying: false }),
  clear: () => set({ stack: [], index: -1, replaying: false })
}))
