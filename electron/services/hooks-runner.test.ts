import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Track 2 / C2 — hooks-runner tests. Exercises:
//   - testHook (no DB, no Electron app) for the JS sandbox path
//   - sandbox bindings (event, toolName, args clone, log capture)
//   - preToolUse blocking semantics
//   - timeout enforcement
//   - args mutation isolation (deep clone)
//   - log() argument formatting
//
// `fireHooks` reaches the DB via `listHooksForEvent`, which requires
// Electron's `app.getPath('userData')`. We mock `hooks-store` so the
// runner sees a deterministic list without booting better-sqlite3 or
// Electron.

const mockList: Array<{
  id: string
  label: string
  event: string
  command: string
  language: 'js' | 'shell'
  timeoutMs: number
  enabled: boolean
  createdAt: number
}> = []

vi.mock('./hooks-store', async () => {
  const actual = await vi.importActual<typeof import('./hooks-store')>('./hooks-store')
  return {
    ...actual,
    listHooksForEvent: (event: string) =>
      mockList.filter((h) => h.event === event && h.enabled)
  }
})

beforeEach(() => {
  mockList.length = 0
})

afterEach(() => {
  mockList.length = 0
})

describe('hooks-runner / testHook (pure JS sandbox)', () => {
  it('runs the body and captures log() output', async () => {
    const { testHook } = await import('./hooks-runner')
    const r = testHook({
      code: 'log("hello", 42)',
      event: 'sessionStart',
      context: { cwd: 'C:\\workspace' }
    })
    expect(r.thrown).toBeUndefined()
    expect(r.logs).toHaveLength(1)
    expect(r.logs[0].message).toBe('hello 42')
    expect(r.logs[0].kind).toBe('log')
  })

  it('exposes event + context bindings', async () => {
    const { testHook } = await import('./hooks-runner')
    const r = testHook({
      code: 'log(event, toolName, args.command, conversationId)',
      event: 'preToolUse',
      context: {
        conversationId: 'c1',
        toolName: 'shell_command',
        args: { command: 'ls -la' }
      }
    })
    expect(r.logs[0].message).toBe('preToolUse shell_command ls -la c1')
  })

  it('throw surfaces as the thrown message — preToolUse semantic', async () => {
    const { testHook } = await import('./hooks-runner')
    const r = testHook({
      code: 'throw "no rm -rf allowed"',
      event: 'preToolUse',
      context: { toolName: 'shell_command', args: { command: 'rm -rf' } }
    })
    expect(r.thrown).toBe('no rm -rf allowed')
  })

  it('args mutations inside the sandbox do not escape to the caller', async () => {
    const { testHook } = await import('./hooks-runner')
    const original = { command: 'ls', counter: 0 }
    testHook({
      code: 'args.command = "DELETED"; args.counter++',
      event: 'preToolUse',
      context: { toolName: 'shell_command', args: original }
    })
    expect(original.command).toBe('ls')
    expect(original.counter).toBe(0)
  })

  it('respects the timeout', async () => {
    const { testHook } = await import('./hooks-runner')
    const r = testHook({
      code: 'while (true) {}',
      event: 'preToolUse',
      context: {},
      timeoutMs: 100
    })
    expect(r.thrown).toBeDefined()
    expect(r.thrown!.toLowerCase()).toContain('time')
  })

  it('object args serialize via JSON.stringify in log()', async () => {
    const { testHook } = await import('./hooks-runner')
    const r = testHook({
      code: 'log({a: 1, b: [2, 3]})',
      event: 'sessionStart',
      context: {}
    })
    expect(r.logs[0].message).toBe('{"a":1,"b":[2,3]}')
  })

  it('console.error increments the error log kind', async () => {
    const { testHook } = await import('./hooks-runner')
    const r = testHook({
      code: 'console.error("oops")',
      event: 'sessionStart',
      context: {}
    })
    expect(r.logs[0].kind).toBe('error')
    expect(r.logs[0].message).toBe('oops')
  })

  it('Date/JSON/Math stdlib bindings work; require is undefined', async () => {
    const { testHook } = await import('./hooks-runner')
    const r = testHook({
      code:
        'log(Math.max(2,5), JSON.stringify({k:1}), typeof Date, typeof require)',
      event: 'sessionStart',
      context: {}
    })
    expect(r.logs[0].message).toBe('5 {"k":1} function undefined')
  })
})

describe('hooks-runner / fireHooks (uses mocked listHooksForEvent)', () => {
  it('returns blocked when a preToolUse hook throws', async () => {
    const { fireHooks } = await import('./hooks-runner')
    mockList.push({
      id: 'h1',
      label: 'block-rm',
      event: 'preToolUse',
      command: 'if (toolName === "shell_command") throw "blocked"',
      language: 'js',
      timeoutMs: 5000,
      enabled: true,
      createdAt: 0
    })
    const r = await fireHooks('preToolUse', {
      toolName: 'shell_command',
      args: { command: 'ls' }
    })
    expect(r.blocked).toBe(true)
    expect(r.blockReason).toBe('blocked')
    // The blockReason should also appear in logs as an error entry.
    expect(r.logs.some((l) => l.kind === 'error' && l.message === 'blocked')).toBe(true)
  })

  it('lets a passing preToolUse hook through', async () => {
    const { fireHooks } = await import('./hooks-runner')
    mockList.push({
      id: 'h2',
      label: 'log-only',
      event: 'preToolUse',
      command: 'log("called", toolName)',
      language: 'js',
      timeoutMs: 5000,
      enabled: true,
      createdAt: 0
    })
    const r = await fireHooks('preToolUse', { toolName: 'memory_add', args: {} })
    expect(r.blocked).toBe(false)
    expect(r.logs.map((l) => l.message)).toContain('called memory_add')
  })

  it('postToolUse never blocks even when the hook throws', async () => {
    const { fireHooks } = await import('./hooks-runner')
    mockList.push({
      id: 'h3',
      label: 'noisy',
      event: 'postToolUse',
      command: 'throw "ignored"',
      language: 'js',
      timeoutMs: 5000,
      enabled: true,
      createdAt: 0
    })
    const r = await fireHooks('postToolUse', {
      toolName: 'shell_command',
      args: {},
      result: 'ok'
    })
    expect(r.blocked).toBe(false)
    expect(r.logs.some((l) => l.kind === 'error' && l.message === 'ignored')).toBe(true)
  })

  it('disabled hooks are skipped at the list layer', async () => {
    const { fireHooks } = await import('./hooks-runner')
    mockList.push({
      id: 'h4',
      label: 'off',
      event: 'preToolUse',
      command: 'throw "should not run"',
      language: 'js',
      timeoutMs: 5000,
      enabled: false,
      createdAt: 0
    })
    const r = await fireHooks('preToolUse', { toolName: 'x', args: {} })
    expect(r.blocked).toBe(false)
    expect(r.logs).toHaveLength(0)
  })

  it('multiple preToolUse hooks: first throw blocks, later hooks still log', async () => {
    const { fireHooks } = await import('./hooks-runner')
    mockList.push(
      {
        id: 'h5a',
        label: 'first-block',
        event: 'preToolUse',
        command: 'throw "first"',
        language: 'js',
        timeoutMs: 5000,
        enabled: true,
        createdAt: 0
      },
      {
        id: 'h5b',
        label: 'second-log',
        event: 'preToolUse',
        command: 'log("still ran")',
        language: 'js',
        timeoutMs: 5000,
        enabled: true,
        createdAt: 1
      }
    )
    const r = await fireHooks('preToolUse', { toolName: 'x' })
    expect(r.blocked).toBe(true)
    expect(r.blockReason).toBe('first')
    expect(r.logs.some((l) => l.message === 'still ran')).toBe(true)
  })

  it('no hooks for event → unblocked, no logs', async () => {
    const { fireHooks } = await import('./hooks-runner')
    const r = await fireHooks('preToolUse', { toolName: 'x' })
    expect(r.blocked).toBe(false)
    expect(r.logs).toHaveLength(0)
  })
})
