import { ensureDefaultMcpServers } from './mcp-defaults'
import { mcpManager } from './mcp-manager'

// Registers the bundled Node REPL MCP server with the running mcp-manager.
// Idempotent: an entry the user has already configured (or disabled) in
// mcp-servers.json is preserved verbatim. addServerIfMissing only appends.
//
// mcpManager.initialize() must run before we mutate the server list; if it
// has not, we await it here so the on-disk config is loaded and the in-memory
// map is the authoritative source. initialize() guards against double-init,
// so calling it from main.ts AND here is safe.
let ensured = false
async function ensureOnce(): Promise<void> {
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

void ensureOnce()
