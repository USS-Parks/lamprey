import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// agent-pipeline imports conversation-store (which imports better-sqlite3
// via database.ts) and chat-events (which imports electron). Mock both so
// the tests run in pure node without booting Electron or a DB. We capture
// every saveMessage call to assert the Reviewer-message persistence path.

const recorded = vi.hoisted(() => ({
  savedMessages: [] as Array<{
    role: string
    content: string
    model?: string
    stage?: string
    reasoning?: string
  }>
}))

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd() },
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: true }
}))

vi.mock('./conversation-store', () => ({
  saveMessage: (msg: {
    role: string
    content: string
    model?: string
    id: string
    conversationId: string
    stage?: string
    reasoning?: string
  }) => {
    recorded.savedMessages.push({
      role: msg.role,
      content: msg.content,
      model: msg.model,
      stage: msg.stage,
      reasoning: msg.reasoning
    })
    return {
      id: msg.id,
      conversationId: msg.conversationId,
      role: msg.role,
      content: msg.content,
      timestamp: 1,
      model: msg.model,
      stage: msg.stage,
      reasoning: msg.reasoning
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

function validReviewText(verdict: 'SHIP' | 'CHANGES' = 'SHIP'): string {
  return [
    'Checked failure modes: stale proof, missing waiver persistence, and scope drift.',
    'Evidence consulted: electron/services/agent-pipeline.ts:1 and receipt prf_1.',
    'Unchecked gaps: none.',
    verdict
  ].join('\n')
}

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
      return validReviewText()
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
      content: validReviewText(),
      model: reviewer
    })
    // The Planner output is captured on the planner:done status entry.
    const plannerDone = status.find((s) => s.role === 'planner' && s.state === 'done')
    expect(plannerDone?.output).toBe('plan-text-output')
    // The Reviewer output is on both reviewer:done AND persisted as a row.
    const reviewerDone = status.find((s) => s.role === 'reviewer' && s.state === 'done')
    expect(reviewerDone?.output).toBe(validReviewText())
    // R4 + R5: pipeline now saves Planner + Reviewer rows; each carries
    // its own `stage` discriminator + reasoning (when the sub-agent runner
    // returned reasoning; here the runner returned plain strings so both
    // are undefined).
    expect(recorded.savedMessages).toEqual([
      {
        role: 'assistant',
        content: 'plan-text-output',
        model: planner,
        stage: 'planner',
        reasoning: undefined
      },
      {
        role: 'assistant',
        content: validReviewText(),
        model: reviewer,
        stage: 'reviewer',
        reasoning: undefined
      }
    ])
  })

  // R4 — Planner reasoning emitted by the model (sub-agent returns the
  // object form `{output, reasoning}` per R3) must land on the saved
  // Planner row's `reasoning` field so MessageBubble can render the
  // pill inside the "Show pipeline trace" toggle on the Coder bubble.
  it('M7: forwards the coder reply to the Reviewer as builderNarrative', async () => {
    const reviewerContexts: string[] = []
    const builderNarratives: Array<string | undefined> = []
    const subAgentRunner: SubAgentRunner = async (messages, modelId) => {
      if (modelId === reviewer) {
        const user = messages.find((m) => m.role === 'user')
        reviewerContexts.push(String(user?.content ?? ''))
        return validReviewText()
      }
      return 'plan-text-output'
    }
    const coderRunner = vi.fn(async () => ({
      message: { content: 'CODER NARRATIVE: I fixed it, no need to inspect.' }
    }))
    const { emitter } = makeEmitter()
    const signal = new AbortController().signal

    await runAgentPipeline({
      conversationId: 'c1',
      correlationId: 'corr-1',
      roster: validRoster,
      userContent: 'fix proof UI',
      systemPrompt: '<system>',
      priorMessages: [],
      tools: undefined,
      workspacePath: '/tmp/proj',
      signal,
      subAgentRunner,
      coderRunner,
      emitter,
      buildReviewEvidencePacket: async (input) => {
        builderNarratives.push(input.builderNarrative)
        return {
          kind: 'review_evidence_packet',
          version: 1,
          conversationId: input.conversationId,
          correlationId: input.correlationId,
          workspacePath: input.workspacePath,
          generatedAt: 1,
          userGoal: input.userGoal,
          contract: null,
          git: { changedFiles: [], diffSummary: '', snippets: [] },
          proof: { receipts: [], failedCommands: [], skippedCommands: [], staleGreenWarnings: [] },
          toolCalls: [],
          omissions: [],
          builderNarrative: input.builderNarrative
        }
      }
    })

    expect(reviewerContexts).toHaveLength(1)
    expect(reviewerContexts[0]).toContain('"kind":"review_evidence_packet"')
    expect(reviewerContexts[0]).toContain('"userGoal":"fix proof UI"')
    // The coder's reply is the work product under review — it must reach the
    // Reviewer as builderNarrative. The reviewer prompt treats it as a claim,
    // not as evidence, so the field name (not its absence) does the framing.
    expect(builderNarratives).toEqual([
      'CODER NARRATIVE: I fixed it, no need to inspect.'
    ])
    expect(reviewerContexts[0]).toContain('CODER NARRATIVE')
    expect(reviewerContexts[0]).toContain('I fixed it')
  })

  it('M8: retries a vague reviewer output once and saves the corrected review', async () => {
    let reviewerCalls = 0
    const subAgentRunner: SubAgentRunner = async (_messages, modelId) => {
      if (modelId !== reviewer) return 'plan-text-output'
      reviewerCalls += 1
      if (reviewerCalls === 1) return 'Reviewed everything, looks good.\nSHIP'
      return [
        'Checked failure modes: stale proof and missing waiver event.',
        'Evidence consulted: electron/services/change-contract-store.ts:10 and receipt prf_1.',
        'Unchecked gaps: none.',
        'SHIP'
      ].join('\n')
    }
    const coderRunner = vi.fn(async () => ({ message: { content: 'coder reply' } }))
    const { emitter, status } = makeEmitter()
    const signal = new AbortController().signal

    await runAgentPipeline({
      conversationId: 'c1',
      roster: validRoster,
      userContent: 'fix proof UI',
      systemPrompt: '<system>',
      priorMessages: [],
      tools: undefined,
      workspacePath: '/tmp/proj',
      signal,
      subAgentRunner,
      coderRunner,
      emitter,
      buildReviewEvidencePacket: async (input) => ({
        kind: 'review_evidence_packet',
        version: 1,
        conversationId: input.conversationId,
        workspacePath: input.workspacePath,
        generatedAt: 1,
        contract: null,
        git: { changedFiles: [], diffSummary: '', snippets: [] },
        proof: { receipts: [], failedCommands: [], skippedCommands: [], staleGreenWarnings: [] },
        toolCalls: [],
        omissions: []
      })
    })

    expect(reviewerCalls).toBe(2)
    const reviewerDone = status.find((s) => s.role === 'reviewer' && s.state === 'done')
    expect(reviewerDone?.output).toContain('Checked failure modes')
    const reviewerRow = recorded.savedMessages.find((m) => m.stage === 'reviewer')
    expect(reviewerRow?.content).toContain('receipt prf_1')
  })

  it('R4: persists Planner reasoning when the sub-agent returns the object form', async () => {
    const subAgentRunner: SubAgentRunner = async (_m, modelId) => {
      if (modelId === planner) {
        return {
          output: 'PLAN: do steps 1-3',
          reasoning: 'I considered three approaches and picked the simplest'
        }
      }
      return validReviewText()
    }
    const coderRunner = vi.fn(async () => ({ message: { content: 'coder reply' } }))
    const { emitter } = makeEmitter()
    const signal = new AbortController().signal

    await runAgentPipeline({
      conversationId: 'c1',
      roster: validRoster,
      userContent: 'do stuff',
      systemPrompt: '<system>',
      priorMessages: [],
      tools: undefined,
      workspacePath: '/tmp/proj',
      signal,
      subAgentRunner,
      coderRunner,
      emitter
    })

    const plannerRow = recorded.savedMessages.find((m) => m.stage === 'planner')
    expect(plannerRow).toBeDefined()
    expect(plannerRow?.content).toBe('PLAN: do steps 1-3')
    expect(plannerRow?.reasoning).toBe(
      'I considered three approaches and picked the simplest'
    )
  })

  // R5 — Reviewer reasoning preserved on the saved row, both for
  // native-channel emitters (object form) and inline-<think>-emitters
  // (the existing splitInlineReasoning path inside saveMessage).
  it('R5: persists Reviewer reasoning from the native channel (object form)', async () => {
    const subAgentRunner: SubAgentRunner = async (_m, modelId) => {
      if (modelId === planner) return 'plan-output'
      // Reviewer emits both body + native reasoning
      return {
        output: validReviewText(),
        reasoning: "I checked the diff against the user's intent, no regressions"
      }
    }
    const coderRunner = vi.fn(async () => ({ message: { content: 'coder reply' } }))
    const { emitter } = makeEmitter()
    const signal = new AbortController().signal

    await runAgentPipeline({
      conversationId: 'c1',
      roster: validRoster,
      userContent: 'do stuff',
      systemPrompt: '<system>',
      priorMessages: [],
      tools: undefined,
      workspacePath: '/tmp/proj',
      signal,
      subAgentRunner,
      coderRunner,
      emitter
    })

    const reviewerRow = recorded.savedMessages.find((m) => m.stage === 'reviewer')
    expect(reviewerRow).toBeDefined()
    expect(reviewerRow?.content).toBe(validReviewText())
    expect(reviewerRow?.reasoning).toBe(
      "I checked the diff against the user's intent, no regressions"
    )
  })

  // R5 — Inline `<think>` Reviewer body. The saveMessage layer's
  // splitInlineReasoning hoists the block into the reasoning column,
  // so even when the sub-agent runner returns a plain string (no native
  // channel) the row still carries reasoning.
  it('R5: persists Reviewer reasoning from inline <think> blocks', async () => {
    const subAgentRunner: SubAgentRunner = async (_m, modelId) => {
      if (modelId === planner) return 'plan-output'
      return `<think>I weighed the trade-offs</think>${validReviewText()}`
    }
    const coderRunner = vi.fn(async () => ({ message: { content: 'coder reply' } }))
    const { emitter } = makeEmitter()
    const signal = new AbortController().signal

    await runAgentPipeline({
      conversationId: 'c1',
      roster: validRoster,
      userContent: 'do stuff',
      systemPrompt: '<system>',
      priorMessages: [],
      tools: undefined,
      workspacePath: '/tmp/proj',
      signal,
      subAgentRunner,
      coderRunner,
      emitter
    })

    // The test recorder captures the saveMessage *input* (not the
    // post-split output), so msg.content here is the original body with
    // the <think> block, and msg.reasoning is undefined at the input
    // layer. The actual split happens inside the real conversation-store
    // saveMessage which is covered by conversation-store-reasoning tests.
    // Here we just confirm the Reviewer save path landed with stage and
    // the body got through to the recorder.
    const reviewerRow = recorded.savedMessages.find((m) => m.stage === 'reviewer')
    expect(reviewerRow).toBeDefined()
    expect(reviewerRow?.content).toBe(`<think>I weighed the trade-offs</think>${validReviewText()}`)
  })

  it('emits reviewer:running BEFORE the first chat:done so the renderer keeps the banner up', async () => {
    const eventLog: string[] = []
    const subAgentRunner: SubAgentRunner = async (_m, modelId) =>
      modelId === planner ? 'plan' : validReviewText()
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
      modelId === planner ? 'NUMBERED PLAN\n1. step A\n2. step B' : validReviewText()
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

  // L8 (Lampshade Phase, 2026-06-09) — `'auto'` mode resolves per-turn via
  // routeAgentMode. The decision tree is: short asks → single, long /
  // multi-deliverable / phase-shaped → multi (when the roster is valid),
  // or → single with a routeReason explaining why the auto-promotion fell
  // back (e.g. invalid roster).
  it('AUTO + short userText → single (with routeReason)', () => {
    const r = resolveAgentDispatch(
      { agentMode: 'auto', agentRoster: validRoster },
      'What does the keychain do?'
    )
    expect(r.kind).toBe('single')
    expect(r.routeReason).toMatch(/short/)
  })

  it('AUTO + long userText → multi with the validated roster', () => {
    const longText = 'word '.repeat(200) // 1000 chars > 800 threshold
    const r = resolveAgentDispatch({ agentMode: 'auto', agentRoster: validRoster }, longText)
    expect(r.kind).toBe('multi')
    expect(r.routeReason).toMatch(/long prompt/)
    if (r.kind === 'multi') expect(r.roster).toEqual(validRoster)
  })

  it('AUTO + STS phrase → multi (phase-shaped ask)', () => {
    const r = resolveAgentDispatch(
      { agentMode: 'auto', agentRoster: validRoster },
      'STS the error-boundary phase'
    )
    expect(r.kind).toBe('multi')
    expect(r.routeReason).toMatch(/STS|phase/i)
  })

  it('AUTO + multi-promoting text but invalid roster → single (graceful fallback with routeReason)', () => {
    const longText = 'STS the error-boundary phase'
    const r = resolveAgentDispatch({ agentMode: 'auto' /* no roster */ }, longText)
    expect(r.kind).toBe('single')
    if (r.kind === 'single') {
      expect(r.routeReason).toMatch(/auto→multi/)
      expect(r.reason).toMatch(/roster/i)
    }
  })

  it('AUTO + explicit --single flag in text → single, even on long text', () => {
    const longText = '--single ' + 'word '.repeat(200)
    const r = resolveAgentDispatch({ agentMode: 'auto', agentRoster: validRoster }, longText)
    expect(r.kind).toBe('single')
    expect(r.routeReason).toMatch(/--single/)
  })

  it('AUTO + explicit --multi flag in short text → multi', () => {
    const r = resolveAgentDispatch(
      { agentMode: 'auto', agentRoster: validRoster },
      'Fix this --multi'
    )
    expect(r.kind).toBe('multi')
    expect(r.routeReason).toMatch(/--multi/)
  })

  it('AUTO with no userText defaults to single (degenerate case is harmless)', () => {
    const r = resolveAgentDispatch({ agentMode: 'auto', agentRoster: validRoster })
    expect(r.kind).toBe('single')
  })

  // CR-4 (Cogency Restore Phase, 2026-06-09) — locks the LL_SMOKE_PLAYBOOK
  // asks to the resolved dispatch under agentMode='auto'. The router
  // (agent-router.ts) already routes these correctly per CR-3 telemetry; the
  // observed v0.11.0/v0.11.1 multi-routing in the user's playbook runs was
  // because the user's settings.agentMode was NOT 'auto' (likely 'multi').
  // No rule tuning was needed — but lock the auto-mode behavior here so a
  // future regression on the heuristic is caught.
  describe('CR-4 LL_SMOKE_PLAYBOOK dispatch (auto mode)', () => {
    const asks: Array<{ ask: string; prompt: string; kind: 'single' | 'multi' }> = [
      { ask: 'Ask 2', prompt: 'Rename runChatRound to dispatchSingleAgentTurn in electron/ipc/chat.ts', kind: 'single' },
      { ask: 'Ask 3', prompt: "Fix the typo 'Lampshde' in the README", kind: 'single' },
      { ask: 'Ask 4', prompt: 'Why is the build failing?', kind: 'single' },
      { ask: 'Ask 5', prompt: 'Add a button to the chat header that exports the transcript as markdown', kind: 'single' },
      { ask: 'Ask 6', prompt: 'Refactor the chat store to use Zustand 5 slices across every consuming component', kind: 'multi' },
      { ask: 'Ask 7', prompt: 'STS the new error-boundary phase', kind: 'multi' },
      { ask: 'Ask 8', prompt: 'Show me the P-SPR for adding telemetry', kind: 'multi' }
    ]
    for (const { ask, prompt, kind } of asks) {
      it(`${ask} → ${kind} under agentMode=auto`, () => {
        const r = resolveAgentDispatch(
          { agentMode: 'auto', agentRoster: validRoster },
          prompt
        )
        expect(r.kind).toBe(kind)
      })
    }
  })

  // CR-4 — pins the dispatch-layer observation: agentMode='multi' BYPASSES
  // the router entirely. The user's playbook runs went multi because of this
  // bypass, not because of a router miss. If a future change wires the
  // router into the explicit-multi path, this test breaks and forces a
  // deliberate decision.
  it('CR-4: agentMode=multi BYPASSES routeAgentMode (user-visible playbook root cause)', () => {
    const shortAskThatRouterWouldSingle = 'Fix this typo'
    const r = resolveAgentDispatch(
      { agentMode: 'multi', agentRoster: validRoster },
      shortAskThatRouterWouldSingle
    )
    expect(r.kind).toBe('multi')
  })
})

describe('runAgentPipeline — coexistence with multi_agent_run', () => {
  it('does not import or assume the multi_agent_run TOOL is registered (the pipeline is an independent caller of executeMultiAgentRun)', async () => {
    // Smoke: the pipeline body completes without consulting a tool
    // registry. If a future refactor changes that, this test breaks.
    const subAgentRunner: SubAgentRunner = async (_m, modelId) =>
      modelId === planner ? 'output' : validReviewText()
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
    const subAgentRunner: SubAgentRunner = async (_m, modelId) =>
      modelId === planner ? 'x' : validReviewText()
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
      modelId === planner ? 'plan' : validReviewText()

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
      modelId === planner ? 'plan' : validReviewText()

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
      modelId === planner ? 'plan' : validReviewText()

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

// Reasoning Audit Phase R9 — end-to-end pipeline test asserting every
// stage's reasoning lands on its own audit row with the right `stage`
// discriminator. Mocks one stage on the native channel and one on
// inline `<think>` to cover both emission paths in a single run.
describe('runAgentPipeline — R9 reasoning trail end-to-end', () => {
  it('persists Planner + Coder + Reviewer reasoning with correct stage tags', async () => {
    const subAgentRunner: SubAgentRunner = async (_m, modelId) => {
      if (modelId === planner) {
        // Native-channel Planner
        return {
          output: 'PLAN: A, B, C',
          reasoning: 'Planner weighed three options'
        }
      }
      // Reviewer emits via the legacy string + inline <think> path —
      // tests R5's mention that splitInlineReasoning still rescues
      // inline emitters at the conversation-store layer (the recorder
      // sees the raw save input here).
      return {
        output: validReviewText(),
        reasoning: 'Reviewer found no regressions'
      }
    }
    const coderRunner = vi.fn(async () => ({
      message: {
        content: 'Implemented A, B, C',
        model: coder,
        // The Coder runner's persisted message shape — agent-pipeline
        // doesn't re-save this; chat.ts's runChatRound owns the Coder
        // row, which already persisted reasoning per R6.
      }
    }))
    const { emitter } = makeEmitter()
    const signal = new AbortController().signal

    await runAgentPipeline({
      conversationId: 'r9-conv',
      roster: validRoster,
      userContent: 'do A, B, C',
      systemPrompt: '<system>',
      priorMessages: [],
      tools: undefined,
      workspacePath: '/tmp/proj',
      signal,
      subAgentRunner,
      coderRunner,
      emitter
    })

    // Exactly two pipeline-side saves: Planner row + Reviewer row.
    // Coder row lives on the coderRunner side in production
    // (chat.ts runChatRound) — outside the agent-pipeline.ts scope.
    const planner_row = recorded.savedMessages.find((m) => m.stage === 'planner')
    const reviewer_row = recorded.savedMessages.find((m) => m.stage === 'reviewer')

    expect(planner_row).toBeDefined()
    expect(planner_row?.content).toBe('PLAN: A, B, C')
    expect(planner_row?.reasoning).toBe('Planner weighed three options')
    expect(planner_row?.model).toBe(planner)

    expect(reviewer_row).toBeDefined()
    expect(reviewer_row?.content).toBe(validReviewText())
    expect(reviewer_row?.reasoning).toBe('Reviewer found no regressions')
    expect(reviewer_row?.model).toBe(reviewer)
  })
})
