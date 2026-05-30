import { ipcMain } from 'electron'

export function registerConversationHandlers(): void {
  ipcMain.handle('conversation:list', async () => {
    return { success: true, data: null }
  })

  ipcMain.handle('conversation:get', async (_event, _id) => {
    return { success: true, data: null }
  })

  ipcMain.handle('conversation:create', async (_event, _model) => {
    return { success: true, data: null }
  })

  ipcMain.handle('conversation:delete', async (_event, _id) => {
    return { success: true, data: null }
  })

  ipcMain.handle('conversation:updateTitle', async (_event, _id, _title) => {
    return { success: true, data: null }
  })

  ipcMain.handle('conversation:getMessages', async (_event, _id) => {
    return { success: true, data: null }
  })
}
