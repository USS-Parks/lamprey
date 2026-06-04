import { ipcMain } from 'electron'
import {
  cancelWakeup,
  listWakeups,
  scheduleWakeup,
  type LoopWakeupStatus
} from '../services/loop-runner'

export function registerLoopsHandlers(): void {
  ipcMain.handle(
    'loops:schedule',
    async (
      _event,
      input: {
        conversationId: string
        delaySeconds: number
        prompt: string
        reason?: string | null
      }
    ) => {
      try {
        return { success: true, data: scheduleWakeup(input) }
      } catch (err) {
        return { success: false, error: messageFor(err, 'schedule failed') }
      }
    }
  )

  ipcMain.handle('loops:cancel', async (_event, id: string) => {
    try {
      return { success: true, data: { cancelled: cancelWakeup(id) } }
    } catch (err) {
      return { success: false, error: messageFor(err, 'cancel failed') }
    }
  })

  ipcMain.handle(
    'loops:list',
    async (
      _event,
      filter?: {
        conversationId?: string
        status?: LoopWakeupStatus | LoopWakeupStatus[]
        limit?: number
      }
    ) => {
      try {
        return { success: true, data: listWakeups(filter) }
      } catch (err) {
        return { success: false, error: messageFor(err, 'list failed') }
      }
    }
  )
}

function messageFor(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message || fallback
  if (typeof err === 'string') return err || fallback
  return fallback
}
