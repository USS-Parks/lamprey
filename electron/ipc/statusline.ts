import { ipcMain } from 'electron'
import {
  loadStatusLineConfig,
  saveStatusLineConfig,
  STATUSLINE_ALL_SLOTS,
  type StatusLineSlot
} from '../services/statusline-config'

// H6 — Status line IPC.
//   statusline:get        → current config (default if no file on disk)
//   statusline:set        → write a partial update; returns the saved config
//   statusline:availableSlots → the canonical slot ids the renderer can map

export function registerStatusLineHandlers(): void {
  ipcMain.handle('statusline:get', async () => {
    try {
      return { success: true, data: loadStatusLineConfig() }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'get failed' }
    }
  })

  ipcMain.handle(
    'statusline:set',
    async (
      _event,
      input: { slots?: StatusLineSlot[]; formats?: Record<string, string> }
    ) => {
      try {
        const saved = saveStatusLineConfig({
          slots: input?.slots ?? [],
          formats: input?.formats ?? {}
        })
        return { success: true, data: saved }
      } catch (err: any) {
        return { success: false, error: err?.message ?? 'set failed' }
      }
    }
  )

  ipcMain.handle('statusline:availableSlots', async () => {
    return { success: true, data: STATUSLINE_ALL_SLOTS }
  })
}
