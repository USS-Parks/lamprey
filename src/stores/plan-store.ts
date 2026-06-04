import { create } from 'zustand'
import type { PlanSnapshot, PlanStep, PlanStepStatus } from '@/lib/types'

// Plan checklist + plan-mode store. One snapshot per active conversation;
// chat-store's selectConversation triggers a load, and useChat wires the
// plan:updated stream so live tool calls refresh the UI without polling.
//
// Track 2 / C3 adds the plan-mode gate: a per-conversation boolean that,
// when on, blocks the chat dispatcher from running any tool with
// mutates: true (apply_patch, shell_command, destructive MCP). The model
// toggles via `enter_plan_mode` / `exit_plan_mode`; the renderer surfaces
// a persistent yellow banner with an Exit button.

interface PlanState {
  // null = no plan recorded for the active conversation yet.
  snapshot: PlanSnapshot | null
  // The conversation the snapshot belongs to. Used to drop stale events when
  // the user switches conversations mid-stream.
  conversationId: string | null

  // Track 2 / C3 — plan-mode flag for the active conversation. `null`
  // means we haven't fetched yet (component shows nothing); `false` is
  // the steady state; `true` shows the banner.
  planModeActive: boolean | null

  loadForConversation: (conversationId: string) => Promise<void>
  applyUpdate: (snapshot: PlanSnapshot) => void
  applyModeChange: (event: { conversationId: string; active: boolean }) => void
  updatePlan: (
    conversationId: string,
    steps: Array<Partial<Pick<PlanStep, 'id' | 'text' | 'status'>>>,
    replace?: boolean
  ) => Promise<boolean>
  setAllStatuses: (conversationId: string, status: PlanStepStatus) => Promise<boolean>
  enterPlanMode: (conversationId: string) => Promise<boolean>
  exitPlanMode: (conversationId: string) => Promise<boolean>
  clear: () => void
}

export const usePlanStore = create<PlanState>((set, get) => ({
  snapshot: null,
  conversationId: null,
  planModeActive: null,

  loadForConversation: async (conversationId: string) => {
    if (!window.api) return
    set({ conversationId, snapshot: null, planModeActive: null })
    const [planResult, modeResult] = await Promise.all([
      window.api.plan.get(conversationId),
      window.api.plan.isModeActive?.(conversationId) ?? Promise.resolve(null)
    ])
    // The user may have switched conversations again while these fetches were
    // in flight; drop the result silently if so.
    if (get().conversationId !== conversationId) return
    if (planResult.success) {
      set({ snapshot: planResult.data as PlanSnapshot })
    }
    if (modeResult && (modeResult as { success?: boolean }).success) {
      set({ planModeActive: (modeResult as { data: boolean }).data })
    } else {
      // Older preload without plan-mode bindings: leave as null. Banner
      // stays hidden, which is the safe default.
      set({ planModeActive: false })
    }
  },

  applyUpdate: (snapshot: PlanSnapshot) => {
    const active = get().conversationId
    if (active && snapshot.conversationId !== active) return
    set({ snapshot })
  },

  applyModeChange: ({ conversationId, active }) => {
    const current = get().conversationId
    if (current && current !== conversationId) return
    set({ planModeActive: active })
  },

  updatePlan: async (conversationId, steps, replace = false) => {
    if (!window.api?.plan?.update) return false
    const result = await window.api.plan.update(conversationId, { replace, steps })
    if (!result.success) return false
    if (get().conversationId === conversationId) {
      set({ snapshot: result.data as PlanSnapshot })
    }
    return true
  },

  setAllStatuses: async (conversationId, status) => {
    const snapshot = get().snapshot
    if (!snapshot || snapshot.conversationId !== conversationId) return false
    return get().updatePlan(
      conversationId,
      snapshot.steps.map((step) => ({ ...step, status })),
      true
    )
  },

  enterPlanMode: async (conversationId: string) => {
    if (!window.api?.plan?.enterMode) return false
    const r = await window.api.plan.enterMode(conversationId)
    if (r.success && get().conversationId === conversationId) {
      set({ planModeActive: true })
    }
    return r.success
  },

  exitPlanMode: async (conversationId: string) => {
    if (!window.api?.plan?.exitMode) return false
    const r = await window.api.plan.exitMode(conversationId)
    if (r.success && get().conversationId === conversationId) {
      set({ planModeActive: false })
    }
    return r.success
  },

  clear: () => {
    set({ snapshot: null, conversationId: null, planModeActive: null })
  }
}))
