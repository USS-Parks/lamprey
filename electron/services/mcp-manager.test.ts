import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock electron's app so the module loads under vitest's node environment.
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/lamprey-test-userdata-nonexistent'
  },
  BrowserWindow: class {}
}))

// Stub the SDK transports so importing the manager doesn't try to open a
// stdio child / SSE socket.
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: class {}
}))
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class {}
}))

// We need the real ErrorCode + McpError for the manager's instanceof check to
// match what the mocked Client throws.
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class FakeClient {
    public capturedTimeout: number | undefined
    async callTool(_params: unknown, _schema: unknown, opts?: { timeout?: number }) {
      // Record what the manager passed so the test can assert on it.
      FakeClient.lastTimeoutMs = opts?.timeout
      if (FakeClient.behaviour === 'timeout') {
        throw new McpError(ErrorCode.RequestTimeout, 'request timeout')
      }
      if (FakeClient.behaviour === 'generic-error') {
        throw new Error('boom')
      }
      return { isError: false, content: [{ type: 'text', text: 'ok' }] }
    }
    static lastTimeoutMs: number | undefined
    static behaviour: 'ok' | 'timeout' | 'generic-error' = 'ok'
  }
}))

// keychain is incidental; stub to be safe.
vi.mock('./keychain', () => ({
  getKey: () => null,
  hasKey: () => false,
  setKey: () => undefined
}))

import { McpManager, MCPTimeoutError, __setMcpCallTimeoutForTesting } from './mcp-manager'
import { Client as FakeClientCtor } from '@modelcontextprotocol/sdk/client/index.js'

function seedConnectedServer(mgr: McpManager, serverId: string): void {
  // Reach into the manager's internal state map. The test bypasses the real
  // connect/handshake flow entirely — we only care that callTool wires the
  // timeout and translates RequestTimeout into MCPTimeoutError.
  const fakeClient = new (FakeClientCtor as any)()
  ;(mgr as any).servers.set(serverId, {
    config: { id: serverId, name: serverId, transport: 'stdio', auth: 'none', enabled: true },
    status: 'connected',
    client: fakeClient,
    transport: null,
    tools: [],
    restartCount: 0
  })
}

beforeEach(() => {
  ;(FakeClientCtor as any).lastTimeoutMs = undefined
  ;(FakeClientCtor as any).behaviour = 'ok'
})

describe('mcpManager.callTool — per-call timeout (T2)', () => {
  it('passes the configured timeout to client.callTool', async () => {
    __setMcpCallTimeoutForTesting(45_000)
    const mgr = new McpManager()
    seedConnectedServer(mgr, 'srv1')

    const result = await mgr.callTool('srv1', 'do_thing', { x: 1 })

    expect(result).toBe('ok')
    expect((FakeClientCtor as any).lastTimeoutMs).toBe(45_000)

    __setMcpCallTimeoutForTesting(null)
  })

  it('falls back to SDK default when configured timeout is 0', async () => {
    __setMcpCallTimeoutForTesting(0)
    const mgr = new McpManager()
    seedConnectedServer(mgr, 'srv2')

    await mgr.callTool('srv2', 'do_thing', {})

    expect((FakeClientCtor as any).lastTimeoutMs).toBeUndefined()

    __setMcpCallTimeoutForTesting(null)
  })

  it('translates RequestTimeout McpError into a typed MCPTimeoutError', async () => {
    __setMcpCallTimeoutForTesting(30_000)
    ;(FakeClientCtor as any).behaviour = 'timeout'
    const mgr = new McpManager()
    seedConnectedServer(mgr, 'srv3')

    await expect(mgr.callTool('srv3', 'slow_query', { q: 'x' })).rejects.toMatchObject({
      name: 'MCPTimeoutError',
      serverId: 'srv3',
      toolName: 'slow_query',
      timeoutMs: 30_000
    })

    __setMcpCallTimeoutForTesting(null)
  })

  it('lets non-timeout errors pass through unchanged', async () => {
    __setMcpCallTimeoutForTesting(30_000)
    ;(FakeClientCtor as any).behaviour = 'generic-error'
    const mgr = new McpManager()
    seedConnectedServer(mgr, 'srv4')

    await expect(mgr.callTool('srv4', 'broken_tool', {})).rejects.toThrow('boom')

    __setMcpCallTimeoutForTesting(null)
  })

  it('MCPTimeoutError exposes server, tool, and threshold for logging', () => {
    const e = new MCPTimeoutError('srv', 'tool', 90_000)
    expect(e.name).toBe('MCPTimeoutError')
    expect(e.serverId).toBe('srv')
    expect(e.toolName).toBe('tool')
    expect(e.timeoutMs).toBe(90_000)
    expect(e.message).toMatch(/90s/)
  })
})
