import { ipcMain } from 'electron'
import { pushNotification } from '../services/notifications-service'

export function registerNotificationsHandlers(): void {
  ipcMain.handle(
    'notifications:push',
    async (_event, input: { title: string; body: string; deepLink?: string | null }) => {
      try {
        return { success: true, data: pushNotification(input) }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
}
