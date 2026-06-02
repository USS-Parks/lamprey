import { ipcMain } from 'electron'
import { toolRegistry } from '../services/tool-registry'

export function registerToolsHandlers(): void {
  ipcMain.handle('tools:list', async () => {
    try {
      return { success: true, data: toolRegistry.getDescriptors() }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'tools:list failed' }
    }
  })

  ipcMain.handle('tools:get', async (_event, id: string) => {
    const descriptor = toolRegistry.getById(id)
    if (!descriptor) return { success: false, error: `Unknown tool: ${id}` }
    return { success: true, data: descriptor }
  })

  ipcMain.handle('tools:getRecentCalls', async (_event, limit?: number) => {
    try {
      const data = toolRegistry.getRecentCalls(
        typeof limit === 'number' ? limit : undefined
      )
      return { success: true, data }
    } catch (err: any) {
      return {
        success: false,
        error: err?.message ?? 'tools:getRecentCalls failed'
      }
    }
  })

  ipcMain.handle(
    'tools:getCallsForConversation',
    async (_event, conversationId: string, limit?: number) => {
      try {
        if (!conversationId || typeof conversationId !== 'string') {
          return { success: false, error: 'conversationId is required' }
        }
        const data = toolRegistry.getCallsForConversation(
          conversationId,
          typeof limit === 'number' ? limit : undefined
        )
        return { success: true, data }
      } catch (err: any) {
        return {
          success: false,
          error: err?.message ?? 'tools:getCallsForConversation failed'
        }
      }
    }
  )
}
