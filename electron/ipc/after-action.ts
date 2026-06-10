import { ipcMain } from 'electron'
import { buildAfterActionReport } from '../services/after-action-report'
// SP-8 (Sweet Spot Phase, 2026-06-10) — D6: CR-3 documented the router
// telemetry ring buffer as "surfaced via IPC", but no handler ever existed.
// This closes the gap; the After action panel renders the buffer.
import { getRecentRouterDecisions } from '../services/router-telemetry'

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

  ipcMain.handle('after-action:routerTelemetry', async (_event, conversationId: unknown) => {
    try {
      const all = getRecentRouterDecisions()
      // Optional conversation filter: entries carry conversationId when the
      // dispatch had one; pass nothing to see the whole session buffer.
      const data =
        typeof conversationId === 'string' && conversationId.trim()
          ? all.filter((d) => d.conversationId === conversationId)
          : all
      return { success: true, data }
    } catch (err: any) {
      return {
        success: false,
        error: err?.message ?? 'after-action:routerTelemetry failed'
      }
    }
  })
}
