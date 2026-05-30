import { ipcMain } from 'electron'
import * as store from '../services/conversation-store'

export function registerConversationHandlers(): void {
  ipcMain.handle('conversation:list', async () => {
    try {
      return { success: true, data: store.listConversations() }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('conversation:get', async (_event, id) => {
    try {
      const conv = store.getConversation(id)
      if (!conv) return { success: false, error: 'Conversation not found' }
      return { success: true, data: conv }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('conversation:create', async (_event, model) => {
    try {
      return { success: true, data: store.createConversation(model) }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('conversation:delete', async (_event, id) => {
    try {
      store.deleteConversation(id)
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('conversation:updateTitle', async (_event, id, title) => {
    try {
      store.updateConversationTitle(id, title)
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('conversation:getMessages', async (_event, id) => {
    try {
      return { success: true, data: store.getMessages(id) }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
