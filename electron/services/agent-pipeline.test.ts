import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// agent-pipeline imports conversation-store (which imports better-sqlite3
// via database.ts) and chat-events (which imports electron). Mock both so
// the tests run in pure node without booting Electron or a DB. We capture
// every saveMessage call to assert the Reviewer-message persistence path.

const recorded = vi.hoisted(() => ({
  savedMessages: [] as Array<{ role: string; content: string; model?: string }>
}))

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd() },
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: true }
}))

vi.mock('./conversation-store', () => ({
  saveMessage: (msg: { role: string; content: string; model?: string; id: string; conversationId: string }) => {
    recorded.savedMessages.push({ role: msg.role, content: msg.content, model: msg.model })
    return {
      id: msg.id,
      conversationId: msg.conversationId,
      role: msg.role,
      content: msg.content,
      timestamp: 1,
      model: msg.model
    }
  }
}))

import {
  resolveAgentDispatch,
  runAgentPipeline,
  validateRoster,
  __setStageBudgetsForTesting,
  type AgentRoster,
  type PipelineEmitter
} from './agent-pipeline'
import type { SubAgentRunner } from './multi-agent-run-tool'
import { MODEL_CATALOG } from './providers/registry'

const KNOWN_MODELS = MODEL_CATALOG.map((m) => m.id)
const planner = KNOWN_MODELS[0]
const coder = KNOWN_MODELS[1] ?? KNOWN_MODELS[0]
const reviewer = KNOWN_MODELS[2] ?? KNOWN_MODELS[0]
const validRoster: AgentRoster = { planner, coder, reviewer }

interface StatusEntry {
  role: string
  state: 'running' | 'done' | 'error'
  model: string
  output?: string
}

function makeEmitter(): {
  emitter: PipelineEmitter
  status: StatusEntry[]
  done: Array<{ message: unknown }>
  errors: string[]
} {
  const status: StatusEntry[] = []
  const done: Array<{ message: unknown }> = []
  const errors: string[] = []
  return {
    emitter: {
      status: (p) => status.push({ role: p.role, state: p.state, model: p.model, output: p.output }),
      done: (p) => done.push({ message: p.message }),
      error: (p) => errors.push(p.error)
    },
    status,
    done,
    errors
  }
}

beforeEach(() => {
  recorded.savedMessages.length = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('validateRoster', () => {
  it('accepts a full roster with three known model ids', () => {
    const result = validateRoster(validRoster)
    expect(result.ok).toBe(true)
    expect(result.value).toEqual({ planner, coder, reviewer })
  })

  it('rejects a missing role', () => {
    const result = validateRoster({ planner, coder })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('reviewer')
  })

  it('rejects an unknown model id (NOT silently defaulting through resolveModel)', () => {
    const result = validateRoster({ planner, coder, reviewer: 'totally-fake-model-id' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('reviewer')
    expect(result.error).toContain('totally-fake-model-id')
  })

  it('rejects when roster is not an object', () => {
    expect(validateRoster(undefined).ok).toBe(false)
    expect(validateRoster(null).ok).toBe(false)
    expect(validateRoster('main').ok).toBe(false)
  })

  it('ignores an unknown coworker (optional field)', () => {
    const result = validateRoster({
      planner,
      coder,
      reviewer,
      coworker: 'fake-coworker-id'
    })
    expect(result.ok).toBe(true)
    expect(result.value?.coworker).toBeUndefined()
  })
})

describe('runAgentPipeline — happy path', () => {
  it('runs Planner, Coder, Reviewer in order with the expected status emits', async () => {
    const calls: string[] = []
    const subAgentRunner: SubAgentRunner = async (_m, modelId) => {
      // Each sub-agent call has a single user message; the role is encoded
      // in the system prompt. The Planner runs first, the Reviewer second.
      calls.push(`sub:${modelId}`)
      if (calls.filter((c) => c === `sub:${modelId}`).length === 1 && modelId === planner) {
        return 'plan-text-output'
      }
      return 'review-text-output'
    }
    const coderMessageBody = { content: 'coder reply body', model: coder }
    const coderRunner = vi.fn(async () => {
      calls.push(`coder:${coder}`)
      return { message: coderMessageBody }
    })
    const { emitter, status, done, errors } = makeEmitter()
    const signal = new AbortController().signal

    await runAgentPipeline({
      conversationId: 'c1',
      roster: validRoster,
      userContent: 'add a footer to the page',
      systemPrompt: '<system>',
      priorMessages: [],
      tools: undefined,
      workspacePath: '/tmp/proj',
      signal,
      subAgentRunner,
      coderRunner,
      emitter
    })

    // Order: planner-running, planner-done, coder-running, coder-done,
    // reviewer-running, reviewer-done.
    const roleStates = status.map((s) => `${s.role}:${s.state}`)
    expect(roleStates).toEqual([
      'planner:running',
      'planner:done',
      'coder:running',
      'coder:done',
      'reviewer:running',
      'reviewer:done'
    ])
    expect(errors).toEqual([])
    // Coder runner was called exactly once with the correct model id.
    expect(coderRunner).toHaveBeenCalledTimes(1)
    const firstCall = coderRunner.mock.calls[0] as unknown as Array<{ model: string }>
    expect(firstCall[0].model).toBe(coder)
    // chat:done emitted twice — once with the Coder message, once with
    // the Reviewer message (the persisted reviewer assistant row).
    expect(done.length).toBe(2)
    expect(done[0].message).toBe(coderMessageBody)
    expect(done[1].message).toMatchObject({
      role: 'assistant',
      content: 'review-text-output',
      model: reviewer
    })
    // The Planner output is captured on the planner:done status entry.
    const plannerDone = status.find((s) => s.role === 'planner' && s.state === 'done')
    expect(plannerDone?.output).toBe('plan-text-output')
    // The Reviewer output is on both reviewer:done AND persisted as a row.
    const reviewerDone = status.find((s) => s.role === 'reviewer' && s.state === 'done')
    expect(reviewerDone?.output).toBe('review-text-output')
    expect(recorded.savedMessages).toEqual([
      { role: 'assistant', content: 'review-text-output', model: reviewer }
    ])
  })

  it('emits reviewer:running BEFORE the first chat:done so the renderer keeps the banner up', async () => {
    const eventLog: string[] = []
    const subAgentRunner: SubAgentRunner = async (_m, modelId) =>
      modelId === planner ? 'plan' : 'review'
    const coderRunner = async () => ({ message: { content: 'coder' } })
    const emitter: PipelineEmitter = {
      status: (p) => eventLog.push(`status:${p.role}:${p.state}`),
      done: () => eventLog.push('done'),
      error: () => eventLog.push('error')
    }
    await runAgentPipeline({
      conversationId: 'c1',
      roster: validRoster,
      userContent: 'fix the regression',
      systemPrompt: '<sys>',
      priorMessages: [],
      tools: undefined,
      workspacePath: '/tmp',
      signal: new AbortController().signal,
      subAgentRunner,
      coderRunner,
      emitter
    })
    const idxReviewerRunning = eventLog.indexOf('status:reviewer:running')
    const idxFirstDone = eventLog.indexOf('done')
    expect(idxReviewerRunning).toBeGreaterThan(-1)
    expect(idxFirstDone).toBeGreaterThan(-1)
    expect(idxReviewerRunning).toBeLessThan(idxFirstDone)
  })

  it('does NOT emit on `agent:status` for the Planner before invoking the runner (running comes first)', async () => {
    let plannerRunningEmitBeforeRunner = false
    let runnerCalled = false
    const subAgentRunner: SubAgentRunner = async () => {
      runnerCalled = true
      return 'plan'
    }
    const coderRunner = async () => ({ message: { content: 'coder' } })
    const emitter: PipelineEmitter = {
      status: (p) => {
        if (p.role === 'planner' && p.state === 'running' && !runnerCalled) {
          plannerRunningEmitBeforeRunner = true
        }
      },
      done: () => undefined,
      error: () => undefined
    }
    await runAgentPipeline({
      conversationId: 'c1',
      roster: validRoster,
      userContent: 'hello',
      systemPrompt: '<sys>',
      priorMessages: [],
      tools: undefined,
      workspacePath: '/tmp',
      signal: new AbortController().signal,
      subAgentRunner,
      coderRunner,
      emitter
    })
    expect(plannerRunningEmitBeforeRunner).toBe(true)
  })

  it('passes the planner output to the Coder as a <plan> block in the rewritten user message', async () => {
    let coderUserMessage: string | null = null
    const subAgentRunner: SubAgentRunner = async (_m, modelId) =>
      modelId === planner ? 'NUMBERED PLAN\n1. step A\n2. step B' : 'review'
    const coderRunner = async (params: { messages: { role: string; content?: unknown }[] }) => {
      const lastUser = [...params.messages].reverse().find((m) => m.role === 'user')
      coderUserMessage = typeof lastUser?.content === 'string' ? lastUser.content : null
      return { message: { content: 'coder' } }
    }
    await runAgentPipeline({
      conversationId: 'c1',
      roster: validRoster,
      userContent: 'add a footer',
      systemPrompt: '<sys>',
      priorMessages: [],
      tools: undefined,
      workspacePath: '/tmp',
      signal: new AbortController().signal,
      subAgentRunner,
      coderRunner,
      emitter: makeEmitter().emitter
    })
    expect(coderUserMessage).not.toBeNull()
    expect(coderUserMessage!).toContain('<plan source="planner">')
    expect(coderUserMessage!).toContain('NUMBERED PLAN')
    expect(coderUserMessage!).toContain('add a footer')
    expect(coderUserMessage!.indexOf('NUMBERED PLAN')).toBeLessThan(
      coderUserMessage!.indexOf('add a footer')
    )
  })
})

describe('runAgentPipeline — failure paths', () => {
  it('emits planner:error and chat:error when the Planner sub-agent fails', async () => {
    const subAgentRunner: SubAgentRunner = async () => {
      throw new Error('upstream provider 500')
    }
    const coderRunner = vi.fn()
    const { emitter, status, done, errors } = makeEmitter()
    await runAgentPipeline({
      conversationId: 'c1',
      roster: validRoster,
      userContent: 'x',
      systemPrompt: '<sys>',
      priorMessages: [],
      tools: undefined,
      workspacePath: '/tmp',
      signal: new AbortController().signal,
      subAgentRunner,
      coderRunner,
      emitter
    })
    const plannerError = status.find((s) => s.role === 'planner' && s.state === 'error')
    expect(plannerError).toBeDefined()
    expect(plannerError?.output).toContain('upstream provider 500')
    expect(errors.length).toBe(1)
    expect(errors[0]).toMatch(/planner/i)
    // Coder must not have been called, no chat:done emitted.
    expect(coderRunner).not.toHaveBeenCalled()
    expect(done).toEqual([])
  })

  it('emits coder:error and chat:error when the Coder runner throws', async () => {
    const subAgentRunner: SubAgentRunner = async () => 'plan'
    const coderRunner = async () => {
      throw new Error('tool exec failed')
    }
    const { emitter, status, errors, done } = makeEmitter()
    await runAgentPipeline({
      conversationId: 'c1',
      roster: validRoster,
      userContent: 'x',
      systemPrompt: '<sys>',
      priorMessages: [],
      tools: undefined,
      workspacePath: '/tmp',
      signal: new AbortController().signal,
      subAgentRunner,
      coderRunner,
      emitter
    })
    const coderError = status.find((s) => s.role === 'coder' && s.state === 'error')
    expect(coderError).toBeDefined()
    expect(errors[0]).toMatch(/coder/i)
    // No reviewer or chat:done.
    expect(status.find((s) => s.role === 'reviewer')).toBeUndefined()
    expect(done).toEqual([])
  })

  it('emits coder:error when the Coder runner returns null (max rounds / abort) and does not run Reviewer', async () => {
    const subAgentRunner: SubAgentRunner = async () => 'plan'
    const coderRunner = async () => null
    const { emitter, status, errors, done } = makeEmitter()
    await runAgentPipeline({
      conversationId: 'c1',
      roster: validRoster,
      userContent: 'x',
      systemPrompt: '<sys>',
      priorMessages: [],
      tools: undefined,
      workspacePath: '/tmp',
      signal: new AbortController().signal,
      subAgentRunner,
      coderRunner,
      emitter
    })
    const coderError = status.find((s) => s.role === 'coder' && s.state === 'error')
    expect(coderError).toBeDefined()
    expect(errors[0]).toMatch(/null/)
    expect(status.find((s) => s.role === 'reviewer')).toBeUndefined()
    expect(done).toEqual([])
  })

  it('emits reviewer:error but DOES emit chat:done for the Coder reply (user already has the answer)', async () => {
    const coderMessageBody = { content: 'coder reply', model: coder }
    let subCall = 0
    const subAgentRunner: SubAgentRunner = async () => {
      subCall++
      if (subCall === 1) return 'plan'
      throw new Error('reviewer provider 500')
    }
    const coderRunner = async () => ({ message: coderMessageBody })
    const { emitter, status, done, errors } = makeEmitter()
    await runAgentPipeline({
      conversationId: 'c1',
      roster: validRoster,
      userContent: 'x',
      systemPrompt: '<sys>',
      priorMessages: [],
      tools: undefined,
      workspacePath: '/tmp',
      signal: new AbortController().signal,
      subAgentRunner,
      coderRunner,
      emitter
    })
    const reviewerError = status.find((s) => s.role === 'reviewer' && s.state === 'error')
    expect(reviewerError).toBeDefined()
    expect(reviewerError?.output).toContain('reviewer provider 500')
    // The Coder's chat:done was emitted before the Reviewer ran, so the
    // user has their reply on screen. No second chat:done for the failed
    // reviewer, no chat:error (the Coder reply is the authoritative
    // answer).
    expect(done.length).toBe(1)
    expect(done[0].message).toBe(coderMessageBody)
    expect(errors).toEqual([])
  })

  it('bails out early when the signal is aborted before the Coder stage', async () => {
    const controller = new AbortController()
    const subAgentRunner: SubAgentRunner = async () => {
      controller.abort() // aborts AFTER planner returns
      return 'plan'
    }
    const coderRunner = vi.fn()
    const { emitter, status, errors, done } = makeEmitter()
    await runAgentPipeline({
      conversationId: 'c1',
      roster: validRoster,
      userContent: 'x',
      systemPrompt: '<sys>',
      priorMessages: [],
      tools: undefined,
      workspacePath: '/tmp',
      signal: controller.signal,
      subAgentRunner,
      coderRunner,
      emitter
    })
    // Planner finished, then abort flipped — Coder must NOT have been
    // called.
    expect(coderRunner).not.toHaveBeenCalled()
    expect(status.some((s) => s.role === 'planner' && s.state === 'done')).toBe(true)
    expect(errors[0]).toMatch(/aborted/i)
    expect(done).toEqual([])
  })
})

describe('resolveAgentDispatch — chat:send dispatch decision', () => {
  // Pinning the decision tree the chat:send IPC handler runs every turn.
  // Tests cover the cases that previously needed an Electron-host smoke
  // test to exercise: single-mode pass-through, multi-mode happy path,
  // and every fallback-to-single reason.

  it('returns single when settings JSON is missing', () => {
    expect(resolveAgentDispatch(null)).toEqual({ kind: 'single' })
  })

  it('returns single when agentMode is "single"', () => {
    const result = resolveAgentDispatch({
      agentMode: 'single',
      agentRoster: validRoster
    })
    expect(result).toEqual({ kind: 'single' })
  })

  it('returns single when agentMode is missing or unknown', () => {
    expect(resolveAgentDispatch({}).kind).toBe('single')
    expect(resolveAgentDispatch({ agentMode: 'unknown' }).kind).toBe('single')
    expect(resolveAgentDispatch({ agentMode: 42 }).kind).toBe('single')
  })

  it('returns multi with the validated roster on the happy path', () => {
    const result = resolveAgentDispatch({
      agentMode: 'multi',
      agentRoster: validRoster
    })
    expect(result.kind).toBe('multi')
    if (result.kind === 'multi') {
      expect(result.roster).toEqual({ planner, coder, reviewer })
    }
  })

  it('falls back to single (with reason) when agentMode=multi but roster is missing', () => {
    const result = resolveAgentDispatch({ agentMode: 'multi' })
    expect(result.kind).toBe('single')
    if (result.kind === 'single') {
      expect(result.reason).toBeDefined()
      expect(result.reason!.toLowerCase()).toContain('missing')
    }
  })

  it('falls back to single (with reason) when a roster role uses an unknown model id', () => {
    const result = resolveAgentDispatch({
      agentMode: 'multi',
      agentRoster: { ...validRoster, coder: 'totally-fake-id' }
    })
    expect(result.kind).toBe('single')
    if (result.kind === 'single') {
      expect(result.reason).toContain('coder')
      expect(result.reason).toContain('totally-fake-id')
    }
  })

  it('falls back to single (with reason) when a roster role is the wrong type', () => {
    const result = resolveAgentDispatch({
      agentMode: 'multi',
      agentRoster: { ...validRoster, planner: 42 }
    })
    expect(result.kind).toBe('single')
    if (result.kind === 'single') {
      expect(result.reason).toContain('planner')
    }
  })

  it('SINGLE-mode dispatch carries no roster — proves the chat:send branch will skip the pipeline (no agent:status will be emitted)', () => {
    // The chat:send handler does:
    //     if (dispatch.kind === 'multi') runAgentPipeline(...)
    //     else runChatRound(...)   ← single path, never emits agent:status
    // This test pins the discriminant so a future refactor that adds a
    // 'pipeline-lite' kind has to update the chat:send switch too.
    const single = resolveAgentDispatch({ agentMode: 'single', agentRoster: validRoster })
    expect(single.kind).toBe('single')
    // @ts-expect-error — single decisions never carry a roster
    expect(single.roster).toBeUndefined()
  })
})

describe('runAgentPipeline — coexistence with multi_agent_run', () => {
  it('does not import or assume the multi_agent_run TOOL is registered (the pipeline is an independent caller of executeMultiAgentRun)', async () => {
    // Smoke: the pipeline body completes without consulting a tool
    // registry. If a future refactor changes that, this test breaks.
    const subAgentRunner: SubAgentRunner = async () => 'output'
    const coderRunner = async () => ({ message: { content: 'coder' } })
    const { emitter, done } = makeEmitter()
    await runAgentPipeline({
      conversationId: 'c1',
      roster: validRoster,
      userContent: 'x',
      systemPrompt: '<sys>',
      priorMessages: [],
      tools: undefined,
      workspacePath: '/tmp',
      signal: new AbortController().signal,
      subAgentRunner,
      coderRunner,
      emitter
    })
    expect(done.length).toBe(2)
  })

  it('threads tools through to the Coder runner (so multi_agent_run remains callable mid-turn)', async () => {
    let seenTools: unknown = 'untouched'
    const subAgentRunner: SubAgentRunner = async () => 'x'
    const coderRunner = async (params: { tools: unknown }) => {
      seenTools = params.tools
      return { message: { content: 'coder' } }
    }
    const fakeTools = [{ type: 'function', function: { name: 'multi_agent_run' } }] as never
    await runAgentPipeline({
      conversationId: 'c1',
      roster: validRoster,
      userContent: 'x',
      systemPrompt: '<sys>',
      priorMessages: [],
      tools: fakeTools,
      workspacePath: '/tmp',
      signal: new AbortController().signal,
      subAgentRunner,
      coderRunner,
      emitter: makeEmitter().emitter
    })
    expect(seenTools).toBe(fakeTools)
  })
})

describe('runAgentPipeline — per-stage wall-clock budgets (T3)', () => {
  afterEach(() => {
    __setStageBudgetsForTesting(null)
  })

  it('aborts the Coder via signal when its budget expires and reports a clean error', async () => {
    __setStageBudgetsForTesting({ planner: 0, coder: 80, reviewer: 0 })

    const subAgentRunner: SubAgentRunner = async (_m, modelId) =>
      modelId === planner ? 'plan' : 'review'

    // Coder runner that watches its passed signal: never resolves on its own,
    // throws an AbortError if the signal fires (so we can prove the budget
    // really did wire through and abort it).
    const coderRunner = async (params: { signal: AbortSignal }) => {
      return new Promise<{ message: unknown } | null>((_, reject) => {
        params.signal.addEventListener('abort', () => {
          const e = new Error('aborted by signal')
          e.name = 'AbortError'
          reject(e)
        })
      })
    }

    const { emitter, status, errors } = makeEmitter()
    const signal = new AbortController().signal

    const start = Date.now()
    await runAgentPipeline({
      conversationId: 'c1',
      roster: validRoster,
      userContent: 'do the thing',
      systemPrompt: '<sys>',
      priorMessages: [],
      tools: undefined,
      workspacePath: '/tmp',
      signal,
      subAgentRunner,
      coderRunner,
      emitter
    })
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(2_000)
    expect(elapsed).toBeGreaterThanOrEqual(70)
    const coderError = status.find((s) => s.role === 'coder' && s.state === 'error')
    expect(coderError).toBeDefined()
    expect(errors.length).toBe(1)
    expect(errors[0]).toMatch(/budget/i)
  })

  it('does NOT abort the Coder before its budget when work completes in time', async () => {
    __setStageBudgetsForTesting({ planner: 0, coder: 5_000, reviewer: 0 })

    const subAgentRunner: SubAgentRunner = async (_m, modelId) =>
      modelId === planner ? 'plan' : 'review'

    const coderRunner = async () => {
      // Returns immediately — budget should never trigger.
      return { message: { content: 'fast coder' } }
    }

    const { emitter, status, errors, done } = makeEmitter()
    await runAgentPipeline({
      conversationId: 'c1',
      roster: validRoster,
      userContent: 'fast task',
      systemPrompt: '<sys>',
      priorMessages: [],
      tools: undefined,
      workspacePath: '/tmp',
      signal: new AbortController().signal,
      subAgentRunner,
      coderRunner,
      emitter
    })

    expect(errors).toEqual([])
    expect(status.find((s) => s.role === 'coder' && s.state === 'done')).toBeDefined()
    expect(done.length).toBeGreaterThanOrEqual(1)
  })

  it('budget=0 disables the cap entirely (coder can run indefinitely)', async () => {
    __setStageBudgetsForTesting({ planner: 0, coder: 0, reviewer: 0 })

    const subAgentRunner: SubAgentRunner = async (_m, modelId) =>
      modelId === planner ? 'plan' : 'review'

    let abortFired = false
    const coderRunner = async (params: { signal: AbortSignal }) => {
      params.signal.addEventListener('abort', () => {
        abortFired = true
      })
      // Wait briefly to make sure no budget timer would have fired.
      await new Promise((r) => setTimeout(r, 50))
      return { message: { content: 'done' } }
    }

    const { emitter, errors } = makeEmitter()
    await runAgentPipeline({
      conversationId: 'c1',
      roster: validRoster,
      userContent: 'task',
      systemPrompt: '<sys>',
      priorMessages: [],
      tools: undefined,
      workspacePath: '/tmp',
      signal: new AbortController().signal,
      subAgentRunner,
      coderRunner,
      emitter
    })

    expect(errors).toEqual([])
    expect(abortFired).toBe(false)
  })
})
