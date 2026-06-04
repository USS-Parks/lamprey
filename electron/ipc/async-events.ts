import { ipcMain } from 'electron'
import {
  drainAsyncEventsForPrompt,
  listPendingAsyncEvents
} from '../services/async-event-bridge'

export function registerAsyncEventHandlers(): void {
  ipcMain.handle('async-events:list', async (_e, conversationId: string) => {
    try {
      if (typeof conversationId !== 'string' || !conversationId.trim()) {
        return { success: false, error: 'conversationId required' }
      }
      return { success: true, data: listPendingAsyncEvents(conversationId) }
    } catch (err: unknown) {
      return { success: false, error: messageFor(err, 'list failed') }
    }
  })

  ipcMain.handle('async-events:drain', async (_e, conversationId: string) => {
    try {
      if (typeof conversationId !== 'string' || !conversationId.trim()) {
        return { success: false, error: 'conversationId required' }
      }
      return { success: true, data: drainAsyncEventsForPrompt(conversationId) }
    } catch (err: unknown) {
      return { success: false, error: messageFor(err, 'drain failed') }
    }
  })
}

function messageFor(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message || fallback
  if (typeof err === 'string') return err || fallback
  return fallback
}
