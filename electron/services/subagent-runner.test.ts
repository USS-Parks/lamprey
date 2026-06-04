import { describe, expect, it, vi } from 'vitest'
import { join } from 'path'

vi.mock('electron', () => ({
  app: { getPath: () => join(process.cwd(), '.tmp-test-user-data') },
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: true }
}))

import {
  __resetLiveHandlesForTests,
  getLiveHandle,
  forkAgent,
  resolveAllowedTools,
  validateAgainstSchema,
  buildForkAgentMessages,
  SubagentSchemaError,
  SubagentTypeNotFoundError,
  SubagentAbortError,
  SubagentContextTooLargeError,
  SUBAGENT_MAX_CONTEXT_BYTES,
  SUBAGENT_SCHEMA_TOOL_NAME,
  type AgentRunNotifyEvent,
  type AgentRunStoreLike,
  type ForkAgentDeps,
  type ForkAgentRunner,
  type SubagentTypeResolver
} from './subagent-runner'
import { beforeEach } from 'vitest'

beforeEach(() => __resetLiveHandlesForTests())
import { BUILT_IN_SUBAGENT_TYPES, type SubagentTypeDef } from './subagent-types'
import type { WorktreeManager, FinalizeResult, WorktreeContext } from './worktree-runner'

// -- Helpers --------------------------------------------------------------

function makeDeps(overrides: Partial<ForkAgentDeps> & { runner: ForkAgentRunner }): ForkAgentDeps {
  return {
    defaultModel: 'test-model',
    ...overrides
  }
}

function builtinResolver(): SubagentTypeResolver {
  return (name) =>
    Object.prototype.hasOwnProperty.call(BUILT_IN_SUBAGENT_TYPES, name)
      ? BUILT_IN_SUBAGENT_TYPES[name]
      : null
}

// -- resolveAllowedTools --------------------------------------------------

describe('resolveAllowedTools', () => {
  it('returns the intersection of all named layers', () => {
    expect(resolveAllowedTools(['a', 'b', 'c'], ['a', 'b'], ['b', 'c'])).toEqual(['b'])
  })

  it("treats '*' on the type layer as 'no narrowing'", () => {
    expect(resolveAllowedTools(['a', 'b', 'c'], '*', ['a', 'b'])).toEqual(['a', 'b'])
  })

  it("treats '*' on the override layer as 'no narrowing'", () => {
    expect(resolveAllowedTools(['a', 'b', 'c'], ['a', 'b'], '*')).toEqual(['a', 'b'])
  })

  it("returns the parent's full list when every layer is '*'", () => {
    expect(resolveAllowedTools(['a', 'b'], '*', '*')).toEqual(['a', 'b'])
  })

  it('returns [] when intersection is empty', () => {
    expect(resolveAllowedTools(['a'], ['b'], undefined)).toEqual([])
  })

  it('returns sorted output deterministically', () => {
    expect(resolveAllowedTools(null, ['z', 'a', 'm'], undefined)).toEqual(['a', 'm', 'z'])
  })

  it('returns [] when parent is null and every layer is wildcard', () => {
    expect(resolveAllowedTools(null, '*', '*')).toEqual([])
  })
})

// -- buildForkAgentMessages ----------------------------------------------

describe('buildForkAgentMessages', () => {
  it('places the type system prompt in the system message and the user prompt in the user message', () => {
    const msgs = buildForkAgentMessages(BUILT_IN_SUBAGENT_TYPES.Explore, {
      prompt: 'find foo',
      agentType: 'Explore'
    })
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('system')
    expect(String(msgs[0].content)).toMatch(/Explore agent/i)
    expect(msgs[1].role).toBe('user')
    expect(String(msgs[1].content)).toBe('find foo')
  })

  it('injects context + outputFormat when provided', () => {
    const msgs = buildForkAgentMessages(BUILT_IN_SUBAGENT_TYPES.Explore, {
      prompt: 'go',
      agentType: 'Explore',
      context: 'CTX',
      outputFormat: 'FMT'
    })
    const user = String(msgs[1].content)
    expect(user).toMatch(/<context>\nCTX\n<\/context>/)
    expect(user).toMatch(/<output_format>\nFMT\n<\/output_format>/)
  })

  it('appends a schema instruction to the system prompt when schema is set', () => {
    const msgs = buildForkAgentMessages(BUILT_IN_SUBAGENT_TYPES.Explore, {
      prompt: 'go',
      agentType: 'Explore',
      schema: { type: 'object', properties: { found: { type: 'array' } }, required: ['found'] }
    })
    const sys = String(msgs[0].content)
    expect(sys).toMatch(/JSON object/)
    expect(sys).toMatch(SUBAGENT_SCHEMA_TOOL_NAME)
    expect(sys).toMatch(/<schema>/)
    expect(sys).toMatch(/"required":/)
  })
})

// -- validateAgainstSchema -----------------------------------------------

describe('validateAgainstSchema', () => {
  it('accepts an object with required keys present', () => {
    expect(() =>
      validateAgainstSchema(
        { found: ['x'] },
        { type: 'object', properties: { found: { type: 'array' } }, required: ['found'] }
      )
    ).not.toThrow()
  })

  it('throws when a required key is missing', () => {
    expect(() =>
      validateAgainstSchema(
        {},
        { type: 'object', properties: { found: { type: 'array' } }, required: ['found'] }
      )
    ).toThrow(SubagentSchemaError)
  })

  it('throws when the declared type is array but the value is not', () => {
    expect(() => validateAgainstSchema({ x: 1 }, { type: 'array' })).toThrow(SubagentSchemaError)
  })

  it('checks declared property types when present', () => {
    expect(() =>
      validateAgainstSchema(
        { count: 'not-a-number' },
        { type: 'object', properties: { count: { type: 'number' } } }
      )
    ).toThrow(/should be number/)
  })

  it('treats integer as a number with Number.isInteger', () => {
    expect(() =>
      validateAgainstSchema({ n: 3 }, { type: 'object', properties: { n: { type: 'integer' } } })
    ).not.toThrow()
    expect(() =>
      validateAgainstSchema({ n: 3.5 }, { type: 'object', properties: { n: { type: 'integer' } } })
    ).toThrow(/integer/)
  })
})

// -- forkAgent — happy paths ---------------------------------------------

describe('forkAgent — happy paths', () => {
  it('forks Explore with a tool subset and returns a raw string result', async () => {
    let seenInput: { allowedTools: unknown; modelId: string } | null = null
    const runner: ForkAgentRunner = async (input) => {
      seenInput = { allowedTools: input.allowedTools, modelId: input.modelId }
      return 'foo lives at src/foo.ts:12'
    }
    const handle = forkAgent(
      { prompt: 'where is foo?', agentType: 'Explore' },
      makeDeps({ runner, loadType: builtinResolver() })
    )
    const result = await handle.promise
    expect(result.runId).toBeTruthy()
    expect(typeof result.output).toBe('string')
    expect(result.output).toBe('foo lives at src/foo.ts:12')
    expect(result.rawOutput).toBe('foo lives at src/foo.ts:12')
    expect(seenInput).not.toBeNull()
    expect(seenInput!.modelId).toBe('test-model')
    // Explore's allowedTools sorted alphabetically.
    expect(seenInput!.allowedTools).toEqual(
      [...BUILT_IN_SUBAGENT_TYPES.Explore.allowedTools as string[]].sort()
    )
  })

  it('forks with a schema and returns a parsed, validated object', async () => {
    const runner: ForkAgentRunner = async () =>
      JSON.stringify({ found: ['a.ts', 'b.ts'], count: 2 })
    const handle = forkAgent(
      {
        prompt: 'find foo files',
        agentType: 'Explore',
        schema: {
          type: 'object',
          properties: { found: { type: 'array' }, count: { type: 'integer' } },
          required: ['found']
        }
      },
      makeDeps({ runner, loadType: builtinResolver() })
    )
    const result = await handle.promise
    expect(result.output).toEqual({ found: ['a.ts', 'b.ts'], count: 2 })
    // rawOutput preserves the original string for journaling/resume use.
    expect(result.rawOutput).toContain('"found"')
  })

  it("doesn't expose the parent's added tool to the child if the type doesn't allow it", async () => {
    let observedAllowed: string[] | '*' = '*'
    const runner: ForkAgentRunner = async (input) => {
      observedAllowed = input.allowedTools
      return 'ok'
    }
    // Parent has a tool that's NOT in Explore's allowedTools — should not leak.
    const parentTools = ['read_file', 'grep_search', 'glob_search', 'shell_command', 'apply_patch']
    const handle = forkAgent(
      { prompt: 'go', agentType: 'Explore' },
      makeDeps({
        runner,
        loadType: builtinResolver(),
        parentTools: { listTools: () => parentTools }
      })
    )
    await handle.promise
    expect(observedAllowed).not.toContain('apply_patch')
    expect(observedAllowed).toContain('read_file')
    expect(observedAllowed).toContain('grep_search')
  })

  it('honours a user-registered subagent type by name', async () => {
    let observedSystem = ''
    let observedAllowed: string[] | '*' = '*'
    const custom: SubagentTypeDef = {
      name: 'security-auditor',
      description: 'Adversarial security auditor',
      allowedTools: ['read_file', 'grep_search'],
      systemPrompt: 'You are the Security Auditor. Flag injection bugs.',
      source: '/tmp/security-auditor.md'
    }
    const loadType: SubagentTypeResolver = (name) =>
      name === custom.name ? custom : builtinResolver()(name)
    const runner: ForkAgentRunner = async (input) => {
      observedSystem = String(input.messages[0]?.content ?? '')
      observedAllowed = input.allowedTools
      return 'audited; SHIP'
    }
    const handle = forkAgent(
      { prompt: 'audit src/auth.ts', agentType: 'security-auditor' },
      makeDeps({ runner, loadType })
    )
    const result = await handle.promise
    expect(result.output).toBe('audited; SHIP')
    expect(observedSystem).toContain('Security Auditor')
    expect(observedAllowed).toEqual(['grep_search', 'read_file'])
  })
})

// -- forkAgent — error paths ---------------------------------------------

describe('forkAgent — error paths', () => {
  it('throws SubagentTypeNotFoundError for an unknown agent type', async () => {
    const handle = forkAgent(
      { prompt: 'x', agentType: 'no-such-type' },
      makeDeps({ runner: async () => 'never', loadType: () => null })
    )
    await expect(handle.promise).rejects.toBeInstanceOf(SubagentTypeNotFoundError)
  })

  it('throws SubagentContextTooLargeError when context overflows', async () => {
    const handle = forkAgent(
      {
        prompt: 'x',
        agentType: 'Explore',
        context: 'a'.repeat(SUBAGENT_MAX_CONTEXT_BYTES + 1)
      },
      makeDeps({ runner: async () => 'never', loadType: builtinResolver() })
    )
    await expect(handle.promise).rejects.toBeInstanceOf(SubagentContextTooLargeError)
  })

  it('throws SubagentSchemaError when the response is unparseable JSON', async () => {
    const handle = forkAgent(
      {
        prompt: 'go',
        agentType: 'Explore',
        schema: { type: 'object', required: ['x'] }
      },
      makeDeps({
        runner: async () => 'not-json-at-all',
        loadType: builtinResolver()
      })
    )
    await expect(handle.promise).rejects.toBeInstanceOf(SubagentSchemaError)
  })

  it('throws SubagentSchemaError when the parsed object misses a required key', async () => {
    const handle = forkAgent(
      {
        prompt: 'go',
        agentType: 'Explore',
        schema: { type: 'object', required: ['found'] }
      },
      makeDeps({
        runner: async () => JSON.stringify({ other: 1 }),
        loadType: builtinResolver()
      })
    )
    await expect(handle.promise).rejects.toThrow(/found/)
  })

  it('aborts when the parent signal fires', async () => {
    const controller = new AbortController()
    const runner: ForkAgentRunner = (input) =>
      new Promise<string>((_resolve, reject) => {
        input.signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    const handle = forkAgent(
      { prompt: 'x', agentType: 'Explore', signal: controller.signal },
      makeDeps({ runner, loadType: builtinResolver() })
    )
    setTimeout(() => controller.abort(), 10)
    await expect(handle.promise).rejects.toBeInstanceOf(SubagentAbortError)
  })

  it('aborts on timeout', async () => {
    const runner: ForkAgentRunner = (input) =>
      new Promise<string>((_resolve, reject) => {
        input.signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    const handle = forkAgent(
      { prompt: 'x', agentType: 'Explore', timeoutMs: 20 },
      makeDeps({ runner, loadType: builtinResolver() })
    )
    await expect(handle.promise).rejects.toMatchObject({ message: /timed out after 20 ms/ })
  })

  it('handle.abort() rejects an in-flight fork with SubagentAbortError', async () => {
    const runner: ForkAgentRunner = (input) =>
      new Promise<string>((_resolve, reject) => {
        input.signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    const handle = forkAgent(
      { prompt: 'x', agentType: 'Explore' },
      makeDeps({ runner, loadType: builtinResolver() })
    )
    setTimeout(() => handle.abort('user-cancelled'), 10)
    await expect(handle.promise).rejects.toBeInstanceOf(SubagentAbortError)
  })
})

// -- forkAgent — A2: background lifecycle + store + notify ---------------

function makeMemStore(): { store: AgentRunStoreLike; inserts: unknown[]; finishes: unknown[] } {
  const inserts: unknown[] = []
  const finishes: unknown[] = []
  const store: AgentRunStoreLike = {
    insertRun: (args) => {
      inserts.push(args)
    },
    finishRun: (args) => {
      finishes.push(args)
    }
  }
  return { store, inserts, finishes }
}

describe('forkAgent — A2 background lifecycle (store + notify + live-handle)', () => {
  it('returns the handle synchronously — a background fork does not await', () => {
    let resolved = false
    const runner: ForkAgentRunner = () =>
      new Promise<string>((resolve) => {
        setTimeout(() => {
          resolved = true
          resolve('eventually')
        }, 50)
      })
    const handle = forkAgent(
      { prompt: 'x', agentType: 'Explore', runInBackground: true },
      makeDeps({ runner, loadType: builtinResolver() })
    )
    // Synchronously after fork, runner is in-flight — not resolved yet.
    expect(resolved).toBe(false)
    expect(typeof handle.runId).toBe('string')
    expect(typeof handle.abort).toBe('function')
    expect(handle.promise).toBeInstanceOf(Promise)
  })

  it('inserts a "running" row + fires notify("running") before runner resolves', async () => {
    const { store, inserts } = makeMemStore()
    const notify = vi.fn<(event: AgentRunNotifyEvent) => void>()
    let observedRunningCount = -1
    const runner: ForkAgentRunner = () =>
      new Promise<string>((resolve) => {
        // Inspect what's been notified BEFORE we resolve — the running event
        // must already have fired.
        observedRunningCount = notify.mock.calls.length
        setTimeout(() => resolve('ok'), 5)
      })
    const handle = forkAgent(
      {
        prompt: 'x',
        agentType: 'Explore',
        label: 'find foo',
        parentConvId: 'conv-1',
        runInBackground: true
      },
      makeDeps({ runner, loadType: builtinResolver(), agentRunStore: store, notify })
    )
    await handle.promise
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({
      id: handle.runId,
      agentType: 'Explore',
      label: 'find foo',
      parentConvId: 'conv-1',
      background: true
    })
    expect(observedRunningCount).toBe(1) // the running notify fired before runner started its body
    expect(notify.mock.calls[0][0]).toMatchObject({
      runId: handle.runId,
      status: 'running',
      label: 'find foo',
      background: true
    })
  })

  it('fires notify("done") + finishRun on successful completion with resultText', async () => {
    const { store, finishes } = makeMemStore()
    const notify = vi.fn<(event: AgentRunNotifyEvent) => void>()
    const runner: ForkAgentRunner = async () => 'foo lives at src/foo.ts:12'
    const handle = forkAgent(
      { prompt: 'x', agentType: 'Explore', parentConvId: 'conv-1' },
      makeDeps({ runner, loadType: builtinResolver(), agentRunStore: store, notify })
    )
    await handle.promise
    expect(finishes).toHaveLength(1)
    expect(finishes[0]).toMatchObject({
      id: handle.runId,
      status: 'done',
      resultText: 'foo lives at src/foo.ts:12'
    })
    const lastNotify = notify.mock.calls.at(-1)![0]
    expect(lastNotify.status).toBe('done')
    expect(lastNotify.resultText).toBe('foo lives at src/foo.ts:12')
  })

  it('fires notify("error") + finishRun with an error message when the runner throws', async () => {
    const { store, finishes } = makeMemStore()
    const notify = vi.fn<(event: AgentRunNotifyEvent) => void>()
    const runner: ForkAgentRunner = async () => {
      throw new Error('boom')
    }
    const handle = forkAgent(
      { prompt: 'x', agentType: 'Explore' },
      makeDeps({ runner, loadType: builtinResolver(), agentRunStore: store, notify })
    )
    await expect(handle.promise).rejects.toThrow('boom')
    expect(finishes[0]).toMatchObject({ id: handle.runId, status: 'error', error: 'boom' })
    expect(notify.mock.calls.at(-1)![0].status).toBe('error')
  })

  it('fires notify("aborted") on a user-initiated handle.abort() — tasks:stop semantics', async () => {
    const { store, finishes } = makeMemStore()
    const notify = vi.fn<(event: AgentRunNotifyEvent) => void>()
    const runner: ForkAgentRunner = (input) =>
      new Promise<string>((_resolve, reject) => {
        input.signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    const handle = forkAgent(
      { prompt: 'x', agentType: 'Explore' },
      makeDeps({ runner, loadType: builtinResolver(), agentRunStore: store, notify })
    )
    setTimeout(() => handle.abort('user-stop'), 5)
    await expect(handle.promise).rejects.toBeInstanceOf(SubagentAbortError)
    expect(finishes[0]).toMatchObject({ id: handle.runId, status: 'aborted' })
    expect(notify.mock.calls.at(-1)![0].status).toBe('aborted')
  })

  it('registers the handle in the live registry while in-flight; removes on settle', async () => {
    const runner: ForkAgentRunner = () =>
      new Promise<string>((resolve) => setTimeout(() => resolve('ok'), 10))
    const handle = forkAgent(
      { prompt: 'x', agentType: 'Explore' },
      makeDeps({ runner, loadType: builtinResolver() })
    )
    // Live while running.
    expect(getLiveHandle(handle.runId)).toBe(handle)
    await handle.promise
    // Cleanup runs in a microtask after settle — yield once more to be safe.
    await Promise.resolve()
    expect(getLiveHandle(handle.runId)).toBeUndefined()
  })

  it('store/notify exceptions never break the run (graceful degradation)', async () => {
    const throwingStore: AgentRunStoreLike = {
      insertRun: () => {
        throw new Error('db down')
      },
      finishRun: () => {
        throw new Error('db down')
      }
    }
    const throwingNotify = vi.fn<(event: AgentRunNotifyEvent) => void>().mockImplementation(() => {
      throw new Error('renderer disconnected')
    })
    const runner: ForkAgentRunner = async () => 'ok'
    // Silence console.error noise from the graceful catches.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const handle = forkAgent(
        { prompt: 'x', agentType: 'Explore' },
        makeDeps({ runner, loadType: builtinResolver(), agentRunStore: throwingStore, notify: throwingNotify })
      )
      const result = await handle.promise
      expect(result.output).toBe('ok')
    } finally {
      errSpy.mockRestore()
    }
  })

  it('skips store + notify entirely when neither is provided', async () => {
    // A1-style call shouldn't pay any cost or have any side effect for A2.
    const runner: ForkAgentRunner = async () => 'ok'
    const handle = forkAgent(
      { prompt: 'x', agentType: 'Explore' },
      makeDeps({ runner, loadType: builtinResolver() })
    )
    const result = await handle.promise
    expect(result.output).toBe('ok')
    // No assertions beyond "didn't throw" — the absence of fixtures is the test.
  })
})

// -- forkAgent — A3: worktree isolation ----------------------------------

function makeStubWorktreeManager(
  finalize: (ctx: WorktreeContext) => FinalizeResult = (ctx) => ({
    keep: false,
    hasChanges: false,
    path: ctx.path,
    branch: ctx.branch,
    removed: true
  })
): { manager: WorktreeManager; createCalls: string[]; finalizeCalls: WorktreeContext[] } {
  const createCalls: string[] = []
  const finalizeCalls: WorktreeContext[] = []
  const manager: WorktreeManager = {
    create: async (runId) => {
      createCalls.push(runId)
      return { path: `/wt/${runId}`, branch: `lamprey-agent/${runId}` }
    },
    finalize: async (ctx) => {
      finalizeCalls.push(ctx)
      return finalize(ctx)
    }
  }
  return { manager, createCalls, finalizeCalls }
}

describe('forkAgent — A3 worktree isolation', () => {
  it('passes worktreePath into the runner when isolation is set', async () => {
    let seenWtPath: string | undefined
    const runner: ForkAgentRunner = async (input) => {
      seenWtPath = input.worktreePath
      return 'ok'
    }
    const { manager, createCalls } = makeStubWorktreeManager()
    const handle = forkAgent(
      { prompt: 'x', agentType: 'Explore', isolation: 'worktree' },
      makeDeps({ runner, loadType: builtinResolver(), worktreeManager: manager })
    )
    await handle.promise
    expect(createCalls).toEqual([handle.runId])
    expect(seenWtPath).toBe(`/wt/${handle.runId}`)
  })

  it('calls finalize after the runner resolves', async () => {
    const runner: ForkAgentRunner = async () => 'ok'
    const { manager, finalizeCalls } = makeStubWorktreeManager()
    const handle = forkAgent(
      { prompt: 'x', agentType: 'Explore', isolation: 'worktree' },
      makeDeps({ runner, loadType: builtinResolver(), worktreeManager: manager })
    )
    await handle.promise
    expect(finalizeCalls).toHaveLength(1)
    expect(finalizeCalls[0]).toEqual({
      path: `/wt/${handle.runId}`,
      branch: `lamprey-agent/${handle.runId}`
    })
  })

  it('"no-op agent" (finalize.keep=false) → finishRun gets no worktreePath', async () => {
    const { store, finishes } = makeMemStore()
    const runner: ForkAgentRunner = async () => 'ok'
    const { manager } = makeStubWorktreeManager()
    const handle = forkAgent(
      { prompt: 'x', agentType: 'Explore', isolation: 'worktree' },
      makeDeps({
        runner,
        loadType: builtinResolver(),
        worktreeManager: manager,
        agentRunStore: store
      })
    )
    await handle.promise
    expect(finishes).toHaveLength(1)
    expect((finishes[0] as { worktreePath: string | null }).worktreePath).toBeNull()
  })

  it('"file-touching agent" (finalize.keep=true) → finishRun records the path', async () => {
    const { store, finishes } = makeMemStore()
    const runner: ForkAgentRunner = async () => 'wrote src/foo.ts'
    const { manager } = makeStubWorktreeManager((ctx) => ({
      keep: true,
      hasChanges: true,
      path: ctx.path,
      branch: ctx.branch,
      removed: false
    }))
    const handle = forkAgent(
      { prompt: 'x', agentType: 'general', isolation: 'worktree' },
      makeDeps({
        runner,
        loadType: builtinResolver(),
        worktreeManager: manager,
        agentRunStore: store
      })
    )
    await handle.promise
    expect((finishes[0] as { worktreePath: string }).worktreePath).toBe(`/wt/${handle.runId}`)
  })

  it('three parallel forks with isolation produce three disjoint worktree paths', async () => {
    const runner: ForkAgentRunner = async () => 'ok'
    const { manager, createCalls } = makeStubWorktreeManager()
    const handles = [
      forkAgent({ prompt: '1', agentType: 'Explore', isolation: 'worktree' }, makeDeps({ runner, loadType: builtinResolver(), worktreeManager: manager })),
      forkAgent({ prompt: '2', agentType: 'Explore', isolation: 'worktree' }, makeDeps({ runner, loadType: builtinResolver(), worktreeManager: manager })),
      forkAgent({ prompt: '3', agentType: 'Explore', isolation: 'worktree' }, makeDeps({ runner, loadType: builtinResolver(), worktreeManager: manager }))
    ]
    await Promise.all(handles.map((h) => h.promise))
    expect(new Set(createCalls).size).toBe(3)
    // RunIds are unique → paths are unique.
    const handleIds = handles.map((h) => h.runId)
    expect(new Set(handleIds).size).toBe(3)
  })

  it('finalize runs after runner failure too (and preserves changes if any)', async () => {
    const { store, finishes } = makeMemStore()
    const runner: ForkAgentRunner = async () => {
      throw new Error('boom')
    }
    const { manager, finalizeCalls } = makeStubWorktreeManager((ctx) => ({
      keep: true,
      hasChanges: true,
      path: ctx.path,
      branch: ctx.branch,
      removed: false
    }))
    const handle = forkAgent(
      { prompt: 'x', agentType: 'Explore', isolation: 'worktree' },
      makeDeps({
        runner,
        loadType: builtinResolver(),
        worktreeManager: manager,
        agentRunStore: store
      })
    )
    await expect(handle.promise).rejects.toThrow('boom')
    expect(finalizeCalls).toHaveLength(1)
    expect((finishes[0] as { status: string; worktreePath: string }).status).toBe('error')
    // Worktree had changes — preserve and stamp.
    expect((finishes[0] as { worktreePath: string }).worktreePath).toBe(`/wt/${handle.runId}`)
  })

  it('rejects with config error when isolation is set but no worktreeManager is injected', async () => {
    const { store, finishes } = makeMemStore()
    const runner: ForkAgentRunner = async () => 'never'
    const handle = forkAgent(
      { prompt: 'x', agentType: 'Explore', isolation: 'worktree' },
      makeDeps({ runner, loadType: builtinResolver(), agentRunStore: store })
    )
    await expect(handle.promise).rejects.toThrow(/worktreeManager/)
    // Error path still writes to the store.
    expect((finishes[0] as { status: string }).status).toBe('error')
  })

  it('skips worktree wiring entirely when isolation is not set', async () => {
    const runner: ForkAgentRunner = async (input) => {
      // worktreePath should be undefined for plain forks.
      expect(input.worktreePath).toBeUndefined()
      return 'ok'
    }
    const { manager, createCalls, finalizeCalls } = makeStubWorktreeManager()
    const handle = forkAgent(
      { prompt: 'x', agentType: 'Explore' /* no isolation */ },
      makeDeps({ runner, loadType: builtinResolver(), worktreeManager: manager })
    )
    await handle.promise
    expect(createCalls).toEqual([])
    expect(finalizeCalls).toEqual([])
  })
})

// -- forkAgent — B5 schema-retry hardening -------------------------------

describe('forkAgent — B5 schema retry loop', () => {
  it('succeeds on the first attempt when the runner returns valid JSON', async () => {
    let attempts = 0
    const runner: ForkAgentRunner = async () => {
      attempts++
      return JSON.stringify({ found: ['a.ts'] })
    }
    const handle = forkAgent(
      {
        prompt: 'x',
        agentType: 'Explore',
        schema: { type: 'object', required: ['found'] }
      },
      makeDeps({ runner, loadType: builtinResolver() })
    )
    const result = await handle.promise
    expect(attempts).toBe(1)
    expect(result.output).toEqual({ found: ['a.ts'] })
  })

  it('retries up to 3 times when JSON is malformed, appending the validation error each turn (REQUIRED bullet)', async () => {
    const captured: number[] = []
    const runner: ForkAgentRunner = async (input) => {
      captured.push(input.messages.length)
      return 'not-json-at-all'
    }
    const handle = forkAgent(
      {
        prompt: 'x',
        agentType: 'Explore',
        schema: { type: 'object', required: ['x'] }
      },
      makeDeps({ runner, loadType: builtinResolver() })
    )
    await expect(handle.promise).rejects.toBeInstanceOf(SubagentSchemaError)
    // Three attempts total.
    expect(captured).toHaveLength(3)
    // First attempt has the base 2 messages (system + user); each retry adds
    // an assistant + user pair so attempt 2 has 4 messages, attempt 3 has 6.
    expect(captured).toEqual([2, 4, 6])
  })

  it('the retry user message includes the validation error verbatim', async () => {
    let secondAttemptInput: { role: string; content: string }[] | null = null
    let calls = 0
    const runner: ForkAgentRunner = async (input) => {
      calls++
      if (calls === 2) {
        secondAttemptInput = input.messages as Array<{ role: string; content: string }>
      }
      // First attempt → malformed; second attempt → valid.
      if (calls === 1) return 'not-json'
      return JSON.stringify({ x: 1 })
    }
    await forkAgent(
      {
        prompt: 'x',
        agentType: 'Explore',
        schema: { type: 'object', required: ['x'] }
      },
      makeDeps({ runner, loadType: builtinResolver() })
    ).promise
    expect(secondAttemptInput).not.toBeNull()
    const lastMsg = secondAttemptInput!.at(-1)!
    expect(lastMsg.role).toBe('user')
    expect(lastMsg.content).toMatch(/previous response failed schema validation/i)
  })

  it('succeeds on the 2nd attempt when the first is malformed and the second is valid', async () => {
    let calls = 0
    const runner: ForkAgentRunner = async () => {
      calls++
      if (calls === 1) return 'not-json'
      return JSON.stringify({ x: 1 })
    }
    const result = await forkAgent(
      {
        prompt: 'x',
        agentType: 'Explore',
        schema: { type: 'object', required: ['x'] }
      },
      makeDeps({ runner, loadType: builtinResolver() })
    ).promise
    expect(calls).toBe(2)
    expect(result.output).toEqual({ x: 1 })
  })

  it('schema-validation failure (wrong shape, not parse error) also triggers retries', async () => {
    let calls = 0
    const runner: ForkAgentRunner = async () => {
      calls++
      // Returns valid JSON but missing the required key.
      if (calls < 3) return JSON.stringify({ other: 1 })
      return JSON.stringify({ found: ['ok'] })
    }
    const result = await forkAgent(
      {
        prompt: 'x',
        agentType: 'Explore',
        schema: { type: 'object', required: ['found'] }
      },
      makeDeps({ runner, loadType: builtinResolver() })
    ).promise
    expect(calls).toBe(3)
    expect(result.output).toEqual({ found: ['ok'] })
  })
})
