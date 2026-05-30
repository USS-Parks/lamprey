import { ipcMain } from 'electron'

export function registerChatHandlers(): void {
  ipcMain.handle('chat:send', async (_event, _request) => {
    return { success: true, data: null }
  })

  ipcMain.handle('chat:cancel', async (_event, _conversationId) => {
    return { success: true, data: null }
  })
}
