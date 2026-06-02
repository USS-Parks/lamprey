import { ensureDefaultMcpServers } from './mcp-defaults'
import { mcpManager } from './mcp-manager'

// Registers the bundled Node REPL MCP server with the running mcp-manager.
// Idempotent: an entry the user has already configured (or disabled) in
// mcp-servers.json is preserved verbatim.
//
// This is intentionally an explicit app-ready call, not a side effect from
// tool-pack registration. It touches app.getPath('userData') through
// mcp-manager initialization and may start stdio MCP processes.
let ensured = false
export async function ensureNodeReplDefaultServer(): Promise<void> {
  if (ensured) return
  ensured = true
  try {
    await mcpManager.initialize()
    await ensureDefaultMcpServers()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[node-repl-default-server] Failed to ensure default MCP servers:', message)
  }
}
