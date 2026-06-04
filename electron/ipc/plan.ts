import { ipcMain } from 'electron'
import {
  clearAllState,
  clearConversationState,
  getAllPlanGoalState,
  getPlanSnapshot
} from '../services/plan-goal-store'
import { emitChatEvent } from '../services/chat-events'
import {
  isPlanModeActive,
  setPlanModeActive
} from '../services/conversation-store'

// Read-side IPC for the per-conversation plan checklist, plus the inspect/clear
// surface used by the Plan & Goals settings panel. The model writes through the
// `update_plan` / goal native tools (handled inside the chat tool loop); after
// each successful write chat.ts emits `plan:updated` so the renderer store stays
// live without polling. The clear handlers below emit the same event so an open
// checklist refreshes when state is cleared from settings.

const GLOBAL_KEY = '__global__'

export function registerPlanHandlers(): void {
  ipcMain.handle('plan:get', async (_event, conversationId?: string) => {
    try {
      return { success: true, data: getPlanSnapshot(conversationId) }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'plan:get failed' }
    }
  })

  ipcMain.handle('plan:listAllState', async () => {
    try {
      return { success: true, data: getAllPlanGoalState() }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'plan:listAllState failed' }
    }
  })

  ipcMain.handle('plan:clearConversationState', async (_event, conversationId: string) => {
    try {
      if (typeof conversationId !== 'string' || !conversationId) {
        return { success: false, error: 'conversationId is required' }
      }
      clearConversationState(conversationId)
      if (conversationId !== GLOBAL_KEY) {
        emitChatEvent('plan:updated', {
          conversationId,
          snapshot: getPlanSnapshot(conversationId)
        })
      }
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'plan:clearConversationState failed' }
    }
  })

  ipcMain.handle('plan:clearAllState', async () => {
    try {
      // Capture affected conversations before wiping so any open checklists can
      // be told to refresh to an empty plan.
      const affected = getAllPlanGoalState().map((s) => s.conversationId)
      clearAllState()
      for (const id of affected) {
        if (id !== GLOBAL_KEY) {
          emitChatEvent('plan:updated', { conversationId: id, snapshot: getPlanSnapshot(id) })
        }
      }
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'plan:clearAllState failed' }
    }
  })

  // Track 2 / C3 — plan-mode gate. The model toggles this via the
  // `enter_plan_mode` / `exit_plan_mode` tool descriptors during a chat
  // turn; the renderer banner uses these IPC channels for the user-facing
  // Exit button and for hydrating the banner state on conversation
  // switch. Both flips emit `plan:mode-changed` for live subscribers.
  ipcMain.handle('plan:isModeActive', async (_event, conversationId: string) => {
    try {
      if (typeof conversationId !== 'string' || !conversationId) {
        return { success: false, error: 'conversationId is required' }
      }
      return { success: true, data: isPlanModeActive(conversationId) }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'plan:isModeActive failed' }
    }
  })

  ipcMain.handle('plan:enterMode', async (_event, conversationId: string) => {
    try {
      if (typeof conversationId !== 'string' || !conversationId) {
        return { success: false, error: 'conversationId is required' }
      }
      const ok = setPlanModeActive(conversationId, true)
      if (ok) {
        emitChatEvent('plan:mode-changed', { conversationId, active: true })
      }
      return { success: true, data: ok }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'plan:enterMode failed' }
    }
  })

  ipcMain.handle('plan:exitMode', async (_event, conversationId: string) => {
    try {
      if (typeof conversationId !== 'string' || !conversationId) {
        return { success: false, error: 'conversationId is required' }
      }
      const ok = setPlanModeActive(conversationId, false)
      if (ok) {
        emitChatEvent('plan:mode-changed', { conversationId, active: false })
      }
      return { success: true, data: ok }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'plan:exitMode failed' }
    }
  })
}
