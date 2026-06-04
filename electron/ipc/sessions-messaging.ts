import { ipcMain, BrowserWindow } from 'electron'
import {
  listActiveSessions,
  sendSessionMessage
} from '../services/cross-session-messaging'

export function registerSessionsMessagingHandlers(): void {
  ipcMain.handle('sessions:list-active', async (_event, limit?: number) => {
    try {
      return { success: true, data: listActiveSessions(limit) }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    'sessions-messaging:sendMessage',
    async (
      _event,
      input: { targetSessionId: string; body: string; fromSessionId?: string | null }
    ) => {
      try {
        const message = sendSessionMessage(input)
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('sessions:incoming-message', message)
        }
        return { success: true, data: message }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
}
