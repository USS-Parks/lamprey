import { beforeEach, describe, expect, it, vi } from 'vitest'

// Force the event-log + policy-store fallbacks; mock conversation-store so
// the agent pipeline's saveMessage call resolves without booting better-sqlite3.
vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('electron app not available in test environment')
    }
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock('./conversation-store', () => ({
  saveMessage: (msg: { id: string; conversationId: string; role: string; content: string; model?: string }) => ({
    id: msg.id,
    conversationId: msg.conversationId,
    role: msg.role,
    content: msg.content,
    timestamp: 1,
    model: msg.model
  })
}))

import {
  __forceMemoryFallback as forceEventMemory,
  __resetEventLog,
  listEvents,
  listTimeline,
  type EventRecord
} from './event-log'
import {
  __forceMemoryFallback as forcePolicyMemory,
  __resetPolicyStore,
  upsertPolicy
} from './permission-policies-store'
import { permissionsService } from './permissions-store'
import { toolRegistry } from './tool-registry'
import { runAgentPipeline, type AgentRoster } from './agent-pipeline'
import { MODEL_CATALOG } from './providers/registry'
import type { SubAgentRunner } from './multi-agent-run-tool'

beforeEach(() => {
  __resetEventLog()
  forceEventMemory()
  __resetPolicyStore()
  forcePolicyMemory()
})

const KNOWN_MODELS = MODEL_CATALOG.map((m) => m.id)
const planner = KNOWN_MODELS[0]
const coder = KNOWN_MODELS[1] ?? KNOWN_MODELS[0]
const reviewer = KNOWN_MODELS[2] ?? KNOWN_MODELS[0]
const validRoster: AgentRoster = { planner, coder, reviewer }

// ──────────────────── correlationId on tool + approval producers ────────────────────

describe('producers pass correlationId through to event payloads', () => {
  it('recordCallStart/End attach correlationId to lifecycle events', () => {
    const cid = 'corr-tool-1'
    toolRegistry.recordCallStart(
      {
        id: 'tc-1',
        toolId: 'shell_command',
        name: 'shell_command',
        conversationId: 'conv-X',
        args: { cmd: 'ls' },
        startedAt: Date.now(),
        status: 'running'
      },
      cid
    )
    toolRegistry.recordCallEnd('tc-1', {
      status: 'done',
      result: 'ok',
      approvalSource: 'none',
      finishedAt: Date.now(),
      correlationId: cid
    })
    const events = listEvents({ correlationId: cid, order: 'asc' })
    expect(events.map((e) => e.type)).toEqual([
      'tool.call.started',
      'tool.call.completed'
    ])
    expect(events.every((e) => e.correlationId === cid)).toBe(true)
  })

  it('permissionsService attaches req.correlationId to approval events', async () => {
    upsertPolicy({
      scope: 'global',
      subjectKind: 'tool',
      subject: 'shell_command',
      decision: 'allow'
    })
    const cid = 'corr-approval-1'
    const outcome = await permissionsService.requestApprovalDetailed({
      callId: 'tc-2',
      toolId: 'shell_command',
      name: 'shell_command',
      serverId: 'internal',
      providerKind: 'native',
      risks: ['destructive'],
      args: { cmd: 'rm' },
      conversationId: 'conv-X',
      correlationId: cid
    })
    expect(outcome.decision).toBe('allow')
    const approved = listEvents({ correlationId: cid, type: 'tool.call.approved' })
    expect(approved).toHaveLength(1)
    expect(approved[0].correlationId).toBe(cid)
  })
})

// ──────────────────── agent.stage.* events ────────────────────

describe('runAgentPipeline emits agent.stage.* events', () => {
  it('happy path: planner/coder/reviewer started+completed pairs in order, all with the same correlationId', async () => {
    const cid = 'corr-pipeline-happy'
    const subAgentRunner: SubAgentRunner = async (_msgs, modelId) => {
      if (modelId === planner) return 'plan-output'
      return 'review-output'
    }
    const coderMessageBody = { content: 'coder reply', model: coder }
    const coderRunner = vi.fn(async () => ({ message: coderMessageBody }))

    await runAgentPipeline({
      conversationId: 'conv-P',
      correlationId: cid,
      roster: validRoster,
      userContent: 'do the thing',
      systemPrompt: '<sys>',
      priorMessages: [],
      tools: undefined,
      workspacePath: '/tmp',
      signal: new AbortController().signal,
      subAgentRunner,
      coderRunner,
      // Use the inline no-op emitter so we only see the event-log side.
      emitter: {
        status: () => undefined,
        done: () => undefined,
        error: () => undefined
      }
    })

    const events: EventRecord[] = listTimeline({ correlationId: cid })
    const stageEvents = events.filter((e) => e.type.startsWith('agent.stage.'))
    expect(stageEvents.map((e) => `${e.type}:${(e.payload as { role: string }).role}`)).toEqual([
      'agent.stage.started:planner',
      'agent.stage.completed:planner',
      'agent.stage.started:coder',
      'agent.stage.completed:coder',
      'agent.stage.started:reviewer',
      'agent.stage.completed:reviewer'
    ])
    expect(stageEvents.every((e) => e.correlationId === cid)).toBe(true)
    expect(stageEvents.every((e) => e.actorKind === 'agent')).toBe(true)
    // The completed events carry a durationMs and a bounded outputPreview.
    const plannerDone = stageEvents.find(
      (e) =>
        e.type === 'agent.stage.completed' &&
        (e.payload as { role: string }).role === 'planner'
    )!
    expect(typeof (plannerDone.payload as { durationMs: number }).durationMs).toBe(
      'number'
    )
    expect((plannerDone.payload as { outputPreview: string }).outputPreview).toContain(
      'plan-output'
    )
  })

  it('planner-failure path: stage.started + stage.failed (no completed), severity error', async () => {
    const cid = 'corr-pipeline-fail'
    const subAgentRunner: SubAgentRunner = async () => {
      throw new Error('upstream provider 500')
    }
    const coderRunner = vi.fn()
    await runAgentPipeline({
      conversationId: 'conv-Q',
      correlationId: cid,
      roster: validRoster,
      userContent: 'x',
      systemPrompt: '<sys>',
      priorMessages: [],
      tools: undefined,
      workspacePath: '/tmp',
      signal: new AbortController().signal,
      subAgentRunner,
      coderRunner,
      emitter: {
        status: () => undefined,
        done: () => undefined,
        error: () => undefined
      }
    })
    expect(coderRunner).not.toHaveBeenCalled()
    const stage = listEvents({
      correlationId: cid,
      type: ['agent.stage.started', 'agent.stage.completed', 'agent.stage.failed'],
      order: 'asc'
    })
    expect(stage.map((e) => e.type)).toEqual([
      'agent.stage.started',
      'agent.stage.failed'
    ])
    const failed = stage[1]
    expect(failed.severity).toBe('error')
    expect((failed.payload as { role: string }).role).toBe('planner')
    expect((failed.payload as { errorPreview: string }).errorPreview).toContain(
      'upstream provider 500'
    )
  })
})

// ──────────────────── correlation-grouped timeline ────────────────────

describe('one correlationId reconstructs a coherent multi-producer run', () => {
  it('approval + tool lifecycle + pipeline stages share a correlationId and order by time', async () => {
    const cid = 'corr-mixed-run'
    // 1. Approval (policy-match allow → emits tool.call.approved).
    upsertPolicy({
      scope: 'global',
      subjectKind: 'tool',
      subject: 'shell_command',
      decision: 'allow'
    })
    await permissionsService.requestApprovalDetailed({
      callId: 'tc-M',
      toolId: 'shell_command',
      name: 'shell_command',
      serverId: 'internal',
      providerKind: 'native',
      risks: ['destructive'],
      args: { cmd: 'ls' },
      conversationId: 'conv-M',
      correlationId: cid
    })
    // 2. Tool started + completed.
    toolRegistry.recordCallStart(
      {
        id: 'tc-M',
        toolId: 'shell_command',
        name: 'shell_command',
        conversationId: 'conv-M',
        args: { cmd: 'ls' },
        startedAt: Date.now(),
        status: 'running'
      },
      cid
    )
    toolRegistry.recordCallEnd('tc-M', {
      status: 'done',
      result: 'a.txt',
      approvalSource: 'policy:p',
      finishedAt: Date.now(),
      correlationId: cid
    })
    // 3. Pipeline stages.
    const subAgentRunner: SubAgentRunner = async (_msgs, modelId) =>
      modelId === planner ? 'plan' : 'review'
    await runAgentPipeline({
      conversationId: 'conv-M',
      correlationId: cid,
      roster: validRoster,
      userContent: 'thing',
      systemPrompt: '<sys>',
      priorMessages: [],
      tools: undefined,
      workspacePath: '/tmp',
      signal: new AbortController().signal,
      subAgentRunner,
      coderRunner: async () => ({ message: { content: 'coder reply' } }),
      emitter: {
        status: () => undefined,
        done: () => undefined,
        error: () => undefined
      }
    })

    const tl = listTimeline({ correlationId: cid })
    // Every event in the timeline must share the same correlationId — the
    // very property that lets the UI reconstruct a chat run by one id.
    expect(tl.length).toBeGreaterThanOrEqual(8)
    expect(tl.every((e) => e.correlationId === cid)).toBe(true)
    // The first event chronologically is the approval (it ran first); the
    // last is reviewer-completed.
    expect(tl[0].type).toBe('tool.call.approved')
    expect(tl[tl.length - 1].type).toBe('agent.stage.completed')
    expect((tl[tl.length - 1].payload as { role: string }).role).toBe('reviewer')
  })
})
