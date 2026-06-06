import { app, BrowserWindow } from 'electron'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import * as keychain from './keychain'
import { trace } from './debug-trace'

// T2 — Per-call MCP timeout. The SDK has built-in `RequestOptions.timeout`
// support (it throws McpError with code RequestTimeout on expiry). We pass
// it on every callTool so a hung remote server (Ahrefs slow query, browser
// MCP waiting on a dead tab, stalled stdio child) can never block the chat
// turn indefinitely. The threshold is read from settings.json each call so
// the user can tune it without a restart.
export class MCPTimeoutError extends Error {
  constructor(public readonly serverId: string, public readonly toolName: string, public readonly timeoutMs: number) {
    super(
      `MCP tool '${serverId}__${toolName}' did not respond within ${Math.round(timeoutMs / 1000)}s — the server is likely stalled or the operation is too slow.`
    )
    this.name = 'MCPTimeoutError'
  }
}

const DEFAULT_MCP_CALL_TIMEOUT_MS = 120_000
const MIN_MCP_CALL_TIMEOUT_MS = 5_000

let mcpCallTimeoutOverrideMs: number | null = null
export function __setMcpCallTimeoutForTesting(ms: number | null): void {
  mcpCallTimeoutOverrideMs = ms
}

function readMcpCallTimeoutMs(): number {
  if (mcpCallTimeoutOverrideMs !== null) return mcpCallTimeoutOverrideMs
  try {
    const path = join(app.getPath('userData'), 'settings.json')
    if (!existsSync(path)) return DEFAULT_MCP_CALL_TIMEOUT_MS
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as { mcpCallTimeoutMs?: unknown }
    const ms = raw.mcpCallTimeoutMs
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return DEFAULT_MCP_CALL_TIMEOUT_MS
    if (ms <= 0) return 0 // 0 disables the per-call cap (SDK default still applies)
    return Math.max(MIN_MCP_CALL_TIMEOUT_MS, ms)
  } catch {
    return DEFAULT_MCP_CALL_TIMEOUT_MS
  }
}

export interface McpTool {
  name: string
  description?: string
  inputSchema?: unknown
}

export interface McpServerConfig {
  id: string
  name: string
  transport: 'sse' | 'stdio'
  url?: string
  command?: string
  args?: string[]
  // Optional extra env vars merged on top of `process.env` when launching a
  // stdio server. Used by the bundled Node REPL default server to set
  // ELECTRON_RUN_AS_NODE=1; ignored for SSE transports.
  env?: Record<string, string>
  auth: 'google-oauth' | 'none'
  enabled: boolean
  /** Customize C11: when registered transiently by the plugin runtime,
   *  the owning plugin id. Plugin-owned servers are NEVER persisted to
   *  mcp-servers.json; they're rebuilt from the plugin's connectors.json
   *  every boot + on every plugin enable/disable. */
  pluginId?: string
}

type ServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface ServerState {
  config: McpServerConfig
  status: ServerStatus
  error?: string
  client: Client | null
  transport: SSEClientTransport | StdioClientTransport | null
  tools: McpTool[]
  restartCount: number
}

const MAX_RESTARTS = 3
const RETRY_DELAYS = [1000, 3000, 9000]

function getConfigPath(): string {
  return join(app.getPath('userData'), 'mcp-servers.json')
}

function getDefaultConfigs(): McpServerConfig[] {
  return [
    {
      id: 'gmail',
      name: 'Gmail',
      transport: 'sse',
      url: 'https://gmail.googleapis.com/mcp/sse',
      auth: 'google-oauth',
      enabled: true
    },
    {
      id: 'drive',
      name: 'Google Drive',
      transport: 'sse',
      url: 'https://drive.googleapis.com/mcp/sse',
      auth: 'google-oauth',
      enabled: true
    },
    {
      id: 'chrome',
      name: 'Chrome (Playwright)',
      transport: 'stdio',
      command: 'npx',
      args: ['@anthropic-ai/mcp-server-playwright', '--browser', 'chromium'],
      auth: 'none',
      enabled: true
    }
  ]
}

function loadConfigs(): McpServerConfig[] {
  const configPath = getConfigPath()
  if (!existsSync(configPath)) {
    const defaults = getDefaultConfigs()
    writeFileSync(configPath, JSON.stringify(defaults, null, 2), 'utf-8')
    return defaults
  }
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch {
    const defaults = getDefaultConfigs()
    writeFileSync(configPath, JSON.stringify(defaults, null, 2), 'utf-8')
    return defaults
  }
}

function saveConfigs(configs: McpServerConfig[]): void {
  writeFileSync(getConfigPath(), JSON.stringify(configs, null, 2), 'utf-8')
}

export class McpManager {
  private servers = new Map<string, ServerState>()
  private statusCallbacks: ((serverId: string, status: ServerStatus, error?: string) => void)[] = []
  private initialized = false
  // Customize C11: plugin-owned servers live in a separate Map keyed by
  // namespaced id (`<pluginId>:<connectorId>`). They're NEVER persisted
  // to mcp-servers.json — rebuilt from plugin connectors.json on every
  // plugin enable/disable.
  private pluginServers = new Map<string, ServerState>()
  private unsubscribePluginChanges: (() => void) | null = null

  async initialize(): Promise<void> {
    if (this.initialized) return
    this.initialized = true

    const configs = loadConfigs()
    for (const config of configs) {
      this.servers.set(config.id, {
        config,
        status: 'disconnected',
        client: null,
        transport: null,
        tools: [],
        restartCount: 0
      })
    }

    for (const [id, state] of this.servers) {
      if (state.config.enabled) {
        this.connectServer(id).catch((err) => {
          console.error(`[mcp] Failed to connect ${id}:`, err.message)
        })
      }
    }

    // Customize C11: subscribe to plugin enable/disable broadcasts so the
    // plugin-owned server set stays in sync. The lazy require avoids a
    // hard module-load order between plugin-loader and mcp-manager.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pl = require('./plugin-loader') as {
        subscribeToPluginChanges: (cb: () => void) => () => void
      }
      this.unsubscribePluginChanges = pl.subscribeToPluginChanges(() =>
        this.refreshPluginConnectors()
      )
      this.refreshPluginConnectors()
    } catch (err) {
      console.error('[mcp] plugin subscription failed:', (err as Error).message)
    }
  }

  /** Customize C11: rebuild the plugin-owned server set from the current
   *  enabled plugins. Disconnects + drops any plugin server that's no
   *  longer enabled; adds any new ones. Persisted servers are untouched. */
  private refreshPluginConnectors(): void {
    let enabledRoots: { pluginId: string; rootPath: string }[]
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pl = require('./plugin-loader') as {
        enabledPluginRoots: () => { pluginId: string; rootPath: string }[]
      }
      enabledRoots = pl.enabledPluginRoots()
    } catch {
      enabledRoots = []
    }

    const desired = new Map<string, McpServerConfig>()
    for (const { pluginId, rootPath } of enabledRoots) {
      const fp = join(rootPath, 'connectors.json')
      if (!existsSync(fp)) continue
      try {
        const parsed = JSON.parse(readFileSync(fp, 'utf-8'))
        if (!Array.isArray(parsed)) continue
        for (const raw of parsed) {
          if (!raw || typeof raw !== 'object') continue
          const obj = raw as Record<string, unknown>
          const innerId = typeof obj.id === 'string' ? obj.id : ''
          if (!innerId) continue
          const namespacedId = `${pluginId}:${innerId}`
          const transport =
            obj.transport === 'stdio' || obj.transport === 'sse' ? obj.transport : null
          if (!transport) continue
          const cfg: McpServerConfig = {
            id: namespacedId,
            name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : namespacedId,
            transport,
            auth: obj.auth === 'google-oauth' ? 'google-oauth' : 'none',
            enabled: true,
            pluginId
          }
          if (transport === 'sse' && typeof obj.url === 'string') cfg.url = obj.url
          if (transport === 'stdio' && typeof obj.command === 'string') {
            cfg.command = obj.command
            if (Array.isArray(obj.args)) {
              cfg.args = obj.args.filter((a: unknown): a is string => typeof a === 'string')
            }
            if (obj.env && typeof obj.env === 'object' && !Array.isArray(obj.env)) {
              const env: Record<string, string> = {}
              for (const [k, v] of Object.entries(obj.env as Record<string, unknown>)) {
                if (typeof v === 'string') env[k] = v
              }
              cfg.env = env
            }
          }
          desired.set(namespacedId, cfg)
        }
      } catch (err) {
        console.error('[mcp] failed to read plugin connectors at', fp, err)
      }
    }

    // Disconnect + drop entries no longer present.
    for (const [id, state] of this.pluginServers) {
      if (!desired.has(id)) {
        void this.cleanupServer(state)
        this.pluginServers.delete(id)
      }
    }

    // Add new entries; preserve existing connections.
    for (const [id, cfg] of desired) {
      if (this.pluginServers.has(id)) continue
      const state: ServerState = {
        config: cfg,
        status: 'disconnected',
        client: null,
        transport: null,
        tools: [],
        restartCount: 0
      }
      this.pluginServers.set(id, state)
      // Attempt to connect; surface failures via the status callback.
      this.connectPluginServer(id).catch((err) => {
        console.error(`[mcp] Failed to connect plugin server ${id}:`, err?.message)
      })
    }
  }

  private async connectPluginServer(id: string): Promise<void> {
    const state = this.pluginServers.get(id)
    if (!state) return
    // Reuse the same connect path as persistent servers by temporarily
    // adopting the state into the main Map for the connect call, then
    // popping it back out. Connect mutates state in place — that's fine.
    this.servers.set(id, state)
    try {
      await this.connectServer(id)
    } finally {
      // Whether connect succeeded or not, the state lives in
      // pluginServers as the canonical home. Remove from the main Map
      // so list operations don't double-count.
      this.servers.delete(id)
    }
  }

  getServers(): (McpServerConfig & { status: ServerStatus; error?: string })[] {
    const result: (McpServerConfig & { status: ServerStatus; error?: string })[] = []
    for (const state of this.servers.values()) {
      result.push({
        ...state.config,
        status: state.status,
        error: state.error
      })
    }
    // Customize C11: append plugin-owned servers. They carry pluginId so
    // the renderer can render a "from plugin: X" badge and lock the
    // remove affordance.
    for (const state of this.pluginServers.values()) {
      result.push({
        ...state.config,
        status: state.status,
        error: state.error
      })
    }
    return result
  }

  /**
   * Append a server config if no entry with the same id already exists,
   * persist the updated list, register the in-memory state, and (if
   * enabled) start connecting. No-op when an id collision is found, so
   * user edits in mcp-servers.json take precedence over the default. Returns
   * true when the server was newly added.
   */
  async addServerIfMissing(config: McpServerConfig): Promise<boolean> {
    if (this.servers.has(config.id)) return false

    // Persist alongside the user's existing configs so the entry survives
    // restarts and shows up in the settings UI like any other server.
    const existing = loadConfigs()
    if (!existing.some((c) => c.id === config.id)) {
      saveConfigs([...existing, config])
    }

    this.servers.set(config.id, {
      config,
      status: 'disconnected',
      client: null,
      transport: null,
      tools: [],
      restartCount: 0
    })

    if (config.enabled) {
      this.connectServer(config.id).catch((err) => {
        console.error(`[mcp] Failed to connect default server ${config.id}:`, err?.message)
      })
    }

    return true
  }

  /**
   * Self-healing variant for bundled default servers. Owns specific fields
   * (`command`, `args`, `env`) and refreshes them when stale — e.g. when
   * `process.execPath` differs because the user upgraded Electron, or when
   * the bundled server.js moved between dev and packaged paths. Preserves
   * the user's `enabled` flag and `name` so toggling the default off keeps
   * sticking across restarts.
   *
   * Returns 'added' when no entry existed, 'updated' when managed fields
   * changed, 'unchanged' when the existing entry already matched.
   */
  async upsertManagedDefault(
    desired: McpServerConfig
  ): Promise<'added' | 'updated' | 'unchanged'> {
    if (!this.servers.has(desired.id)) {
      await this.addServerIfMissing(desired)
      return 'added'
    }

    const existing = this.servers.get(desired.id)!.config
    const sameCommand = existing.command === desired.command
    const sameArgs = JSON.stringify(existing.args ?? []) === JSON.stringify(desired.args ?? [])
    const sameEnv = JSON.stringify(existing.env ?? {}) === JSON.stringify(desired.env ?? {})
    if (sameCommand && sameArgs && sameEnv) return 'unchanged'

    // Build the refreshed config: managed fields from desired, user fields
    // from existing.
    const refreshed: McpServerConfig = {
      ...existing,
      command: desired.command,
      args: desired.args,
      env: desired.env
    }

    const configs = loadConfigs().map((c) => (c.id === desired.id ? refreshed : c))
    saveConfigs(configs)
    const state = this.servers.get(desired.id)!
    state.config = refreshed
    state.restartCount = 0

    if (refreshed.enabled) {
      // Drop any in-flight stale connection so the next read uses the new
      // command/args.
      void this.cleanupServer(state).then(() => {
        this.connectServer(desired.id).catch((err) => {
          console.error(`[mcp] Reconnect after default refresh failed for ${desired.id}:`, err?.message)
        })
      })
    }

    return 'updated'
  }

  async connect(id: string): Promise<void> {
    return this.connectServer(id)
  }

  async disconnect(id: string): Promise<void> {
    const state = this.servers.get(id)
    if (!state) return

    await this.cleanupServer(state)
    state.status = 'disconnected'
    state.error = undefined
    this.emitStatus(id, 'disconnected')
  }

  async reconnect(id: string): Promise<void> {
    const state = this.servers.get(id)
    if (!state) return

    await this.cleanupServer(state)
    state.restartCount = 0
    await this.connectServer(id)
  }

  listTools(id: string): McpTool[] {
    return this.servers.get(id)?.tools ?? []
  }

  getAllTools(): { serverId: string; tools: McpTool[] }[] {
    const result: { serverId: string; tools: McpTool[] }[] = []
    for (const [id, state] of this.servers) {
      if (state.status === 'connected' && state.tools.length > 0) {
        result.push({ serverId: id, tools: state.tools })
      }
    }
    return result
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const state = this.servers.get(serverId)
    if (!state || !state.client || state.status !== 'connected') {
      throw new Error(`MCP server '${serverId}' is not connected`)
    }

    const timeoutMs = readMcpCallTimeoutMs()
    const traceId = randomUUID().slice(0, 8)
    const startedAt = Date.now()
    trace('mcp.callTool.enter', {
      traceId,
      serverId,
      toolName,
      timeoutMs,
      argsKeys: Object.keys(args ?? {}),
      argsPreview: JSON.stringify(args ?? {}).slice(0, 200)
    })
    let result
    try {
      // 3rd arg `options.timeout`: SDK throws McpError(RequestTimeout) on
      // expiry. 0 disables our per-call cap and falls back to the SDK's
      // built-in default. resetTimeoutOnProgress=true lets a long-running
      // tool keep the connection alive as long as it sends progress notes.
      result = await state.client.callTool(
        { name: toolName, arguments: args },
        undefined,
        timeoutMs > 0
          ? { timeout: timeoutMs, resetTimeoutOnProgress: true }
          : undefined
      )
      trace('mcp.callTool.complete', {
        traceId,
        serverId,
        toolName,
        durationMs: Date.now() - startedAt,
        isError: result?.isError ?? false
      })
    } catch (err: any) {
      const isTimeout = err instanceof McpError && err.code === ErrorCode.RequestTimeout
      trace('mcp.callTool.error', {
        traceId,
        serverId,
        toolName,
        durationMs: Date.now() - startedAt,
        isTimeout,
        errName: err?.name,
        errCode: err instanceof McpError ? err.code : undefined,
        errMessage: String(err?.message ?? err).slice(0, 200)
      })
      if (isTimeout) {
        throw new MCPTimeoutError(serverId, toolName, timeoutMs > 0 ? timeoutMs : 60_000)
      }
      throw err
    }

    if (result.isError) {
      const errorText = Array.isArray(result.content)
        ? result.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('\n')
        : String(result.content)
      throw new Error(errorText || 'Tool call failed')
    }

    if (Array.isArray(result.content)) {
      const texts = result.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
      return texts.length === 1 ? texts[0] : texts.join('\n')
    }

    return result.content
  }

  onStatusChange(cb: (serverId: string, status: ServerStatus, error?: string) => void): void {
    this.statusCallbacks.push(cb)
  }

  async shutdown(): Promise<void> {
    for (const [, state] of this.servers) {
      await this.cleanupServer(state)
    }
    this.servers.clear()
  }

  private async connectServer(id: string): Promise<void> {
    const state = this.servers.get(id)
    if (!state) return

    state.status = 'connecting'
    state.error = undefined
    this.emitStatus(id, 'connecting')

    try {
      if (state.config.transport === 'sse') {
        await this.connectSSE(state)
      } else {
        await this.connectStdio(state)
      }
    } catch (err: any) {
      state.status = 'error'
      state.error = err.message
      this.emitStatus(id, 'error', err.message)
      console.error(`[mcp] Connection error for ${id}:`, err.message)
    }
  }

  private async connectSSE(state: ServerState): Promise<void> {
    if (state.config.auth === 'google-oauth') {
      const accessToken = keychain.getKey('google-access-token')
      if (!accessToken) {
        state.status = 'disconnected'
        state.error = 'Google OAuth not configured'
        this.emitStatus(state.config.id, 'disconnected', state.error)
        return
      }

      const expiryStr = keychain.getKey('google-token-expiry')
      const FIVE_MINUTES = 5 * 60 * 1000
      if (expiryStr && Date.now() + FIVE_MINUTES > parseInt(expiryStr, 10)) {
        const refreshed = await this.refreshGoogleToken()
        if (!refreshed) {
          state.status = 'error'
          state.error = 'Token refresh failed'
          this.emitStatus(state.config.id, 'error', state.error)
          return
        }
      }

      const token = keychain.getKey('google-access-token')!
      const url = new URL(state.config.url!)
      const transport = new SSEClientTransport(url, {
        eventSourceInit: {
          fetch: (input: string | URL | Request, init?: RequestInit) => {
            const headers = new Headers(init?.headers)
            headers.set('Authorization', `Bearer ${token}`)
            return fetch(input, { ...init, headers })
          }
        },
        requestInit: {
          headers: { Authorization: `Bearer ${token}` }
        }
      })

      const client = new Client({ name: 'lamprey', version: '1.0.0' })

      transport.onerror = (err) => {
        console.error(`[mcp] SSE error for ${state.config.id}:`, err.message)
        state.status = 'error'
        state.error = err.message
        this.emitStatus(state.config.id, 'error', err.message)
      }

      transport.onclose = () => {
        if (state.status === 'connected') {
          state.status = 'disconnected'
          this.emitStatus(state.config.id, 'disconnected')
        }
      }

      await this.connectWithRetry(state, client, transport)
    } else {
      const url = new URL(state.config.url!)
      const transport = new SSEClientTransport(url)
      const client = new Client({ name: 'lamprey', version: '1.0.0' })

      transport.onerror = (err) => {
        console.error(`[mcp] SSE error for ${state.config.id}:`, err.message)
        state.status = 'error'
        state.error = err.message
        this.emitStatus(state.config.id, 'error', err.message)
      }

      await this.connectWithRetry(state, client, transport)
    }
  }

  private async connectStdio(state: ServerState): Promise<void> {
    const mergedEnv = {
      ...(process.env as Record<string, string>),
      ...(state.config.env ?? {})
    }
    const transport = new StdioClientTransport({
      command: state.config.command!,
      args: state.config.args,
      env: mergedEnv,
      stderr: 'pipe'
    })

    const client = new Client({ name: 'lamprey', version: '1.0.0' })

    transport.onerror = (err) => {
      console.error(`[mcp] stdio error for ${state.config.id}:`, err.message)
      if (state.status === 'connected') {
        state.status = 'error'
        state.error = err.message
        this.emitStatus(state.config.id, 'error', err.message)

        if (state.restartCount < MAX_RESTARTS) {
          state.restartCount++
          console.log(`[mcp] Restarting ${state.config.id} (attempt ${state.restartCount}/${MAX_RESTARTS})`)
          this.cleanupServer(state).then(() => this.connectServer(state.config.id))
        }
      }
    }

    transport.onclose = () => {
      if (state.status === 'connected') {
        state.status = 'disconnected'
        this.emitStatus(state.config.id, 'disconnected')

        if (state.restartCount < MAX_RESTARTS) {
          state.restartCount++
          console.log(`[mcp] Restarting ${state.config.id} after close (attempt ${state.restartCount}/${MAX_RESTARTS})`)
          this.connectServer(state.config.id).catch(() => {})
        }
      }
    }

    await this.connectWithRetry(state, client, transport)
  }

  private async connectWithRetry(
    state: ServerState,
    client: Client,
    transport: SSEClientTransport | StdioClientTransport
  ): Promise<void> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
      try {
        await client.connect(transport)

        const toolsResult = await client.listTools()
        state.tools = toolsResult.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema
        }))

        state.client = client
        state.transport = transport
        state.status = 'connected'
        state.error = undefined
        state.restartCount = 0
        this.emitStatus(state.config.id, 'connected')

        console.log(`[mcp] Connected to ${state.config.id} — ${state.tools.length} tools available`)
        return
      } catch (err: any) {
        lastError = err
        console.warn(`[mcp] Connection attempt ${attempt + 1} for ${state.config.id} failed:`, err.message)
        if (attempt < RETRY_DELAYS.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]))
        }
      }
    }

    throw lastError || new Error('Connection failed after retries')
  }

  private async refreshGoogleToken(): Promise<boolean> {
    const refreshToken = keychain.getKey('google-refresh-token')
    const clientId = keychain.getKey('google-client-id')
    const clientSecret = keychain.getKey('google-client-secret')

    if (!refreshToken || !clientId || !clientSecret) {
      console.error('[mcp] Missing Google OAuth credentials for token refresh')
      return false
    }

    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token'
        })
      })

      if (!response.ok) {
        console.error('[mcp] Token refresh failed:', response.status)
        return false
      }

      const data = (await response.json()) as { access_token: string; expires_in: number }
      keychain.setKey('google-access-token', data.access_token)
      keychain.setKey('google-token-expiry', String(Date.now() + data.expires_in * 1000))
      return true
    } catch (err: any) {
      console.error('[mcp] Token refresh error:', err.message)
      return false
    }
  }

  private async cleanupServer(state: ServerState): Promise<void> {
    try {
      if (state.transport) {
        await state.transport.close()
      }
    } catch {
      // ignore cleanup errors
    }
    state.client = null
    state.transport = null
    state.tools = []
  }

  private emitStatus(serverId: string, status: ServerStatus, error?: string): void {
    for (const cb of this.statusCallbacks) {
      try {
        cb(serverId, status, error)
      } catch {
        // ignore callback errors
      }
    }

    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (mainWindow) {
      mainWindow.webContents.send('mcp:statusChanged', { serverId, status, error })
    }
  }
}

export const mcpManager = new McpManager()
