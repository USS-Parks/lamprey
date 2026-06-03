import { randomUUID } from 'crypto'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'

import * as convStore from './conversation-store'
import { emitChatEvent, type AgentPipelineRole } from './chat-events'
import { MODEL_CATALOG } from './providers/registry'
import {
  executeMultiAgentRun,
  type SubAgentRunner
} from './multi-agent-run-tool'
import { summarizeRun } from './final-response-composer'

// Prompt 11: turn-level agentic pipeline. Runs Planner → Coder → Reviewer
// sequentially against the active model roster. The Planner and Reviewer
// are tool-LESS (executeMultiAgentRun under the hood — same primitive
// `multi_agent_run` exposes mid-turn). The Coder is THE tool-enabled
// stage: it calls a `runChatRound`-shaped runner so it can stream chunks,
// invoke tools, and use the composer just like a single-mode turn would.
//
// Relationship to multi_agent_run (the tool):
//   * multi_agent_run is a MID-TURN tool the Coder (or any active model)
//     can invoke for parallel, tool-less, fan-out reasoning. It surfaces
//     in chat as a single MultiAgentRunCard.
//   * agentMode is a TURN-LEVEL wrapper around the same model selection.
//     It's sequential, the Coder stage IS tool-enabled, and progress is
//     surfaced through `agent:status` events + the AgentRunBanner pipeline
//     row. Each stage gets its own roster model.
//
// The two are orthogonal: a Coder inside the agentMode pipeline can still
// call `multi_agent_run` when the task fans out, and a single-mode model
// can still call `multi_agent_run` without the pipeline being active.

export interface AgentRoster {
  planner: string
  coder: string
  reviewer: string
  // `coworker` is in the renderer-side AgentRoster type for the dormant
  // coworker mode; the pipeline doesn't need it. Accepted but ignored.
  coworker?: string
}

export interface ValidationResult<T> {
  ok: boolean
  value?: T
  error?: string
}

// Discriminated decision returned by `resolveAgentDispatch`. The chat:send
// handler switches on `kind`: `single` runs the pre-Prompt-11 path
// unchanged; `multi` invokes `runAgentPipeline` with the validated roster.
// When mode is 'multi' but the roster is missing or invalid, we degrade
// to single mode with a `reason` so the chat handler can warn-log it
// — falling back keeps the user from being left without a reply while
// they correct the roster in Settings.
export type AgentDispatchDecision =
  | { kind: 'single'; reason?: string }
  | { kind: 'multi'; roster: AgentRoster }

export function resolveAgentDispatch(
  settingsRaw: Record<string, unknown> | null
): AgentDispatchDecision {
  if (!settingsRaw) return { kind: 'single' }
  const agentMode = settingsRaw.agentMode
  if (agentMode !== 'multi') return { kind: 'single' }
  const validation = validateRoster(settingsRaw.agentRoster)
  if (!validation.ok || !validation.value) {
    return {
      kind: 'single',
      reason: validation.error ?? 'roster validation failed'
    }
  }
  return { kind: 'multi', roster: validation.value }
}

// Conservative roster validator. We don't fall through `resolveModel`
// (which silently defaults unknown ids — that's Prompt 7's QUAL-3 fix);
// we look up the catalog directly here so an unknown id is rejected
// cleanly with a per-role message the renderer can show.
export function validateRoster(roster: unknown): ValidationResult<AgentRoster> {
  if (!roster || typeof roster !== 'object') {
    return { ok: false, error: 'agentRoster is missing or not an object' }
  }
  const r = roster as Record<string, unknown>
  const known = new Set(MODEL_CATALOG.map((m) => m.id))
  const requiredRoles: AgentPipelineRole[] = ['planner', 'coder', 'reviewer']
  const out: AgentRoster = { planner: '', coder: '', reviewer: '' }
  for (const role of requiredRoles) {
    const id = r[role]
    if (typeof id !== 'string' || !id.trim()) {
      return { ok: false, error: `agentRoster.${role} must be a model id` }
    }
    if (!known.has(id)) {
      return {
        ok: false,
        error: `agentRoster.${role} = "${id}" is not a known model id in MODEL_CATALOG`
      }
    }
    out[role] = id
  }
  if (typeof r.coworker === 'string' && r.coworker && known.has(r.coworker)) {
    out.coworker = r.coworker
  }
  return { ok: true, value: out }
}

export interface PipelineEmitter {
  status(payload: {
    conversationId: string
    role: AgentPipelineRole
    model: string
    state: 'running' | 'done' | 'error'
    output?: string
  }): void
  done(payload: { conversationId: string; message: unknown }): void
  error(payload: { conversationId: string; error: string }): void
}

const defaultEmitter: PipelineEmitter = {
  status: (p) => emitChatEvent('agent:status', p),
  done: (p) => emitChatEvent('chat:done', p),
  error: (p) => emitChatEvent('chat:error', p)
}

export interface CoderRoundRunner {
  (params: {
    conversationId: string
    model: string
    messages: ChatCompletionMessageParam[]
    tools: ChatCompletionTool[] | undefined
    workspacePath: string
    signal: AbortSignal
  }): Promise<{ message: unknown } | null>
}

export interface RunAgentPipelineOptions {
  conversationId: string
  roster: AgentRoster
  userContent: string
  // The exact shape `buildSystemPrompt` would return for a single-mode
  // turn. Pipeline does not re-derive this; caller passes it through so
  // memory / skills / AGENTS.md / contractRole stay consistent.
  systemPrompt: string
  // Prior assistant + tool messages for THIS conversation, rebuilt by the
  // caller via the same OpenAI-message-shape walk the single-mode path
  // uses. The pipeline appends the planner output and the latest user
  // message to derive the Coder input.
  priorMessages: ChatCompletionMessageParam[]
  tools: ChatCompletionTool[] | undefined
  workspacePath: string
  signal: AbortSignal
  // Per-task timeout for Planner + Reviewer (defaults to the multi-agent
  // executor's own 60s).
  subAgentTimeoutMs?: number
  // Runner injected so tests can pin behaviour without a real provider.
  // Production passes a chatOnce-shaped runner that respects parentSignal
  // and modelId.
  subAgentRunner: SubAgentRunner
  // Runner for the Coder stage. Production passes a closure over
  // runChatRound(suppressDoneEvent=true); tests pass a stub.
  coderRunner: CoderRoundRunner
  // Optional clock + emitter seams for tests.
  emitter?: PipelineEmitter
}

const PLAN_TASK_PROMPT =
  'Produce a tight, executable plan. Number the steps; for each step name ' +
  'the file(s) involved and which Lamprey tool will run. State assumptions ' +
  'in one line. Do NOT write code. End with the plan only.'

const REVIEW_TASK_PROMPT =
  'Review the implementation summarized below. Hunt for correctness bugs, ' +
  'missed edge cases, weak/missing tests, and naming/style drift. Cite ' +
  'findings by file and line. End with exactly one verdict on its own line ' +
  '— SHIP if the change is good to merge, or CHANGES if not (followed by ' +
  'the minimal fixes required).'

function buildCoderUserContent(userContent: string, planText: string): string {
  // The Coder sees the user request prefixed with the Planner's plan as
  // an instruction block. Putting it on the same user message (rather
  // than as a system addendum) keeps it visible inside the conversation
  // history that future turns replay.
  return [
    '<plan source="planner">',
    planText.trim(),
    '</plan>',
    '',
    userContent
  ].join('\n')
}

function takeOutput(result: { results: { output: string | null; error?: string }[] }): {
  output: string
  error?: string
} {
  const first = result.results[0]
  if (!first) return { output: '', error: 'no sub-agent result' }
  if (first.error || first.output == null) {
    return { output: first.output ?? '', error: first.error ?? 'sub-agent returned no output' }
  }
  return { output: first.output }
}

export async function runAgentPipeline(opts: RunAgentPipelineOptions): Promise<void> {
  const emitter = opts.emitter ?? defaultEmitter
  const { conversationId, roster, signal } = opts

  // PLANNER ------------------------------------------------------------
  emitter.status({ conversationId, role: 'planner', model: roster.planner, state: 'running' })
  // Declared without an initializer because both error paths in the
  // try/catch below `return` before any read; TS' flow analysis confirms
  // assignment-before-use at the line that reads planText (the rewritten
  // user message). ESLint's no-useless-assignment correctly flags an
  // initial `= ''`.
  let planText: string
  try {
    const planResult = await executeMultiAgentRun({
      args: {
        tasks: [
          {
            role: 'planner',
            prompt: PLAN_TASK_PROMPT,
            context: opts.userContent
          }
        ],
        timeoutMs: opts.subAgentTimeoutMs
      },
      defaultModel: roster.planner,
      parentSignal: signal,
      runner: opts.subAgentRunner
    })
    const taken = takeOutput(planResult)
    if (taken.error) {
      emitter.status({
        conversationId,
        role: 'planner',
        model: roster.planner,
        state: 'error',
        output: taken.error
      })
      emitter.error({ conversationId, error: `Planner failed: ${taken.error}` })
      return
    }
    planText = taken.output
    emitter.status({
      conversationId,
      role: 'planner',
      model: roster.planner,
      state: 'done',
      output: planText
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    emitter.status({
      conversationId,
      role: 'planner',
      model: roster.planner,
      state: 'error',
      output: message
    })
    emitter.error({ conversationId, error: `Planner threw: ${message}` })
    return
  }

  if (signal.aborted) {
    emitter.error({ conversationId, error: 'Pipeline aborted before Coder stage' })
    return
  }

  // CODER --------------------------------------------------------------
  emitter.status({ conversationId, role: 'coder', model: roster.coder, state: 'running' })
  // Build the Coder's message stack: original system prompt, prior conversation,
  // and the latest user turn rewritten to carry the plan inline.
  const coderMessages: ChatCompletionMessageParam[] = [
    { role: 'system', content: opts.systemPrompt },
    ...opts.priorMessages,
    { role: 'user', content: buildCoderUserContent(opts.userContent, planText) }
  ]
  // Declared without an initializer for the same reason as planText above:
  // the catch returns, and the try always assigns. ESLint's
  // no-useless-assignment flags the dead initializer.
  let coderMessage: { message: unknown } | null
  try {
    coderMessage = await opts.coderRunner({
      conversationId,
      model: roster.coder,
      messages: coderMessages,
      tools: opts.tools,
      workspacePath: opts.workspacePath,
      signal
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    emitter.status({
      conversationId,
      role: 'coder',
      model: roster.coder,
      state: 'error',
      output: message
    })
    emitter.error({ conversationId, error: `Coder failed: ${message}` })
    return
  }
  if (!coderMessage) {
    emitter.status({
      conversationId,
      role: 'coder',
      model: roster.coder,
      state: 'error',
      output: 'Coder returned no assistant message'
    })
    emitter.error({
      conversationId,
      error: 'Coder runner returned null (max tool rounds hit or run aborted)'
    })
    return
  }
  emitter.status({ conversationId, role: 'coder', model: roster.coder, state: 'done' })

  if (signal.aborted) {
    // Coder finished but we were cancelled before Reviewer; emit the
    // Coder message via chat:done so the user sees their reply, then bail.
    emitter.done({ conversationId, message: coderMessage.message })
    return
  }

  // REVIEWER ----------------------------------------------------------
  // Emit reviewer:running BEFORE chat:done so the renderer's useChat
  // onDone handler sees an in-flight stage and skips clearRun().
  emitter.status({ conversationId, role: 'reviewer', model: roster.reviewer, state: 'running' })
  emitter.done({ conversationId, message: coderMessage.message })

  // Bounded review context: the conversation's own summary already does the
  // 4KB-per-row + 8KB-per-draft trimming. The Reviewer sees plan + audit
  // rows + the Coder draft — same shape the composer would.
  let reviewContext: string
  try {
    const summary = summarizeRun(
      coderMessages as never,
      undefined,
      [],
      typeof (coderMessage.message as { content?: unknown }).content === 'string'
        ? ((coderMessage.message as { content: string }).content)
        : ''
    )
    reviewContext = JSON.stringify(summary)
  } catch {
    reviewContext = String(
      (coderMessage.message as { content?: unknown }).content ?? ''
    ).slice(0, 32 * 1024)
  }
  // Hard cap as a backstop; executeMultiAgentRun enforces 32KB internally.
  if (Buffer.byteLength(reviewContext, 'utf8') > 32 * 1024) {
    reviewContext = reviewContext.slice(0, 32 * 1024)
  }

  try {
    const reviewResult = await executeMultiAgentRun({
      args: {
        tasks: [
          {
            role: 'reviewer',
            prompt: REVIEW_TASK_PROMPT,
            context: reviewContext
          }
        ],
        timeoutMs: opts.subAgentTimeoutMs
      },
      defaultModel: roster.reviewer,
      parentSignal: signal,
      runner: opts.subAgentRunner
    })
    const taken = takeOutput(reviewResult)
    if (taken.error) {
      emitter.status({
        conversationId,
        role: 'reviewer',
        model: roster.reviewer,
        state: 'error',
        output: taken.error
      })
      // Reviewer error does not abort the pipeline — the Coder's reply is
      // already in front of the user. Surface the review failure as the
      // run-banner state and stop.
      return
    }
    const reviewerMessage = convStore.saveMessage({
      id: randomUUID(),
      conversationId,
      role: 'assistant',
      content: taken.output,
      model: roster.reviewer
    })
    emitter.status({
      conversationId,
      role: 'reviewer',
      model: roster.reviewer,
      state: 'done',
      output: taken.output
    })
    emitter.done({ conversationId, message: reviewerMessage })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    emitter.status({
      conversationId,
      role: 'reviewer',
      model: roster.reviewer,
      state: 'error',
      output: message
    })
    // No chat:error here — the user already has the Coder's reply on
    // screen. The error state lives in the banner row.
  }
}
