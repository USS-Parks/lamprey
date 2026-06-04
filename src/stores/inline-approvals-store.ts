import { create } from 'zustand'
import type { ToolApprovalRequest } from '@/lib/types'

// Fluidity J5: renderer-only queue of in-transcript approval chips. App.tsx
// is the IPC owner — it decides chip vs modal via routeApproval and pushes
// chip-eligible requests here. MessageList reads + renders the queue; the
// chip itself calls `dismiss(callId)` after a respond() to drop the row.
// First-in-queue auto-focuses so the 1/2/3 keystrokes land without a click.

interface InlineApprovalsState {
  queue: ToolApprovalRequest[]
  push: (request: ToolApprovalRequest) => void
  dismiss: (callId: string) => void
  clear: () => void
}

export const useInlineApprovalsStore = create<InlineApprovalsState>((set) => ({
  queue: [],
  push: (request) =>
    set((s) =>
      // De-dupe defensively — the IPC fan-out has been seen to redeliver
      // events on listener re-attach; the chip is keyed on callId so a
      // double-push would render two of them.
      s.queue.some((q) => q.callId === request.callId)
        ? s
        : { queue: [...s.queue, request] }
    ),
  dismiss: (callId) =>
    set((s) => ({ queue: s.queue.filter((q) => q.callId !== callId) })),
  clear: () => set({ queue: [] })
}))
