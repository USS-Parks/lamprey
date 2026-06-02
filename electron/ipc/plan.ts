import { ipcMain } from 'electron'
import { getPlanSnapshot } from '../services/plan-goal-store'

// Read-side IPC for the per-conversation plan checklist. The model writes
// through the `update_plan` native tool (handled inside the chat tool loop);
// after each successful write chat.ts emits `plan:updated` so the renderer
// store stays live without polling.

export function registerPlanHandlers(): void {
  ipcMain.handle('plan:get', async (_event, conversationId?: string) => {
    try {
      return { success: true, data: getPlanSnapshot(conversationId) }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'plan:get failed' }
    }
  })
}
