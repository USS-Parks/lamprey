import { randomUUID } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'

import * as convStore from './conversation-store'
import { emitChatEvent, type AgentPipelineRole } from './chat-events'
import { MODEL_CATALOG } from './providers/registry'
import {
  boundedJsonPreview,
  recordEvent,
  type EventType
} from './event-log'
import {
  approximateTokenCount,
  executeMultiAgentRun,
  type SubAgentRunner
} from './multi-agent-run-tool'
import { saveStageMetrics } from './stage-metrics-store'
import { summarizeRun } from './final-response-composer'
import { trace } from './debug-trace'

// T3 — Per-stage wall-clock budgets. The MAX_TOOL_ROUNDS cap (chat.ts:204)
// protects against infinite loops but not against 50 rounds × 60s thinking-
// mode = 50 minutes. Each pipeline stage gets its own wall-clock budget; on
// expiry the stage's child AbortSignal fires (which threads down through
// chatStream → tool execution → MCP calls so everything winds down cleanly),
// the stage is flagged as "budget-exhausted", and the pipeline continues with
// whatever partial output was produced. User-signal aborts and budget aborts
// are kept distinct via the `budgetFired` flag so a user cancel still tears
// the whole turn down.
type BudgetedRole = 'planner' | 'coder' | 'reviewer'
const DEFAULT_STAGE_BUDGETS: Record<BudgetedRole, number> = {
  planner: 120_000, // 2 min — planner is meant to be quick
  coder: 600_000, // 10 min — coder does real codebase work
  reviewer: 120_000 // 2 min — review of summarized context
}

const MIN_STAGE_BUDGET_MS = 10_000

let stageBudgetOverrides: Partial<Record<BudgetedRole, number>> | null = null
export function __setStageBudgetsForTesting(
  budgets: Partial<Record<BudgetedRole, number>> | null
): void {
  stageBudgetOverrides = budgets
}

let pipelineUserDataPathProvider: (() => string) | null = null
export function setPipelineUserDataPathProvider(fn: (() => string) | null): void {
  pipelineUserDataPathProvider = fn
}

function readStageBudgetMs(role: BudgetedRole): number {
  if (stageBudgetOverrides && Object.prototype.hasOwnProperty.call(stageBudgetOverrides, role)) {
    return stageBudgetOverrides[role] ?? DEFAULT_STAGE_BUDGETS[role]
  }
  if (!pipelineUserDataPathProvider) return DEFAULT_STAGE_BUDGETS[role]
  try {
    const path = join(pipelineUserDataPathProvider(), 'settings.json')
    if (!existsSync(path)) return DEFAULT_STAGE_BUDGETS[role]
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as {
      stageBudgetMs?: { planner?: unknown; coder?: unknown; reviewer?: unknown }
    }
    const cfg = raw.stageBudgetMs
    if (!cfg) return DEFAULT_STAGE_BUDGETS[role]
    const ms = cfg[role]
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return DEFAULT_STAGE_BUDGETS[role]
    if (ms <= 0) return 0 // 0 disables the cap entirely
    return Math.max(MIN_STAGE_BUDGET_MS, ms)
  } catch {
    return DEFAULT_STAGE_BUDGETS[role]
  }
}

interface BudgetedSignal {
  signal: AbortSignal
  budgetFired: () => boolean
  cleanup: () => void
}

function makeBudgetedSignal(
  parent: AbortSignal,
  budgetMs: number,
  role?: BudgetedRole
): BudgetedSignal {
  const child = new AbortController()
  let fired = false
  const armedAt = Date.now()
  trace('pipeline.budget.armed', { role, budgetMs })
  const timer = budgetMs > 0
    ? setTimeout(() => {
        fired = true
        trace('pipeline.budget.fired', {
          role,
          budgetMs,
          actualElapsedMs: Date.now() - armedAt
        })
        child.abort()
      }, budgetMs)
    : null
  const onParentAbort = (): void => {
    trace('pipeline.budget.parent-abort', { role, budgetMs })
    child.abort()
  }
  if (parent.aborted) {
    trace('pipeline.budget.parent-already-aborted', { role, budgetMs })
    child.abort()
  } else {
    parent.addEventListener('abort', onParentAbort, { once: true })
  }
  return {
    signal: child.signal,
    budgetFired: () => fired,
    cleanup: () => {
      trace('pipeline.budget.cleanup', {
        role,
        budgetMs,
        fired,
        elapsedMs: Date.now() - armedAt
      })
      if (timer) clearTimeout(timer)
      parent.removeEventListener('abort', onParentAbort)
    }
  }
}

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
  /** Reasoning Audit Phase R4 — emitted when the pipeline persists the
   *  Planner row (stage='planner'). Optional so tests + non-default
   *  emitters can no-op. The renderer hydrates the row via this event
   *  instead of waiting for a conversation reload. R7 attaches the
   *  hydrated row to the next downstream Coder/Composer bubble for the
   *  "Show pipeline trace" toggle. */
  plannerMessage?(payload: { conversationId: string; message: unknown }): void
}

const defaultEmitter: PipelineEmitter = {
  status: (p) => emitChatEvent('agent:status', p),
  done: (p) => emitChatEvent('chat:done', p),
  error: (p) => emitChatEvent('chat:error', p),
  plannerMessage: (p) => emitChatEvent('chat:planner-message', p)
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
  /**
   * Chat-turn correlation id from `chat:send`. Threaded into every
   * `agent.stage.*` event so the pipeline run can be reconstructed by one
   * id alongside the model / approval / tool rows from the same turn.
   */
  correlationId?: string
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

/** Take the first sub-agent result and surface its output + any error.
 *  R3: also passes through `reasoning` so the pipeline can persist
 *  Planner / Reviewer chain-of-thought on their saved rows (R4 + R5).
 *  Empty-string output with no error is still treated as "no output". */
function takeOutput(result: {
  results: { output: string | null; reasoning?: string; error?: string }[]
}): {
  output: string
  reasoning?: string
  error?: string
} {
  const first = result.results[0]
  if (!first) return { output: '', error: 'no sub-agent result' }
  if (first.error || first.output == null) {
    return {
      output: first.output ?? '',
      reasoning: first.reasoning,
      error: first.error ?? 'sub-agent returned no output'
    }
  }
  return { output: first.output, reasoning: first.reasoning }
}

export async function runAgentPipeline(opts: RunAgentPipelineOptions): Promise<void> {
  const emitter = opts.emitter ?? defaultEmitter
  const { conversationId, roster, signal } = opts
  const correlationId = opts.correlationId
  trace('pipeline.start', {
    conversationId,
    correlationId,
    plannerModel: roster.planner,
    coderModel: roster.coder,
    reviewerModel: roster.reviewer,
    plannerBudgetMs: readStageBudgetMs('planner'),
    coderBudgetMs: readStageBudgetMs('coder'),
    reviewerBudgetMs: readStageBudgetMs('reviewer')
  })

  // Per-stage start timestamps so the done/error event can carry an accurate
  // durationMs. Keyed by role for the rare case where a stage retries.
  const stageStartedAt: Partial<Record<AgentPipelineRole, number>> = {}
  function emitStageEvent(
    type: EventType,
    role: AgentPipelineRole,
    model: string,
    extra: Record<string, unknown> = {}
  ): void {
    try {
      recordEvent({
        type,
        actorKind: 'agent',
        severity: type === 'agent.stage.failed' ? 'error' : 'info',
        conversationId,
        correlationId,
        entityKind: 'agent-stage',
        entityId: role,
        payload: {
          role,
          model,
          ...extra
        }
      })
    } catch (err) {
      console.error(`[agent-pipeline] ${type} event failed:`, err)
    }
  }
  function stageStarted(role: AgentPipelineRole, model: string): void {
    stageStartedAt[role] = Date.now()
    emitStageEvent('agent.stage.started', role, model)
  }
  function stageDone(role: AgentPipelineRole, model: string, output: string): void {
    const startedAt = stageStartedAt[role]
    emitStageEvent('agent.stage.completed', role, model, {
      durationMs: startedAt !== undefined ? Date.now() - startedAt : undefined,
      outputPreview: boundedJsonPreview(output)
    })
  }
  function stageFailed(role: AgentPipelineRole, model: string, error: string): void {
    const startedAt = stageStartedAt[role]
    emitStageEvent('agent.stage.failed', role, model, {
      durationMs: startedAt !== undefined ? Date.now() - startedAt : undefined,
      errorPreview: boundedJsonPreview(error)
    })
  }

  // RT2 — pending stage metrics captured pre-message. The planner stage
  // produces no persisted message of its own (its output is folded into
  // the coder's user message), so we stash its metrics here and write
  // them against the coder's message id once it's persisted.
  const pendingPlannerMetric: {
    durationMs: number | null
    tokensEstimate: number | null
  } = { durationMs: null, tokensEstimate: null }

  // PLANNER ------------------------------------------------------------
  emitter.status({ conversationId, role: 'planner', model: roster.planner, state: 'running' })
  stageStarted('planner', roster.planner)
  const plannerBudget = makeBudgetedSignal(signal, readStageBudgetMs('planner'), 'planner')
  // Declared without an initializer because both error paths in the
  // try/catch below `return` before any read; TS' flow analysis confirms
  // assignment-before-use at the line that reads planText (the rewritten
  // user message). ESLint's no-useless-assignment correctly flags an
  // initial `= ''`.
  let planText: string
  // Reasoning Audit Phase R4 — chain-of-thought the Planner model emitted.
  // Captured here so it can be persisted on the Planner row after the
  // try/catch resolves (success + budget-exhausted-but-partial paths both
  // produce a planText; the pure-error paths return and skip the save).
  let plannerReasoning: string | undefined
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
      parentSignal: plannerBudget.signal,
      runner: opts.subAgentRunner
    })
    const taken = takeOutput(planResult)
    plannerReasoning = taken.reasoning
    if (taken.error) {
      // Budget-exhausted planner: continue with a stub plan rather than
      // erroring the whole turn. The coder will still try to satisfy the
      // request; the banner shows that the planner ran out of time.
      if (plannerBudget.budgetFired() && !signal.aborted) {
        const partial = taken.output?.trim() || ''
        planText = partial.length > 0
          ? partial
          : '(planner stage exceeded its wall-clock budget; proceed directly with the user request)'
        emitter.status({
          conversationId,
          role: 'planner',
          model: roster.planner,
          state: 'done',
          output: planText
        })
        stageDone('planner', roster.planner, planText)
      } else {
        emitter.status({
          conversationId,
          role: 'planner',
          model: roster.planner,
          state: 'error',
          output: taken.error
        })
        stageFailed('planner', roster.planner, taken.error)
        emitter.error({ conversationId, error: `Planner failed: ${taken.error}` })
        plannerBudget.cleanup()
        return
      }
    } else {
      planText = taken.output
      // RT2 — capture planner stage cost. SubAgentResult.tokensUsedEstimate
      // is an approximation over the output text only; record it as the
      // completion-token estimate and leave promptTokens null.
      const plannerSub = planResult.results[0]
      pendingPlannerMetric.durationMs = plannerSub?.elapsedMs ?? null
      pendingPlannerMetric.tokensEstimate = plannerSub?.tokensUsedEstimate ?? approximateTokenCount(planText)
      emitter.status({
        conversationId,
        role: 'planner',
        model: roster.planner,
        state: 'done',
        output: planText
      })
      stageDone('planner', roster.planner, planText)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (plannerBudget.budgetFired() && !signal.aborted) {
      // Same recovery as the soft-error branch: keep the pipeline alive
      // so the user gets *some* reply instead of waiting another minute
      // to discover the planner timed out.
      planText = '(planner stage exceeded its wall-clock budget; proceed directly with the user request)'
      emitter.status({
        conversationId,
        role: 'planner',
        model: roster.planner,
        state: 'done',
        output: planText
      })
      stageDone('planner', roster.planner, planText)
    } else {
      emitter.status({
        conversationId,
        role: 'planner',
        model: roster.planner,
        state: 'error',
        output: message
      })
      stageFailed('planner', roster.planner, message)
      emitter.error({ conversationId, error: `Planner threw: ${message}` })
      plannerBudget.cleanup()
      return
    }
  }
  plannerBudget.cleanup()

  // R4 — persist the Planner row. Saved as `role: 'assistant'`, `stage:
  // 'planner'`, model = roster.planner, content = planText, reasoning =
  // plannerReasoning. Per Invariant §2.9 the row is HIDDEN by default in
  // the chat thread (R7 attaches it to the next Coder/Composer bubble
  // behind a "Show pipeline trace ▾" toggle); for now the row just
  // exists, audit-accessible and unchanged for any caller of getMessages.
  // We don't emit a chat:done event for it — the Coder bubble is the
  // user-facing reply that gets the chat:done. We DO emit a custom
  // 'chat:planner-message' so the renderer can hydrate the row mid-run
  // (R7) instead of waiting for a reload.
  try {
    const plannerMsg = convStore.saveMessage({
      id: randomUUID(),
      conversationId,
      role: 'assistant',
      content: planText,
      model: roster.planner,
      reasoning: plannerReasoning,
      stage: 'planner'
    })
    emitter.plannerMessage?.({ conversationId, message: plannerMsg })
  } catch (err) {
    // Saving the audit row failing should not abort the pipeline — the
    // user still gets the Coder reply. Log and continue.
    console.error('[agent-pipeline] R4 planner saveMessage failed (continuing):', err)
  }

  if (signal.aborted) {
    emitter.error({ conversationId, error: 'Pipeline aborted before Coder stage' })
    return
  }

  // CODER --------------------------------------------------------------
  emitter.status({ conversationId, role: 'coder', model: roster.coder, state: 'running' })
  stageStarted('coder', roster.coder)
  // Build the Coder's message stack: original system prompt, prior conversation,
  // and the latest user turn rewritten to carry the plan inline.
  const coderMessages: ChatCompletionMessageParam[] = [
    { role: 'system', content: opts.systemPrompt },
    ...opts.priorMessages,
    { role: 'user', content: buildCoderUserContent(opts.userContent, planText) }
  ]
  const coderBudget = makeBudgetedSignal(signal, readStageBudgetMs('coder'), 'coder')
  // Declared without an initializer for the same reason as planText above:
  // the catch returns, and the try always assigns. ESLint's
  // no-useless-assignment flags the dead initializer.
  let coderMessage: { message: unknown } | null
  const coderInvokedAt = Date.now()
  trace('pipeline.coder.invoke', {
    conversationId,
    correlationId,
    model: roster.coder,
    messagesCount: coderMessages.length,
    toolsCount: opts.tools?.length ?? 0,
    coderBudgetMs: readStageBudgetMs('coder')
  })
  try {
    coderMessage = await opts.coderRunner({
      conversationId,
      model: roster.coder,
      messages: coderMessages,
      tools: opts.tools,
      workspacePath: opts.workspacePath,
      signal: coderBudget.signal
    })
    trace('pipeline.coder.return', {
      conversationId,
      durationMs: Date.now() - coderInvokedAt,
      hasMessage: !!coderMessage,
      budgetFired: coderBudget.budgetFired()
    })
  } catch (err) {
    trace('pipeline.coder.throw', {
      conversationId,
      durationMs: Date.now() - coderInvokedAt,
      errName: (err as Error)?.name,
      errMessage: String((err as Error)?.message ?? err).slice(0, 200),
      budgetFired: coderBudget.budgetFired(),
      parentSignalAborted: signal.aborted
    })
    const message = err instanceof Error ? err.message : String(err)
    const budgetExhausted = coderBudget.budgetFired() && !signal.aborted
    emitter.status({
      conversationId,
      role: 'coder',
      model: roster.coder,
      state: 'error',
      output: budgetExhausted
        ? `Coder exceeded ${Math.round(readStageBudgetMs('coder') / 1000)}s budget — aborting and surfacing partial work.`
        : message
    })
    stageFailed('coder', roster.coder, message)
    coderBudget.cleanup()
    emitter.error({
      conversationId,
      error: budgetExhausted
        ? `Coder exceeded wall-clock budget. Partial work is saved in the conversation.`
        : `Coder failed: ${message}`
    })
    return
  }
  if (!coderMessage) {
    const budgetExhausted = coderBudget.budgetFired() && !signal.aborted
    emitter.status({
      conversationId,
      role: 'coder',
      model: roster.coder,
      state: 'error',
      output: budgetExhausted
        ? 'Coder exceeded wall-clock budget; runner returned no message.'
        : 'Coder returned no assistant message'
    })
    stageFailed(
      'coder',
      roster.coder,
      budgetExhausted ? 'budget exhausted (runner returned null)' : 'Coder runner returned null'
    )
    coderBudget.cleanup()
    emitter.error({
      conversationId,
      error: budgetExhausted
        ? 'Coder exceeded wall-clock budget — no reply was produced. Raise the budget in Settings → Streaming & Timeouts or re-prompt to continue.'
        : 'Coder runner returned null (max tool rounds hit or run aborted)'
    })
    return
  }
  coderBudget.cleanup()
  emitter.status({ conversationId, role: 'coder', model: roster.coder, state: 'done' })
  const coderContent = typeof (coderMessage.message as { content?: unknown }).content === 'string'
    ? ((coderMessage.message as { content: string }).content)
    : ''
  stageDone('coder', roster.coder, coderContent)

  // RT2 — write the planner + coder stage metrics against the coder
  // message id. The planner has no message of its own, so its row rides
  // on the coder message (StageTokenChips will show both chips on the
  // coder bubble). Coder duration is the stage wall clock the existing
  // event spine already tracked.
  const coderMsgId = (coderMessage.message as { id?: string }).id
  if (coderMsgId) {
    const coderStartedAt = stageStartedAt['coder']
    const coderDurationMs = coderStartedAt !== undefined ? Date.now() - coderStartedAt : null
    try {
      if (pendingPlannerMetric.durationMs !== null || pendingPlannerMetric.tokensEstimate !== null) {
        saveStageMetrics(coderMsgId, {
          stage: 'planner',
          model: roster.planner,
          promptTokens: null,
          completionTokens: pendingPlannerMetric.tokensEstimate,
          durationMs: pendingPlannerMetric.durationMs
        })
      }
      saveStageMetrics(coderMsgId, {
        stage: 'coder',
        model: roster.coder,
        promptTokens: null,
        completionTokens: approximateTokenCount(coderContent),
        durationMs: coderDurationMs
      })
    } catch (err) {
      console.warn('[agent-pipeline] saveStageMetrics(planner/coder) failed:', err)
    }
  }

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
  stageStarted('reviewer', roster.reviewer)
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

  const reviewerBudget = makeBudgetedSignal(signal, readStageBudgetMs('reviewer'), 'reviewer')
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
      parentSignal: reviewerBudget.signal,
      runner: opts.subAgentRunner
    })
    const taken = takeOutput(reviewResult)
    if (taken.error) {
      const budgetExhausted = reviewerBudget.budgetFired() && !signal.aborted
      emitter.status({
        conversationId,
        role: 'reviewer',
        model: roster.reviewer,
        state: 'error',
        output: budgetExhausted
          ? `Reviewer exceeded ${Math.round(readStageBudgetMs('reviewer') / 1000)}s budget`
          : taken.error
      })
      stageFailed('reviewer', roster.reviewer, taken.error)
      // Reviewer error does not abort the pipeline — the Coder's reply is
      // already in front of the user. Surface the review failure as the
      // run-banner state and stop.
      reviewerBudget.cleanup()
      return
    }
    // R5 — Reviewer save now persists reasoning + stage. The Reviewer's
    // chain-of-thought reaches us via `taken.reasoning` from R3's
    // takeOutput destructure. Inline `<think>` blocks in the body still
    // get hoisted to the reasoning column by splitInlineReasoning at the
    // saveMessage layer (conversation-store.ts), so this works for both
    // native-channel models (deepseek-reasoner, V4 Flash thinking,
    // DashScope enable_thinking) and inline-emitting models.
    const reviewerMessage = convStore.saveMessage({
      id: randomUUID(),
      conversationId,
      role: 'assistant',
      content: taken.output,
      model: roster.reviewer,
      reasoning: taken.reasoning,
      stage: 'reviewer'
    })
    // RT2 — reviewer stage metric rides on the reviewer message id.
    const reviewerSub = reviewResult.results[0]
    try {
      saveStageMetrics(reviewerMessage.id, {
        stage: 'reviewer',
        model: roster.reviewer,
        promptTokens: null,
        completionTokens: reviewerSub?.tokensUsedEstimate ?? approximateTokenCount(taken.output),
        durationMs: reviewerSub?.elapsedMs ?? null
      })
    } catch (err) {
      console.warn('[agent-pipeline] saveStageMetrics(reviewer) failed:', err)
    }
    emitter.status({
      conversationId,
      role: 'reviewer',
      model: roster.reviewer,
      state: 'done',
      output: taken.output
    })
    stageDone('reviewer', roster.reviewer, taken.output)
    emitter.done({ conversationId, message: reviewerMessage })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const budgetExhausted = reviewerBudget.budgetFired() && !signal.aborted
    emitter.status({
      conversationId,
      role: 'reviewer',
      model: roster.reviewer,
      state: 'error',
      output: budgetExhausted
        ? `Reviewer exceeded ${Math.round(readStageBudgetMs('reviewer') / 1000)}s budget`
        : message
    })
    stageFailed('reviewer', roster.reviewer, message)
    // No chat:error here — the user already has the Coder's reply on
    // screen. The error state lives in the banner row.
  } finally {
    reviewerBudget.cleanup()
  }
}
