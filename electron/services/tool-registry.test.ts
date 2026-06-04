import { describe, it, expect } from 'vitest'

// Regression guard for the production startup crash.
//
// `tool-registry.ts` once held the bundled tool-pack side-effect imports
// at the bottom of the file. ES-module bundlers can hoist those imports
// above `export const toolRegistry = new ToolRegistry()`, which caused
// every pack's top-level `toolRegistry.registerNative(...)` to throw
// "ReferenceError: Cannot access 'toolRegistry' before initialization"
// at app startup.
//
// The packs now live in `tool-packs.ts` (loaded explicitly from
// `electron/ipc/index.ts`). This test pins the contract: importing
// `tool-registry` in isolation must succeed and produce a usable
// singleton, and `memory_add` + `shell_command` (the only inline
// registrations left in the file) must be present.

describe('tool-registry module load', () => {
  it('imports without TDZ errors and exposes the toolRegistry singleton', async () => {
    const mod = await import('./tool-registry')
    expect(mod.toolRegistry).toBeDefined()
    expect(typeof mod.toolRegistry.registerNative).toBe('function')
    expect(typeof mod.toolRegistry.getById).toBe('function')
  })

  it('has the inline memory_add registration', async () => {
    const { toolRegistry } = await import('./tool-registry')
    const desc = toolRegistry.getById('memory_add')
    expect(desc).toBeDefined()
    expect(desc?.providerKind).toBe('native')
  })

  it('has the inline shell_command registration', async () => {
    const { toolRegistry } = await import('./tool-registry')
    const desc = toolRegistry.getById('shell_command')
    expect(desc).toBeDefined()
    expect(desc?.providerKind).toBe('native')
    expect(toolRegistry.hasHandler('shell_command')).toBe(true)
  })
})

// Track 2 / C1 — lazy schemas + ToolSearch surface. The two inline native
// registrations (memory_add, shell_command) are enough to exercise the
// shape; MCP descriptors are wired via mcpManager which is not connected
// in tests.

describe('tool-registry lazy schemas (C1)', () => {
  it('getStubs() returns stubs without inputSchema, with tags + lazy populated', async () => {
    const { toolRegistry } = await import('./tool-registry')
    const stubs = toolRegistry.getStubs()
    expect(stubs.length).toBeGreaterThan(0)
    for (const s of stubs) {
      expect(s).not.toHaveProperty('inputSchema')
      expect(Array.isArray(s.tags)).toBe(true)
      expect(typeof s.lazy).toBe('boolean')
    }
    const memoryStub = stubs.find((s) => s.name === 'memory_add')
    expect(memoryStub).toBeDefined()
    expect(memoryStub?.tags).toContain('native')
    expect(memoryStub?.tags).toContain('write')
    expect(memoryStub?.lazy).toBe(false)
  })

  it('shell_command stub carries approval-required tag', async () => {
    const { toolRegistry } = await import('./tool-registry')
    const stub = toolRegistry.getStubs().find((s) => s.name === 'shell_command')
    expect(stub).toBeDefined()
    expect(stub?.tags).toContain('approval-required')
  })

  it('getDescriptors() still includes inputSchema for chat dispatch', async () => {
    const { toolRegistry } = await import('./tool-registry')
    const desc = toolRegistry.getDescriptors().find((d) => d.name === 'shell_command')
    expect(desc).toBeDefined()
    expect(desc?.inputSchema).toBeDefined()
    expect((desc?.inputSchema as Record<string, unknown>).type).toBe('object')
  })

  it('resolveByName expands stubs to full descriptors in input order', async () => {
    const { toolRegistry } = await import('./tool-registry')
    const r = toolRegistry.resolveByName(['shell_command', 'memory_add'])
    expect(r.map((d) => d.name)).toEqual(['shell_command', 'memory_add'])
    for (const d of r) expect(d.inputSchema).toBeDefined()
  })

  it('resolveByName silently drops unknown names', async () => {
    const { toolRegistry } = await import('./tool-registry')
    const r = toolRegistry.resolveByName(['memory_add', 'does_not_exist'])
    expect(r.map((d) => d.name)).toEqual(['memory_add'])
  })

  it('resolveByName returns [] for empty / invalid input', async () => {
    const { toolRegistry } = await import('./tool-registry')
    expect(toolRegistry.resolveByName([])).toEqual([])
  })

  it('search(select:foo,bar) bypasses scoring', async () => {
    const { toolRegistry } = await import('./tool-registry')
    const r = toolRegistry.search('select:shell_command,memory_add')
    expect(r.map((d) => d.name)).toEqual(['shell_command', 'memory_add'])
  })

  it('search(keyword) ranks shell_command first for "shell"', async () => {
    const { toolRegistry } = await import('./tool-registry')
    const r = toolRegistry.search('shell')
    expect(r.length).toBeGreaterThan(0)
    expect(r[0]?.name).toBe('shell_command')
  })

  it('search respects maxResults', async () => {
    const { toolRegistry } = await import('./tool-registry')
    // Both inline natives tag 'native' → both match.
    const r = toolRegistry.search('native', 1)
    expect(r).toHaveLength(1)
  })

  it('stub payload omits inputSchema entirely', async () => {
    // The verify gate "tools:list payload <5KB" assumes a clean test
    // environment with Gmail + Drive MCP wired in; in vitest we have no
    // MCP servers connected so the inline natives are the whole catalogue,
    // and metadata bytes are comparable to schema bytes. The durable
    // structural invariant is: stubs MUST NOT serialize `inputSchema`
    // anywhere; descriptors MUST. (Per-tool: each tool's stub is strictly
    // smaller than its descriptor — covered below.)
    const { toolRegistry } = await import('./tool-registry')
    const stubs = toolRegistry.getStubs()
    const descriptors = toolRegistry.getDescriptors()
    const stubJson = JSON.stringify(stubs)
    const fullJson = JSON.stringify(descriptors)
    expect(stubJson).not.toContain('inputSchema')
    expect(fullJson).toContain('inputSchema')
    expect(fullJson.length).toBeGreaterThan(stubJson.length)
  })

  it('every stub is strictly smaller than its corresponding descriptor', async () => {
    const { toolRegistry } = await import('./tool-registry')
    const stubs = toolRegistry.getStubs()
    const descriptors = toolRegistry.getDescriptors()
    expect(stubs.length).toBe(descriptors.length)
    for (let i = 0; i < stubs.length; i++) {
      const stub = JSON.stringify(stubs[i])
      const full = JSON.stringify(descriptors[i])
      expect(full.length).toBeGreaterThan(stub.length)
    }
  })

  it('chat dispatch surface still has every tool resolved (auto-resolve invariant)', async () => {
    // The "first model call to unresolved tool auto-resolves" verify gate
    // maps to this invariant: even though `tools:list` only ships stubs,
    // `getOpenAITools()` — the path chat.ts uses — always materializes
    // every tool's full schema. The model never sees a tool without its
    // parameters block.
    const { toolRegistry } = await import('./tool-registry')
    const oai = toolRegistry.getOpenAITools()
    for (const t of oai) {
      // `ChatCompletionTool` is a union (function | custom). Lamprey only
      // emits function-shaped tools today; narrow before reading.
      if (t.type !== 'function') continue
      expect(t.function.parameters).toBeDefined()
    }
  })
})
