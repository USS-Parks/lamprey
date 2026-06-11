import { ipcMain } from 'electron'
import { buildAfterActionReport } from '../services/after-action-report'

// UB-3 (Unburdening Phase, 2026-06-10) — the SP-8 router-telemetry channel
// died with the L8 router itself (no producers since UB-1).
export function registerAfterActionHandlers(): void {
  ipcMain.handle('after-action:get', async (_event, conversationId: unknown) => {
    try {
      if (typeof conversationId !== 'string' || !conversationId.trim()) {
        return { success: false, error: 'conversationId is required' }
      }
      return { success: true, data: buildAfterActionReport(conversationId) }
    } catch (err: any) {
      return {
        success: false,
        error: err?.message ?? 'after-action:get failed'
      }
    }
  })
}
