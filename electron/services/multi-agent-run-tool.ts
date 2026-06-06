import { randomUUID } from 'crypto'
import {
  AGENT_ROLE_PROMPTS,
  buildAgentSystemPrompt
} from './system-prompt-builder'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { AuditStatus } from './tool-result-status'
import {
  forkAgent,
  SubagentAbortError,
  type ForkAgentRunner,
  type SubagentTypeResolver
} from './subagent-runner'

// Single-model multi-agent sub-task primitive. The main assistant fans the
// active model into role-prompted sub-agents (planner / reader / verifier /
// reviewer / coworker), collects their outputs in parallel, and returns a
// structured envelope. Sub-agents have NO tool access — they reason on the
// supplied bounded context. The chat surface stays single-threaded; only the
// MultiAgentRunCard surfaces the fan-out.
//
// A1 refactor: per-task execution now delegates to forkAgent in
// subagent-runner.ts. The public API (validateMultiAgentArgs,
// buildSubAgentMessages, executeMultiAgentRun, the result shapes, all
// constants) is unchanged — every existing test stays green.

export const MULTI_AGENT_MAX_TASKS = 5
export const MULTI_AGENT_DEFAULT_TIMEOUT_MS = 60_000
export const MULTI_AGENT_MAX_TIMEOUT_MS = 5 * 60_000
export const MULTI_AGENT_MAX_CONTEXT_BYTES = 32 * 1024
export const MULTI_AGENT_TOOL_ID = 'multi_agent_run'

export type SubAgentRole = keyof typeof AGENT_ROLE_PROMPTS

export interface SubAgentTask {
  role: SubAgentRole
  prompt: string
  context: string
  outputFormat?: string
}

export interface MultiAgentRunArgs {
  tasks: SubAgentTask[]
  timeoutMs?: number
}

export interface SubAgentResult {
  role: SubAgentRole | string
  output: string | null
  /** Reasoning Audit Phase R3 — chain-of-thought the sub-agent model
   *  emitted. Populated when the runner returned the `{output, reasoning?}`
   *  object form (agent-pipeline does; the model-callable `multi_agent_run`
   *  tool does not). Undefined otherwise. agent-pipeline.ts plumbs this
   *  into Planner / Reviewer rows' `reasoning` column. */
  reasoning?: string
  error?: string
  elapsedMs: number
  tokensUsedEstimate?: number
  callId: string
}

export interface MultiAgentRunResult {
  results: SubAgentResult[]
  totalElapsedMs: number
  synthesisNotes: string
}

export function classifyMultiAgentRunResult(result: MultiAgentRunResult): AuditStatus {
  return result.results.some((r) => !!r.error) ? 'error' : 'done'
}

const SUPPORTED_ROLES: ReadonlySet<string> = new Set([
  'planner',
  'reader',
  'verifier',
  'reviewer',
  'coworker'
])

const TOOL_USE_HINTS = [
  '<tool_call',
  '<tool_use',
  '"tool_calls"',
  '"function_call"',
  '"function":',
  '<function_calls>',
  '<invoke ',
  '<invoke>'
]

export function validateMultiAgentArgs(args: unknown): MultiAgentRunArgs {
  if (!args || typeof args !== 'object') {
    throw new Error('multi_agent_run: arguments must be an object.')
  }
  const a = args as Record<string, unknown>
  const tasks = a.tasks
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error('multi_agent_run: "tasks" must be a non-empty array.')
  }
  if (tasks.length > MULTI_AGENT_MAX_TASKS) {
    throw new Error(
      `multi_agent_run: too many tasks (${tasks.length}). Limit is ${MULTI_AGENT_MAX_TASKS}.`
    )
  }
  const validated: SubAgentTask[] = []
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]
    if (!t || typeof t !== 'object') {
      throw new Error(`multi_agent_run: tasks[${i}] must be an object.`)
    }
    const tr = t as Record<string, unknown>
    const role = typeof tr.role === 'string' ? tr.role.trim() : ''
    if (!SUPPORTED_ROLES.has(role)) {
      throw new Error(
        `multi_agent_run: tasks[${i}].role "${role}" is not supported. ` +
          `Allowed: ${[...SUPPORTED_ROLES].join(', ')}.`
      )
    }
    const prompt = typeof tr.prompt === 'string' ? tr.prompt : ''
    if (!prompt.trim()) {
      throw new Error(`multi_agent_run: tasks[${i}].prompt must be a non-empty string.`)
    }
    const context = typeof tr.context === 'string' ? tr.context : ''
    if (Buffer.byteLength(context, 'utf8') > MULTI_AGENT_MAX_CONTEXT_BYTES) {
      throw new Error(
        `multi_agent_run: tasks[${i}].context exceeds the ${MULTI_AGENT_MAX_CONTEXT_BYTES}-byte cap.`
      )
    }
    const outputFormat =
      typeof tr.outputFormat === 'string' && tr.outputFormat.trim()
        ? tr.outputFormat
        : undefined
    validated.push({ role: role as SubAgentRole, prompt, context, outputFormat })
  }

  let timeoutMs = typeof a.timeoutMs === 'number' && a.timeoutMs > 0 ? a.timeoutMs : undefined
  if (timeoutMs && timeoutMs > MULTI_AGENT_MAX_TIMEOUT_MS) {
    timeoutMs = MULTI_AGENT_MAX_TIMEOUT_MS
  }
  return { tasks: validated, timeoutMs }
}

export function buildSubAgentMessages(task: SubAgentTask): ChatCompletionMessageParam[] {
  const system = buildAgentSystemPrompt(task.role)
  const userParts: string[] = []
  if (task.context.trim()) {
    userParts.push(`<context>\n${task.context}\n</context>`)
  }
  if (task.outputFormat) {
    userParts.push(`<output_format>\n${task.outputFormat}\n</output_format>`)
  }
  userParts.push(task.prompt.trim())
  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: userParts.join('\n\n') }
  ]
}

export function detectSubAgentToolUseAttempt(text: string | null | undefined): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  for (const hint of TOOL_USE_HINTS) {
    if (lower.includes(hint.toLowerCase())) return true
  }
  return false
}

export function approximateTokenCount(text: string | null | undefined): number {
  if (!text) return 0
  // Coarse approximation — 1 token ≈ 4 chars. Good enough for a UI hint;
  // not a billing surface.
  return Math.ceil(text.length / 4)
}

/** Reasoning Audit Phase R3 — the SubAgentRunner contract now accepts
 *  either the legacy plain-string return OR `{output, reasoning?}`.
 *  agent-pipeline.ts adapts `chatOnce` (which returns `{content, reasoning?}`)
 *  to the object form so Planner + Reviewer reasoning flows through
 *  forkAgent → SubAgentResult.reasoning → the saved DB row. The
 *  model-callable `multi_agent_run` tool path keeps using the string form
 *  (it doesn't need reasoning preservation — reasoning is the chat-mode
 *  pipeline's concern, not the model-callable tool's). */
export type SubAgentRunnerOutput = string | { output: string; reasoning?: string }

export interface SubAgentRunner {
  (
    messages: ChatCompletionMessageParam[],
    modelId: string,
    signal: AbortSignal
  ): Promise<SubAgentRunnerOutput>
}

export interface MonotonicClock {
  (): number
}

export interface ExecuteMultiAgentRunOptions {
  args: MultiAgentRunArgs
  defaultModel: string
  parentSignal?: AbortSignal
  parentCallId?: string
  runner: SubAgentRunner
  clock?: MonotonicClock
  /**
   * Recursion guard. If a sub-agent attempts to call `multi_agent_run`
   * itself, validation rejects it. This option exists so the executor can be
   * called from within another tool handler safely: the outer dispatcher
   * sets `insideSubAgent: true` and the validation step short-circuits.
   */
  insideSubAgent?: boolean
}

/**
 * Synthesise an in-memory subagent type for each multi-agent role. The
 * multi-agent roles (planner/reader/verifier/reviewer/coworker) are an
 * internal taxonomy distinct from the user-visible BUILT_IN_SUBAGENT_TYPES
 * (Explore/Plan/code-reviewer/general). Keeping them out of the public
 * registry avoids cluttering the /agents listing with internal multi-agent
 * roles, and avoids any accidental fork-by-name from external code.
 */
const multiAgentTypeLoader: SubagentTypeResolver = (name) => {
  if (!SUPPORTED_ROLES.has(name)) return null
  return {
    name,
    description: `multi_agent_run internal role: ${name}`,
    allowedTools: [],
    systemPrompt: buildAgentSystemPrompt(name as SubAgentRole),
    source: 'builtin'
  }
}

/**
 * Pure executor. `runner` is the seam where the chat provider is called;
 * tests pass a synchronous stub. Each task gets its own AbortController so a
 * per-task timeout (or a parent cancellation) cancels exactly one in-flight
 * request without taking down the others.
 *
 * Internally delegates the per-task spawn to forkAgent (subagent-runner.ts)
 * so the multi-agent runner and the general subagent fork primitive share a
 * single execution path.
 */
export async function executeMultiAgentRun(
  opts: ExecuteMultiAgentRunOptions
): Promise<MultiAgentRunResult> {
  if (opts.insideSubAgent) {
    throw new Error(
      'multi_agent_run cannot be called from inside a sub-agent run (recursion is not permitted).'
    )
  }
  const args = opts.args
  const clock = opts.clock ?? (() => Date.now())
  const timeoutMs = args.timeoutMs ?? MULTI_AGENT_DEFAULT_TIMEOUT_MS
  const targetModel = opts.defaultModel
  const overallStart = clock()

  // Adapt the legacy SubAgentRunner (messages, modelId, signal) shape to the
  // ForkAgentRunner shape used by subagent-runner.ts.
  const forkRunner: ForkAgentRunner = async (input) => {
    return opts.runner(input.messages, input.modelId, input.signal)
  }

  const promises = args.tasks.map(async (task, idx): Promise<SubAgentResult> => {
    const callId = `${opts.parentCallId ?? 'multi'}:${idx}:${randomUUID().slice(0, 8)}`
    const taskStart = clock()

    const handle = forkAgent(
      {
        prompt: task.prompt,
        agentType: task.role,
        context: task.context,
        outputFormat: task.outputFormat,
        timeoutMs,
        signal: opts.parentSignal,
        label: task.role,
        modelId: targetModel
      },
      {
        runner: forkRunner,
        defaultModel: targetModel,
        loadType: multiAgentTypeLoader,
        clock
      }
    )

    try {
      const result = await handle.promise
      const elapsedMs = Math.max(0, clock() - taskStart)
      const raw = result.rawOutput
      // R3: reasoning is preserved on ForkAgentResult.rawReasoning when
      // the runner returned the object form; pass it through so
      // agent-pipeline can persist it on the Planner / Reviewer row.
      const reasoning = result.rawReasoning
      if (detectSubAgentToolUseAttempt(raw)) {
        return {
          role: task.role,
          output: null,
          error:
            'sub-agent attempted a tool call; tool use is not permitted inside multi_agent_run',
          elapsedMs,
          callId
        }
      }
      return {
        role: task.role,
        output: raw,
        reasoning,
        elapsedMs,
        tokensUsedEstimate: approximateTokenCount(raw),
        callId
      }
    } catch (err: unknown) {
      const elapsedMs = Math.max(0, clock() - taskStart)
      let friendly: string
      if (err instanceof SubagentAbortError) {
        friendly = err.message.includes('timed out') ? err.message : 'cancelled'
      } else {
        const errorMessage =
          err instanceof Error
            ? err.message || err.name
            : typeof err === 'string'
            ? err
            : String(err)
        friendly = errorMessage || 'unknown error'
      }
      return {
        role: task.role,
        output: null,
        error: friendly,
        elapsedMs,
        callId
      }
    }
  })

  const results = await Promise.all(promises)
  const totalElapsedMs = Math.max(0, clock() - overallStart)
  const okCount = results.filter((r) => r.error === undefined).length
  const failed = results.length - okCount
  const synthesisNotes =
    failed === 0
      ? `All ${results.length} sub-agent(s) returned. Synthesise their outputs into a single response.`
      : `${okCount} of ${results.length} sub-agent(s) returned. The rest errored or timed out; weigh them accordingly.`

  return { results, totalElapsedMs, synthesisNotes }
}
