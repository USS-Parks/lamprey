import { ipcMain } from 'electron'
import { toolRegistry } from '../services/tool-registry'

export function registerToolsHandlers(): void {
  // Track 2 / C1: `tools:list` now returns lightweight stubs (no inputSchema).
  // The renderer drives a lazy expand-on-demand UX via `tools:resolve` and
  // `tools:search`; chat dispatch keeps using `getOpenAITools()` internally
  // so the model still sees every tool's full schema.
  ipcMain.handle('tools:list', async () => {
    try {
      return { success: true, data: toolRegistry.getStubs() }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'tools:list failed' }
    }
  })

  ipcMain.handle('tools:get', async (_event, id: string) => {
    const descriptor = toolRegistry.getById(id)
    if (!descriptor) return { success: false, error: `Unknown tool: ${id}` }
    return { success: true, data: descriptor }
  })

  // C1: full descriptor resolve for a list of tool names. Names that don't
  // match are silently dropped — the renderer should reconcile against the
  // request list to detect missing tools (e.g. a previously connected MCP
  // server going offline mid-session). Unknown-names-only requests return
  // an empty array, not an error.
  ipcMain.handle('tools:resolve', async (_event, names: string[]) => {
    try {
      if (!Array.isArray(names)) {
        return { success: false, error: 'tools:resolve expects an array of names' }
      }
      return { success: true, data: toolRegistry.resolveByName(names) }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'tools:resolve failed' }
    }
  })

  // C1: keyword + select: search. Returns full descriptors so callers can
  // expand stubs and inspect a tool in one round-trip. `select:foo,bar`
  // form bypasses scoring and returns the named tools in order.
  ipcMain.handle(
    'tools:search',
    async (_event, payload: { query: string; maxResults?: number }) => {
      try {
        if (!payload || typeof payload.query !== 'string') {
          return { success: false, error: 'tools:search expects { query: string }' }
        }
        const max =
          typeof payload.maxResults === 'number' && payload.maxResults > 0
            ? payload.maxResults
            : 10
        return { success: true, data: toolRegistry.search(payload.query, max) }
      } catch (err: any) {
        return { success: false, error: err?.message ?? 'tools:search failed' }
      }
    }
  )

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
