import { randomUUID } from 'crypto'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import {
  BUILT_IN_SUBAGENT_TYPES,
  getSubagentType,
  type AllowedTools,
  type SubagentTypeDef
} from './subagent-types'
import type { WorktreeManager, WorktreeContext } from './worktree-runner'

// Subagent fork primitive. The dispatch loop and workflow runner both call
// forkAgent to spawn a single subagent with a curated tool subset, an optional
// schema-forced structured output, and an abortable handle. The actual chat
// provider call is injected as `runner` so this module stays pure and testable
// — no electron/IPC coupling, no provider coupling.
//
// A1 ships the synchronous fork primitive plus extensible types. A2 adds the
// background-task lifecycle on top (agent_runs table, runInBackground option,
// agent:run:notify event). A3 adds worktree isolation. B5 hardens schema retry.

export const SUBAGENT_DEFAULT_TIMEOUT_MS = 60_000
export const SUBAGENT_MAX_TIMEOUT_MS = 10 * 60_000
export const SUBAGENT_MAX_CONTEXT_BYTES = 32 * 1024
export const SUBAGENT_SCHEMA_TOOL_NAME = 'structured_output'

export type IsolationMode = 'worktree'

export interface JsonSchemaLike {
  type?: string
  properties?: Record<string, unknown>
  required?: string[]
  // Additional standard fields are tolerated but not enforced in A1.
  [key: string]: unknown
}

export interface ForkAgentRunnerInput {
  messages: ChatCompletionMessageParam[]
  modelId: string
  allowedTools: AllowedTools
  schema?: JsonSchemaLike
  schemaToolName?: string
  signal: AbortSignal
  agentType: string
  runId: string
  // Optional worktree path produced by A3's isolation; the runner can chdir
  // shell-type tools into it. A1 wires the field through but never sets it.
  worktreePath?: string
}

export interface ForkAgentRunner {
  (input: ForkAgentRunnerInput): Promise<string>
}

export interface SubagentTypeResolver {
  (name: string): SubagentTypeDef | null
}

export interface ParentToolView {
  /** Returns the parent's full list of tool descriptor IDs (after lazy-resolve). */
  listTools(): string[]
}

export interface AgentRunStoreLike {
  insertRun(args: {
    id: string
    parentConvId?: string | null
    parentRunId?: string | null
    agentType: string
    label: string
    startedAt: number
    background?: boolean
    worktreePath?: string | null
  }): void
  finishRun(args: {
    id: string
    status: 'done' | 'error' | 'aborted'
    finishedAt: number
    resultText?: string | null
    error?: string | null
    worktreePath?: string | null
  }): void
}

export interface AgentRunNotifyEvent {
  runId: string
  agentType: string
  label: string
  parentConvId?: string | null
  parentRunId?: string | null
  status: 'running' | 'done' | 'error' | 'aborted'
  startedAt: number
  finishedAt?: number
  resultText?: string | null
  error?: string | null
  background?: boolean
}

export interface ForkAgentDeps {
  runner: ForkAgentRunner
  defaultModel: string
  /** Defaults to subagent-types#getSubagentType. */
  loadType?: SubagentTypeResolver
  /** Parent's view of available tools. Used to intersect with the type's allowedTools. */
  parentTools?: ParentToolView
  /** Test seam — defaults to randomUUID. */
  genId?: () => string
  /** Test seam — defaults to () => Date.now(). */
  clock?: () => number
  /** A2: persistence layer for agent_runs. Optional — tests skip it. */
  agentRunStore?: AgentRunStoreLike
  /** A2: emitted on every run start + finish for renderer subscribers. */
  notify?: (event: AgentRunNotifyEvent) => void
  /** A3: provider for isolated worktrees per run when opts.isolation === 'worktree'. */
  worktreeManager?: WorktreeManager
}

export interface ForkAgentOptions {
  prompt: string
  agentType: string
  /** If supplied, overrides the type's allowedTools (intersected with parent). */
  allowedTools?: AllowedTools
  /** If supplied, the subagent is forced to return JSON conforming to this schema. */
  schema?: JsonSchemaLike
  /** Defaults to deps.defaultModel. */
  modelId?: string
  /** Optional context block injected as the first user-message segment. */
  context?: string
  /** Optional output-format note injected alongside context. */
  outputFormat?: string
  /** For nested forks, identifies the originating run. */
  parentRunId?: string
  /** Conversation that spawned this fork. Stamped onto the agent_runs row. */
  parentConvId?: string | null
  /** A2: when true, the agent_runs row is flagged background so UIs can filter. */
  runInBackground?: boolean
  /** A3 wires isolation; A1 accepts and ignores. */
  isolation?: IsolationMode
  /** Per-task timeout. Capped at SUBAGENT_MAX_TIMEOUT_MS. */
  timeoutMs?: number
  /** Parent abort signal. Aborting it aborts this fork. */
  signal?: AbortSignal
  /** Optional label for UIs. Defaults to the agent type. */
  label?: string
}

export interface ForkAgentResult<T = string | Record<string, unknown>> {
  runId: string
  agentType: string
  label: string
  output: T
  rawOutput: string
  elapsedMs: number
  tokensUsedEstimate: number
}

export interface ForkAgentHandle<T = string | Record<string, unknown>> {
  runId: string
  abort: (reason?: string) => void
  promise: Promise<ForkAgentResult<T>>
}

export class SubagentSchemaError extends Error {
  readonly raw: string
  readonly schema: JsonSchemaLike
  constructor(message: string, raw: string, schema: JsonSchemaLike) {
    super(message)
    this.name = 'SubagentSchemaError'
    this.raw = raw
    this.schema = schema
  }
}

export class SubagentAbortError extends Error {
  constructor(reason?: string) {
    super(reason || 'subagent aborted')
    this.name = 'SubagentAbortError'
  }
}

export class SubagentTypeNotFoundError extends Error {
  constructor(name: string) {
    super(`subagent type "${name}" not found (no built-in and no user type)`)
    this.name = 'SubagentTypeNotFoundError'
  }
}

export class SubagentContextTooLargeError extends Error {
  constructor(bytes: number) {
    super(
      `subagent context exceeds the ${SUBAGENT_MAX_CONTEXT_BYTES}-byte cap (got ${bytes} bytes)`
    )
    this.name = 'SubagentContextTooLargeError'
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function approxTokens(text: string | null | undefined): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

/**
 * Intersect the parent's available tools with the type's allowed tools and
 * with any per-call override. '*' on either side means "no narrowing from this
 * side". The result is deterministic + sorted.
 */
export function resolveAllowedTools(
  parentTools: string[] | null,
  typeAllowed: AllowedTools,
  callOverride: AllowedTools | undefined
): string[] {
  const layers: (string[] | '*')[] = []
  if (parentTools !== null) layers.push(parentTools)
  layers.push(typeAllowed)
  if (callOverride !== undefined) layers.push(callOverride)

  let result: Set<string> | null = null
  for (const layer of layers) {
    if (layer === '*') continue
    const set = new Set<string>(layer)
    if (result === null) result = set
    else {
      const intersect = new Set<string>()
      for (const x of result) if (set.has(x)) intersect.add(x)
      result = intersect
    }
  }
  if (result === null) {
    // Every layer said '*'. Return parent's tools if we know them, else [].
    return parentTools ? [...parentTools].sort() : []
  }
  return [...result].sort()
}

function buildSchemaInstruction(schema: JsonSchemaLike, toolName: string): string {
  return [
    `Your response MUST be a single JSON object conforming to the schema below.`,
    `Do not wrap it in markdown, do not add any prose, do not call any tool by another name.`,
    `When forced tool calls are available, call the "${toolName}" tool with the JSON object as its sole argument.`,
    `Otherwise, emit ONLY the JSON object as your entire response.`,
    `<schema>`,
    JSON.stringify(schema, null, 2),
    `</schema>`
  ].join('\n')
}

export function buildForkAgentMessages(
  type: SubagentTypeDef,
  opts: ForkAgentOptions
): ChatCompletionMessageParam[] {
  const systemParts: string[] = [type.systemPrompt]
  if (opts.schema) {
    systemParts.push(buildSchemaInstruction(opts.schema, SUBAGENT_SCHEMA_TOOL_NAME))
  }
  const userParts: string[] = []
  if (opts.context && opts.context.trim()) {
    userParts.push(`<context>\n${opts.context}\n</context>`)
  }
  if (opts.outputFormat && opts.outputFormat.trim()) {
    userParts.push(`<output_format>\n${opts.outputFormat.trim()}\n</output_format>`)
  }
  userParts.push(opts.prompt.trim())
  return [
    { role: 'system' as const, content: systemParts.join('\n\n') },
    { role: 'user' as const, content: userParts.join('\n\n') }
  ]
}

/**
 * Strip common surrounding noise from a schema-mode response so JSON.parse can
 * succeed even if the model added a code fence or a stray prefix.
 */
function extractJsonPayload(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed
  // ```json ... ``` or ``` ... ```
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced && fenced[1]) return fenced[1].trim()
  // First {...} block as a last resort
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1)
  }
  return trimmed
}

/**
 * Minimal structural check. A1 enforces:
 *   - top-level is the declared `type` (object/array) when set
 *   - all `required` keys are present (objects only)
 *   - declared `properties` whose `type` is set match by typeof for primitives
 *
 * B5 will swap this for a proper retry-on-validation-error loop with the
 * validation error appended to the next prompt. For now, throw on mismatch.
 */
export function validateAgainstSchema(value: unknown, schema: JsonSchemaLike): void {
  const declared = typeof schema.type === 'string' ? schema.type : null
  if (declared === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new SubagentSchemaError(
        `schema expects an object, got ${Array.isArray(value) ? 'array' : typeof value}`,
        JSON.stringify(value),
        schema
      )
    }
    const required = Array.isArray(schema.required) ? schema.required : []
    const obj = value as Record<string, unknown>
    for (const key of required) {
      if (!(key in obj)) {
        throw new SubagentSchemaError(
          `schema requires key "${key}" — not present`,
          JSON.stringify(value),
          schema
        )
      }
    }
    const props =
      schema.properties && typeof schema.properties === 'object'
        ? (schema.properties as Record<string, JsonSchemaLike>)
        : {}
    for (const [key, propSchema] of Object.entries(props)) {
      if (!(key in obj)) continue
      if (!propSchema || typeof propSchema !== 'object') continue
      const pType = typeof propSchema.type === 'string' ? propSchema.type : null
      if (!pType) continue
      const actual = obj[key]
      const ok =
        pType === 'array'
          ? Array.isArray(actual)
          : pType === 'object'
          ? !!actual && typeof actual === 'object' && !Array.isArray(actual)
          : pType === 'null'
          ? actual === null
          : pType === 'integer'
          ? typeof actual === 'number' && Number.isInteger(actual)
          : typeof actual === pType
      if (!ok) {
        throw new SubagentSchemaError(
          `property "${key}" should be ${pType}, got ${
            Array.isArray(actual) ? 'array' : actual === null ? 'null' : typeof actual
          }`,
          JSON.stringify(value),
          schema
        )
      }
    }
    return
  }
  if (declared === 'array') {
    if (!Array.isArray(value)) {
      throw new SubagentSchemaError(
        `schema expects an array, got ${typeof value}`,
        JSON.stringify(value),
        schema
      )
    }
    return
  }
  // No declared type — accept anything parseable.
}

// ---------------------------------------------------------------------------
// In-memory live-handle registry (A2)
// ---------------------------------------------------------------------------
//
// Used by the tasks:* IPC handlers so the renderer can `tasks:stop(runId)`
// against an in-flight fork without needing a per-conversation handle map.
// Entries are removed on settle (success, error, or abort) via promise.finally.

const liveHandles = new Map<string, ForkAgentHandle>()

export function getLiveHandle(runId: string): ForkAgentHandle | undefined {
  return liveHandles.get(runId)
}

export function listLiveHandleIds(): string[] {
  return [...liveHandles.keys()]
}

// Test seam — tests reset the registry between cases.
export function __resetLiveHandlesForTests(): void {
  liveHandles.clear()
}

// ---------------------------------------------------------------------------
// Public API — forkAgent
// ---------------------------------------------------------------------------

/**
 * Fork a single subagent. Returns immediately with an abortable handle whose
 * `promise` resolves with the agent's structured result. The caller decides
 * whether to await (foreground) or hold (background — A2 builds that path on
 * top of this handle).
 */
export function forkAgent<T = string | Record<string, unknown>>(
  opts: ForkAgentOptions,
  deps: ForkAgentDeps
): ForkAgentHandle<T> {
  const genId = deps.genId ?? randomUUID
  const clock = deps.clock ?? (() => Date.now())
  const loadType = deps.loadType ?? getSubagentType
  const runId = genId()
  const startedAt = clock()

  const controller = new AbortController()
  const abort = (reason?: string): void => {
    if (!controller.signal.aborted) controller.abort(reason)
  }
  const onParentAbort = (): void => abort('parent-aborted')
  if (opts.signal) {
    if (opts.signal.aborted) abort('parent-aborted')
    else opts.signal.addEventListener('abort', onParentAbort, { once: true })
  }

  // Build & validate up front so we throw synchronously on bad config (rather
  // than handing back a handle whose promise rejects with a config error —
  // callers can still try/catch around the await, but they get a clearer
  // failure signal this way).
  const validate = (): { type: SubagentTypeDef; allowedTools: string[] } => {
    if (typeof opts.prompt !== 'string' || !opts.prompt.trim()) {
      throw new Error('forkAgent: prompt must be a non-empty string')
    }
    if (typeof opts.agentType !== 'string' || !opts.agentType.trim()) {
      throw new Error('forkAgent: agentType must be a non-empty string')
    }
    if (opts.context && Buffer.byteLength(opts.context, 'utf8') > SUBAGENT_MAX_CONTEXT_BYTES) {
      throw new SubagentContextTooLargeError(Buffer.byteLength(opts.context, 'utf8'))
    }
    const type = loadType(opts.agentType)
    if (!type) throw new SubagentTypeNotFoundError(opts.agentType)
    const parentToolList = deps.parentTools ? deps.parentTools.listTools() : null
    const allowedTools = resolveAllowedTools(parentToolList, type.allowedTools, opts.allowedTools)
    return { type, allowedTools }
  }

  let validated: { type: SubagentTypeDef; allowedTools: string[] }
  try {
    validated = validate()
  } catch (err) {
    // Surface the failure on the handle's promise rather than throwing
    // synchronously — callers in async contexts uniformly await the handle.
    const rejected: ForkAgentHandle<T> = {
      runId,
      abort: () => {},
      promise: Promise.reject(err)
    }
    return rejected
  }

  const timeoutMs = Math.min(
    Math.max(1, opts.timeoutMs ?? SUBAGENT_DEFAULT_TIMEOUT_MS),
    SUBAGENT_MAX_TIMEOUT_MS
  )

  const label = opts.label ?? opts.agentType

  // A2: persist + notify "running" before the runner is called so any
  // observer (UI poll, tasks:list, agent:run:notify subscriber) sees the row
  // as soon as forkAgent returns.
  if (deps.agentRunStore) {
    try {
      deps.agentRunStore.insertRun({
        id: runId,
        parentConvId: opts.parentConvId ?? null,
        parentRunId: opts.parentRunId ?? null,
        agentType: opts.agentType,
        label,
        startedAt,
        background: !!opts.runInBackground
      })
    } catch (err) {
      console.error('[subagent-runner] insertRun failed (continuing):', err)
    }
  }
  if (deps.notify) {
    try {
      deps.notify({
        runId,
        agentType: opts.agentType,
        label,
        parentConvId: opts.parentConvId ?? null,
        parentRunId: opts.parentRunId ?? null,
        status: 'running',
        startedAt,
        background: !!opts.runInBackground
      })
    } catch (err) {
      console.error('[subagent-runner] notify(running) threw (continuing):', err)
    }
  }

  const promise: Promise<ForkAgentResult<T>> = (async () => {
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      abort('timeout')
    }, timeoutMs)

    let worktreeCtx: WorktreeContext | undefined

    try {
      // A3: create the isolated worktree before the runner is called so the
      // runner's tools can scope to it. Creation lives INSIDE the main try
      // so failure routes through the standard finishRun(error)/notify(error)
      // path and the agent_runs row never stays stuck in 'running'.
      if (opts.isolation === 'worktree') {
        if (!deps.worktreeManager) {
          throw new Error(
            'forkAgent: isolation: "worktree" requires deps.worktreeManager'
          )
        }
        worktreeCtx = await deps.worktreeManager.create(runId)
      }

      const messages = buildForkAgentMessages(validated.type, opts)
      const runnerInput: ForkAgentRunnerInput = {
        messages,
        modelId: opts.modelId ?? deps.defaultModel,
        allowedTools: validated.allowedTools,
        schema: opts.schema,
        schemaToolName: opts.schema ? SUBAGENT_SCHEMA_TOOL_NAME : undefined,
        signal: controller.signal,
        agentType: opts.agentType,
        runId,
        worktreePath: worktreeCtx?.path
      }
      const raw = await deps.runner(runnerInput)
      // If the runner returned cleanly, accept the output even if the signal
      // just aborted — the work was already done. Aborts/timeouts only count
      // when they cause the runner to reject (handled below in the catch).
      let output: string | Record<string, unknown>
      if (opts.schema) {
        const payload = extractJsonPayload(raw)
        let parsed: unknown
        try {
          parsed = JSON.parse(payload)
        } catch (err) {
          throw new SubagentSchemaError(
            `failed to parse JSON: ${(err as Error).message}`,
            raw,
            opts.schema
          )
        }
        validateAgainstSchema(parsed, opts.schema)
        output = parsed as Record<string, unknown>
      } else {
        output = raw
      }
      const elapsedMs = Math.max(0, clock() - startedAt)
      const finishedAt = clock()

      // A3: finalize the worktree. Empty diff → wt removed, no path stamped.
      // Non-empty diff → wt preserved, path stamped onto agent_runs.
      let finalWorktreePath: string | null = null
      if (worktreeCtx && deps.worktreeManager) {
        try {
          const result = await deps.worktreeManager.finalize(worktreeCtx)
          if (result.keep) finalWorktreePath = result.path
        } catch (err) {
          console.error('[subagent-runner] worktree finalize threw (continuing):', err)
        }
      }

      // A2: persist + notify "done".
      if (deps.agentRunStore) {
        try {
          deps.agentRunStore.finishRun({
            id: runId,
            status: 'done',
            finishedAt,
            resultText: raw,
            worktreePath: finalWorktreePath
          })
        } catch (err) {
          console.error('[subagent-runner] finishRun(done) failed (continuing):', err)
        }
      }
      if (deps.notify) {
        try {
          deps.notify({
            runId,
            agentType: opts.agentType,
            label,
            parentConvId: opts.parentConvId ?? null,
            parentRunId: opts.parentRunId ?? null,
            status: 'done',
            startedAt,
            finishedAt,
            resultText: raw,
            background: !!opts.runInBackground
          })
        } catch (err) {
          console.error('[subagent-runner] notify(done) threw (continuing):', err)
        }
      }
      return {
        runId,
        agentType: opts.agentType,
        label,
        output: output as T,
        rawOutput: raw,
        elapsedMs,
        tokensUsedEstimate: approxTokens(raw)
      }
    } catch (err) {
      let finalErr: Error
      if (controller.signal.aborted && !(err instanceof SubagentSchemaError)) {
        finalErr = new SubagentAbortError(
          timedOut ? `timed out after ${timeoutMs} ms` : undefined
        )
      } else {
        finalErr = err as Error
      }
      const finishedAt = clock()
      const status: 'error' | 'aborted' = finalErr instanceof SubagentAbortError ? 'aborted' : 'error'
      const errorMessage = finalErr instanceof Error ? finalErr.message : String(finalErr)

      // A3: finalize the worktree on the failure path too. If any work
      // landed before the failure, preserve the worktree so the user can
      // inspect it; if nothing changed, clean up.
      let finalWorktreePath: string | null = null
      if (worktreeCtx && deps.worktreeManager) {
        try {
          const result = await deps.worktreeManager.finalize(worktreeCtx)
          if (result.keep) finalWorktreePath = result.path
        } catch (wtErr) {
          console.error('[subagent-runner] worktree finalize (after err) threw (continuing):', wtErr)
        }
      }

      if (deps.agentRunStore) {
        try {
          deps.agentRunStore.finishRun({
            id: runId,
            status,
            finishedAt,
            error: errorMessage,
            worktreePath: finalWorktreePath
          })
        } catch (storeErr) {
          console.error('[subagent-runner] finishRun(failed) failed (continuing):', storeErr)
        }
      }
      if (deps.notify) {
        try {
          deps.notify({
            runId,
            agentType: opts.agentType,
            label,
            parentConvId: opts.parentConvId ?? null,
            parentRunId: opts.parentRunId ?? null,
            status,
            startedAt,
            finishedAt,
            error: errorMessage,
            background: !!opts.runInBackground
          })
        } catch (notifyErr) {
          console.error('[subagent-runner] notify(failed) threw (continuing):', notifyErr)
        }
      }
      throw finalErr
    } finally {
      clearTimeout(timer)
      if (opts.signal) opts.signal.removeEventListener('abort', onParentAbort)
    }
  })()

  const handle: ForkAgentHandle<T> = { runId, abort, promise }
  // A2: register so tasks:stop(runId) can find the live handle. Deregister on
  // settle regardless of outcome — the DB row carries final state forward.
  liveHandles.set(runId, handle as ForkAgentHandle)
  promise
    .then(() => liveHandles.delete(runId))
    .catch(() => liveHandles.delete(runId))
  return handle
}

// Re-export the built-in registry so callers can inspect the defaults without
// importing both modules.
export { BUILT_IN_SUBAGENT_TYPES }
