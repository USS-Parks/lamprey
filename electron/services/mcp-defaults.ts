import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { mcpManager, type McpServerConfig } from './mcp-manager'

// Bundles a Node REPL MCP server inside the app. This module owns two
// responsibilities:
//
//   1. Path resolution — dev runs out of the project tree, production runs
//      out of `process.resourcesPath`. Mirrors the dev/prod split that
//      skill-loader uses for bundled skills.
//
//   2. Idempotent registration — if the user's mcp-servers.json doesn't
//      already list `node-repl`, append it. We never overwrite an existing
//      entry, so the user can disable or edit the default without us
//      stomping on their changes.

const NODE_REPL_SERVER_ID = 'node-repl'

/**
 * Resolve the absolute path to the bundled node-repl `server.js`. In dev,
 * the compiled main entry sits at `out/main/index.js`, so the project root
 * is two levels up. In production, electron-builder's `extraResources`
 * step copies the directory to `${resourcesPath}/mcp/node-repl/`.
 *
 * Returns `null` if the file cannot be found, so the caller can decline to
 * register the server rather than seeding a broken config.
 */
export function getNodeReplServerPath(): string | null {
  const candidates: string[] = []
  if (is.dev) {
    // electron-vite emits the main process bundle to `out/main/index.js`.
    // From there the project root is two directories up.
    candidates.push(join(__dirname, '..', '..', 'resources', 'mcp', 'node-repl', 'server.js'))
    // Fallback for unusual local layouts (e.g. running compiled output from
    // a different cwd) — try the cwd-relative resources path too.
    candidates.push(join(process.cwd(), 'resources', 'mcp', 'node-repl', 'server.js'))
  } else {
    candidates.push(join(process.resourcesPath, 'mcp', 'node-repl', 'server.js'))
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Build the default MCP server configs that should be present on every
 * install. Returns an empty list if the bundled assets aren't on disk so
 * callers can no-op gracefully.
 *
 * The node-repl server runs via Electron's own binary with the
 * `ELECTRON_RUN_AS_NODE=1` escape hatch — that's the documented way to
 * reuse the bundled Node runtime on end-user machines that don't have a
 * system Node installed.
 */
export function getDefaultMcpServers(): McpServerConfig[] {
  const serverPath = getNodeReplServerPath()
  if (!serverPath) return []
  return [
    {
      id: NODE_REPL_SERVER_ID,
      name: 'Node REPL',
      transport: 'stdio',
      command: process.execPath,
      args: [serverPath],
      env: { ELECTRON_RUN_AS_NODE: '1' },
      auth: 'none',
      enabled: true
    }
  ]
}

/**
 * Idempotently ensure each default server is registered with the running
 * mcp-manager. Safe to call multiple times; existing entries are left
 * untouched so user edits (disable, custom args, etc.) win.
 *
 * Must be invoked AFTER `mcpManager.initialize()` so the in-memory list and
 * the on-disk config file have been loaded. Returns the ids that were
 * newly added (empty array if everything was already present).
 */
export async function ensureDefaultMcpServers(): Promise<string[]> {
  const defaults = getDefaultMcpServers()
  if (defaults.length === 0) {
    console.warn('[mcp-defaults] No bundled servers found on disk; skipping registration.')
    return []
  }

  // Self-heal: managed fields (`command`, `args`, `env`) are refreshed when
  // stale so a packaged build doesn't keep pointing at a dev path or a
  // process.execPath from a previous Electron version. The user's `enabled`
  // flag is preserved — disabling the default sticks.
  const touched: string[] = []
  for (const config of defaults) {
    try {
      const outcome = await mcpManager.upsertManagedDefault(config)
      if (outcome !== 'unchanged') touched.push(`${config.id}:${outcome}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[mcp-defaults] Failed to register default server '${config.id}':`, message)
    }
  }

  if (touched.length > 0) {
    console.log(`[mcp-defaults] Default MCP servers: ${touched.join(', ')}`)
  }

  return touched
}
