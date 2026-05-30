import { ipcMain } from 'electron'
import { mcpManager } from '../services/mcp-manager'

export function registerMcpHandlers(): void {
  ipcMain.handle('mcp:list', async () => {
    try {
      const servers = mcpManager.getServers()
      return { success: true, data: servers }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('mcp:getStatus', async (_event, id: string) => {
    try {
      const servers = mcpManager.getServers()
      const server = servers.find((s) => s.id === id)
      if (!server) return { success: false, error: `Server '${id}' not found` }
      return { success: true, data: { status: server.status, error: server.error } }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('mcp:reconnect', async (_event, id: string) => {
    try {
      await mcpManager.reconnect(id)
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('mcp:setupGoogleOAuth', async () => {
    // Stub — full implementation in Prompt 12
    return { success: true, data: null }
  })

  // mcp:approveToolCall is registered in chat.ts (handles confirmation flow)
}
