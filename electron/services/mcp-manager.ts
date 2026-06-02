import { app, BrowserWindow } from 'electron'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import * as keychain from './keychain'

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

class McpManager {
  private servers = new Map<string, ServerState>()
  private statusCallbacks: ((serverId: string, status: ServerStatus, error?: string) => void)[] = []
  private initialized = false

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

    const result = await state.client.callTool({ name: toolName, arguments: args })

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
