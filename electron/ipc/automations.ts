import { ipcMain } from 'electron'
import * as store from '../services/automations-store'
import { describeCron, nextFireAfter, parseCron, runAutomation } from '../services/automations-runner'

export function registerAutomationsHandlers(): void {
  ipcMain.handle('automations:list', async () => {
    try {
      return { success: true, data: store.listAutomations() }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'list failed' }
    }
  })

  ipcMain.handle(
    'automations:create',
    async (
      _e,
      input: { label: string; cron: string; prompt: string; model?: string | null }
    ) => {
      try {
        if (!input?.label || !input?.cron || !input?.prompt) {
          return { success: false, error: 'label, cron, prompt required' }
        }
        try {
          parseCron(input.cron)
        } catch (err: any) {
          return { success: false, error: `invalid cron: ${err?.message ?? 'parse error'}` }
        }
        return { success: true, data: store.createAutomation(input) }
      } catch (err: any) {
        return { success: false, error: err?.message ?? 'create failed' }
      }
    }
  )

  ipcMain.handle(
    'automations:update',
    async (
      _e,
      id: string,
      patch: Partial<{
        label: string
        cron: string
        prompt: string
        model: string | null
        enabled: boolean
      }>
    ) => {
      try {
        if (patch.cron) {
          try {
            parseCron(patch.cron)
          } catch (err: any) {
            return { success: false, error: `invalid cron: ${err?.message}` }
          }
        }
        store.updateAutomation(id, patch)
        return { success: true, data: true }
      } catch (err: any) {
        return { success: false, error: err?.message ?? 'update failed' }
      }
    }
  )

  ipcMain.handle('automations:delete', async (_e, id: string) => {
    try {
      store.deleteAutomation(id)
      return { success: true, data: true }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'delete failed' }
    }
  })

  ipcMain.handle('automations:runNow', async (_e, id: string) => {
    try {
      await runAutomation(id)
      return { success: true, data: true }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'run failed' }
    }
  })

  // G1 — cron expression validation + human-readable preview + next-fire
  // hint. Used by the AutomationsPanel CronEditor; returns
  // { valid: true, description, nextFireAt } on success or
  // { valid: false, error } when the expression doesn't parse.
  ipcMain.handle('automations:validateCron', async (_e, expr: string) => {
    try {
      if (typeof expr !== 'string' || expr.trim() === '') {
        return { success: true, data: { valid: false, error: 'cron expression is required' } }
      }
      try {
        parseCron(expr)
      } catch (err: any) {
        return {
          success: true,
          data: { valid: false, error: err?.message ?? 'cron parse error' }
        }
      }
      const description = describeCron(expr)
      const next = nextFireAfter(expr)
      return {
        success: true,
        data: {
          valid: true,
          description: description ?? null,
          nextFireAt: next ? next.getTime() : null
        }
      }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'validate failed' }
    }
  })
}
