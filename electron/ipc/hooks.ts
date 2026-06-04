import { ipcMain } from 'electron'
import * as store from '../services/hooks-store'
import { testHook, type HookContext } from '../services/hooks-runner'

export function registerHooksHandlers(): void {
  ipcMain.handle('hooks:list', async () => {
    try {
      return { success: true, data: store.listHooks() }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'list failed' }
    }
  })

  ipcMain.handle(
    'hooks:create',
    async (
      _e,
      input: {
        event: store.HookEvent
        label: string
        command: string
        language?: store.HookLanguage
        timeoutMs?: number
      }
    ) => {
      try {
        if (!input?.event || !input?.label || !input?.command) {
          return { success: false, error: 'event, label, command required' }
        }
        return { success: true, data: store.createHook(input) }
      } catch (err: any) {
        return { success: false, error: err?.message ?? 'create failed' }
      }
    }
  )

  ipcMain.handle(
    'hooks:update',
    async (
      _e,
      id: string,
      patch: Partial<{
        event: store.HookEvent
        label: string
        command: string
        enabled: boolean
        language: store.HookLanguage
        timeoutMs: number
      }>
    ) => {
      try {
        store.updateHook(id, patch)
        return { success: true, data: true }
      } catch (err: any) {
        return { success: false, error: err?.message ?? 'update failed' }
      }
    }
  )

  ipcMain.handle('hooks:delete', async (_e, id: string) => {
    try {
      store.deleteHook(id)
      return { success: true, data: true }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'delete failed' }
    }
  })

  // Track 2 / C2 — test-run path for the HooksSettings UI. The renderer
  // sends the (possibly unsaved) code, the target event, a sample
  // context, and optional timeoutMs. We run the JS sandbox once and
  // return the captured logs + any throw message. Does not consult the
  // persisted hooks table.
  ipcMain.handle(
    'hooks:test',
    async (
      _e,
      payload: {
        code: string
        event: store.HookEvent
        context?: HookContext
        timeoutMs?: number
      }
    ) => {
      try {
        if (!payload || typeof payload.code !== 'string') {
          return { success: false, error: 'code required' }
        }
        if (!payload.event) return { success: false, error: 'event required' }
        const r = testHook({
          code: payload.code,
          event: payload.event,
          context: payload.context,
          timeoutMs: payload.timeoutMs
        })
        return { success: true, data: r }
      } catch (err: any) {
        return { success: false, error: err?.message ?? 'test failed' }
      }
    }
  )
}
