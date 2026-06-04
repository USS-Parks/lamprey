import { randomUUID } from 'crypto'
import { cpus } from 'os'
import vm from 'vm'
import { parseWorkflowScript, type WorkflowMeta } from './workflow-meta'
import {
  forkAgent as defaultForkAgent,
  type ForkAgentDeps,
  type ForkAgentOptions,
  type ForkAgentResult,
  type IsolationMode,
  type JsonSchemaLike
} from './subagent-runner'
import {
  appendJournalRecord,
  hashOpts,
  hashPrompt,
  journalPathFor,
  readAgentRecords,
  type AgentJournalRecord,
  type FinishJournalRecord,
  type MetaJournalRecord
} from './workflow-journal'
import {
  makeBudgetTracker,
  resolveModelId,
  tierOfModel,
  type Tier
} from './workflow-budget'

// Workflow JS evaluator core (B1). Loads a workflow script into Node's
// built-in vm with a frozen sandbox exposing the documented API surface:
// agent / parallel / pipeline / phase / log / workflow / args / budget.
//
// Concurrency cap = min(16, cpus-2). Total agent cap = 1000 per workflow.
// Both caps are computed once at run start. Budget tracking accumulates
// the tokensUsedEstimate from each forkAgent result.
//
// B2 will layer journaling + resume on top of this primitive. B3 adds the
// progress UI by subscribing to the events fired through `deps.progress`.
// B4 ships built-in workflow scripts (adversarial-verify, judge-panel,
// loop-until-dry, multi-modal-sweep). B5 adds model-tier routing + schema
// retry-with-error-appended.

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export const WORKFLOW_TOTAL_AGENT_CAP = 1000
export const WORKFLOW_DEFAULT_TIMEOUT_MS = 30 * 60_000

export function defaultConcurrencyCap(): number {
  return Math.min(16, Math.max(1, cpus().length - 2))
}

export interface WorkflowProgressEvent {
  runId: string
  kind:
    | 'started'
    | 'phase'
    | 'log'
    | 'agent:start'
    | 'agent:finish'
    | 'finished'
    | 'errored'
    | 'tokens'
  phase?: string
  label?: string
  agentRunId?: string
  agentType?: string
  message?: string
  status?: 'done' | 'error' | 'aborted'
  durationMs?: number
  tokensUsedEstimate?: number
  /** B5: which tier the agent ran on; populated on agent:finish + tokens events. */
  tier?: Tier
  finalResult?: unknown
  error?: string
  /** B5: snapshot of per-tier spend after this agent. Populated on `tokens` event. */
  budgetByTier?: Record<Tier, number>
}

export interface WorkflowBudgetSnapshot {
  total: number | null
  spent: number
  remaining: number
  byTier: Record<Tier, number>
}

export interface WorkflowRunHandle {
  runId: string
  abort(reason?: string): void
  promise: Promise<WorkflowRunResult>
}

export interface WorkflowRunResult {
  runId: string
  meta: WorkflowMeta
  output: unknown
  durationMs: number
  agentCount: number
  budget: WorkflowBudgetSnapshot
}

export interface WorkflowRunInput {
  script: string
  args?: unknown
  /** Optional total token target; when null/undefined, budget.total is null + remaining is Infinity. */
  budgetTotal?: number | null
  /** Defaults to a generated UUID. */
  runId?: string
  /** Per-workflow concurrency cap. Defaults to min(16, cpus-2). */
  concurrencyCap?: number
  /** Per-workflow timeout. Defaults to 30 min. */
  timeoutMs?: number
  /** Parent signal — aborting it aborts the workflow and any in-flight agents. */
  signal?: AbortSignal
  /**
   * B2: prior run to read cached agent results from. The new run keeps the
   * longest unchanged prefix from the prior journal (matching by
   * promptHash + optsHash at each seq) and runs anything after the first
   * divergence live. Set `resumeFromRunId === runId` to continue a run
   * whose journal already exists on disk.
   */
  resumeFromRunId?: string
  /**
   * B2: directory where journals are written. Required when journaling is
   * desired — when omitted, the runner skips journaling entirely (this is
   * the test default unless the test wants resume coverage).
   */
  journalDir?: string
  /**
   * B4: nesting depth set by the workflow() API when invoking a child.
   * 0 = top-level invocation (or undefined → treated as 0). A child workflow
   * fires runWorkflow with `nestingDepth: 1`; the inner workflow() refuses
   * to nest further.
   */
  nestingDepth?: number
}

export interface WorkflowAgentOptions {
  label?: string
  phase?: string
  schema?: JsonSchemaLike
  model?: string
  isolation?: IsolationMode
  agentType?: string
  timeoutMs?: number
}

export interface WorkflowForkSeam {
  forkAgent: typeof defaultForkAgent
  forkDeps: Omit<ForkAgentDeps, 'runner'> & { runner: ForkAgentDeps['runner'] }
}

export interface WorkflowRunnerDeps {
  /**
   * Fork seam. Production code supplies `forkAgent` (the real one) + a
   * `forkDeps` bag containing the chat runner, store, notify, etc. Tests
   * pass stubs. The runner injects fork-time options (labels/phase tags)
   * on each call.
   */
  forkSeam: WorkflowForkSeam
  /** Emits progress events. Production wires to webContents.send. */
  progress?: (event: WorkflowProgressEvent) => void
  /** Resolves a named workflow's script source. Used by `workflow()` API. */
  loadNamedWorkflow?: (name: string) => Promise<string> | string
  memory?: {
    list: (filter?: unknown) => Promise<unknown[]> | unknown[]
    write: (input: unknown) => Promise<unknown> | unknown
    delete: (name: string) => Promise<unknown> | unknown
  }
  /** Test seam — defaults to randomUUID. */
  genId?: () => string
  /** Test seam — defaults to () => Date.now(). */
  clock?: () => number
}

export class WorkflowAgentCapError extends Error {
  constructor(cap: number) {
    super(`workflow: total-agent cap (${cap}) reached`)
    this.name = 'WorkflowAgentCapError'
  }
}

export class WorkflowBudgetError extends Error {
  constructor(total: number, spent: number) {
    super(`workflow: token budget exhausted (spent ${spent} of ${total})`)
    this.name = 'WorkflowBudgetError'
  }
}

export class WorkflowAbortError extends Error {
  constructor(reason?: string) {
    super(reason || 'workflow aborted')
    this.name = 'WorkflowAbortError'
  }
}

// ---------------------------------------------------------------------------
// Concurrency semaphore
// ---------------------------------------------------------------------------

interface Semaphore {
  acquire(): Promise<() => void>
}

function makeSemaphore(cap: number): Semaphore {
  let active = 0
  const waiters: Array<() => void> = []
  const release = (): void => {
    active--
    const next = waiters.shift()
    if (next) next()
  }
  return {
    acquire: () =>
      new Promise<() => void>((resolve) => {
        const grant = (): void => {
          active++
          resolve(release)
        }
        if (active < cap) grant()
        else waiters.push(grant)
      })
  }
}

// ---------------------------------------------------------------------------
// Public API — runWorkflow
// ---------------------------------------------------------------------------

export function runWorkflow(input: WorkflowRunInput, deps: WorkflowRunnerDeps): WorkflowRunHandle {
  const runId = input.runId ?? (deps.genId ?? randomUUID)()
  const clock = deps.clock ?? (() => Date.now())
  const concurrencyCap = input.concurrencyCap ?? defaultConcurrencyCap()
  const timeoutMs = Math.max(1, input.timeoutMs ?? WORKFLOW_DEFAULT_TIMEOUT_MS)

  const controller = new AbortController()
  const abort = (reason?: string): void => {
    if (!controller.signal.aborted) controller.abort(reason)
  }
  if (input.signal) {
    if (input.signal.aborted) abort('parent-aborted')
    else input.signal.addEventListener('abort', () => abort('parent-aborted'), { once: true })
  }

  // B2: journaling state hoisted above the try so the catch block can write
  // a meaningful failure record.
  const journalDir = input.journalDir
  const journalPath = journalDir ? journalPathFor(runId, journalDir) : null
  let runAgentCount = 0

  const promise = (async (): Promise<WorkflowRunResult> => {
    const startedAt = clock()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      abort('timeout')
    }, timeoutMs)

    try {
      const parsed = parseWorkflowScript(input.script)
      const meta = parsed.meta

      // B2: journaling + resume setup (continued).
      // - `priorRecords`: cache from the resumeFromRunId journal (if any)
      // - `cacheActive`: flips to false on the first divergent agent() call;
      //   subsequent calls never check cache even if they happen to match
      let priorRecords: AgentJournalRecord[] = []
      if (input.resumeFromRunId && journalDir) {
        priorRecords = readAgentRecords(journalPathFor(input.resumeFromRunId, journalDir))
      }
      let cacheActive = priorRecords.length > 0
      let nextSeq = 0
      if (journalPath) {
        const metaRecord: MetaJournalRecord = {
          type: 'meta',
          runId,
          metaName: meta.name,
          argsHash: hashOpts(input.args),
          startedAt: clock()
        }
        appendJournalRecord(journalPath, metaRecord)
      }

      // Budget tracker. budget.spent() / remaining() are recomputed live.
      // B5: tier-aware tracker — tracks per-tier token spend so workflows
      // expose cheap-vs-expensive cost breakdown via budget.byTier().
      const budgetTotal = input.budgetTotal ?? null
      const budgetTracker = makeBudgetTracker(budgetTotal)
      const budgetApi = {
        get total(): number | null {
          return budgetTracker.total
        },
        spent: (): number => budgetTracker.spent(),
        remaining: (): number => budgetTracker.remaining(),
        byTier: (): Record<Tier, number> => budgetTracker.byTier()
      }

      let currentPhase: string | undefined
      const semaphore = makeSemaphore(Math.max(1, concurrencyCap))

      const emit = (event: WorkflowProgressEvent): void => {
        if (!deps.progress) return
        try {
          deps.progress(event)
        } catch (err) {
          console.error('[workflow-runner] progress() threw (continuing):', err)
        }
      }

      emit({ runId, kind: 'started', label: meta.name })

      // --- API: phase + log ---------------------------------------------
      const phase = (title: string): void => {
        if (typeof title !== 'string' || !title.trim()) return
        currentPhase = title
        emit({ runId, kind: 'phase', phase: title })
      }
      const log = (message: string): void => {
        if (typeof message !== 'string') return
        emit({ runId, kind: 'log', message, phase: currentPhase })
      }

      // --- API: agent ----------------------------------------------------
      const agent = async (
        prompt: string,
        opts: WorkflowAgentOptions = {}
      ): Promise<string | Record<string, unknown> | null> => {
        if (controller.signal.aborted) {
          throw new WorkflowAbortError(timedOut ? 'timed out' : undefined)
        }
        if (runAgentCount >= WORKFLOW_TOTAL_AGENT_CAP) {
          throw new WorkflowAgentCapError(WORKFLOW_TOTAL_AGENT_CAP)
        }
        if (budgetTotal !== null && budgetTracker.spent() >= budgetTotal) {
          throw new WorkflowBudgetError(budgetTotal, budgetTracker.spent())
        }
        runAgentCount++
        const agentType = opts.agentType ?? 'general'
        const phaseTag = opts.phase ?? currentPhase
        const label = opts.label ?? agentType

        // B5: resolve the symbolic 'cheap'/'pro' tier name to a concrete
        // model ID (production wiring registers per-provider mappings). The
        // tier is captured for budget tracking + progress events.
        const resolvedModelId = resolveModelId(opts.model, deps.forkSeam.forkDeps.defaultModel)
        const tier = tierOfModel(resolvedModelId)

        // B2: cache lookup before doing any real work. As soon as cache misses
        // for ANY seq, it stays inactive for the rest of the run — calls
        // after the first divergence might match by coincidence but the
        // script's intent has changed.
        const seq = nextSeq++
        const promptHash = hashPrompt(prompt)
        const optsHash = hashOpts({ label, phase: phaseTag, agentType, schema: opts.schema, model: opts.model, isolation: opts.isolation })
        if (cacheActive) {
          const prior = priorRecords[seq]
          if (prior && prior.promptHash === promptHash && prior.optsHash === optsHash) {
            // Cache hit — replay the cached result without forking.
            const parsedResult: string | Record<string, unknown> = (() => {
              try {
                const r = JSON.parse(prior.resultJson) as unknown
                return r as string | Record<string, unknown>
              } catch {
                return prior.resultJson as unknown as string
              }
            })()
            budgetTracker.record(resolvedModelId, prior.tokensUsedEstimate ?? 0)
            // Write the replay-from-cache record to THIS run's journal so a
            // chained resume sees the same sequence.
            if (journalPath) {
              appendJournalRecord(journalPath, {
                ...prior,
                phase: phaseTag,
                label,
                agentType
              })
            }
            emit({
              runId,
              kind: 'agent:finish',
              agentType,
              label,
              phase: phaseTag,
              status: 'done',
              durationMs: 0,
              tokensUsedEstimate: prior.tokensUsedEstimate,
              tier,
              message: 'cached'
            })
            emit({
              runId,
              kind: 'tokens',
              tier,
              tokensUsedEstimate: prior.tokensUsedEstimate ?? 0,
              budgetByTier: budgetTracker.byTier()
            })
            return parsedResult
          }
          // First divergence — disable cache for the rest of the run.
          cacheActive = false
        }

        const release = await semaphore.acquire()
        if (controller.signal.aborted) {
          release()
          throw new WorkflowAbortError(timedOut ? 'timed out' : undefined)
        }
        emit({
          runId,
          kind: 'agent:start',
          agentType,
          label,
          phase: phaseTag
        })
        const startedAgentAt = clock()
        let result: ForkAgentResult | null = null
        try {
          const forkOpts: ForkAgentOptions = {
            prompt,
            agentType,
            schema: opts.schema,
            modelId: resolvedModelId,
            isolation: opts.isolation,
            timeoutMs: opts.timeoutMs,
            signal: controller.signal,
            label
          }
          const handle = deps.forkSeam.forkAgent(forkOpts, deps.forkSeam.forkDeps)
          result = (await handle.promise) as ForkAgentResult
          budgetTracker.record(resolvedModelId, result.tokensUsedEstimate ?? 0)
          const finishedAgentAt = clock()
          emit({
            runId,
            kind: 'agent:finish',
            agentRunId: result.runId,
            agentType,
            label,
            phase: phaseTag,
            status: 'done',
            durationMs: finishedAgentAt - startedAgentAt,
            tokensUsedEstimate: result.tokensUsedEstimate,
            tier
          })
          emit({
            runId,
            kind: 'tokens',
            tier,
            tokensUsedEstimate: result.tokensUsedEstimate ?? 0,
            budgetByTier: budgetTracker.byTier()
          })
          // B2: append the live record to the journal.
          if (journalPath) {
            const record: AgentJournalRecord = {
              type: 'agent',
              seq,
              promptHash,
              optsHash,
              label,
              phase: phaseTag,
              agentType,
              startedAt: startedAgentAt,
              finishedAt: finishedAgentAt,
              resultJson: JSON.stringify(result.output),
              rawOutput: result.rawOutput,
              tokensUsedEstimate: result.tokensUsedEstimate ?? 0
            }
            appendJournalRecord(journalPath, record)
          }
          return result.output as string | Record<string, unknown>
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          emit({
            runId,
            kind: 'agent:finish',
            agentType,
            label,
            phase: phaseTag,
            status: controller.signal.aborted ? 'aborted' : 'error',
            durationMs: clock() - startedAgentAt,
            error: message
          })
          throw err
        } finally {
          release()
        }
      }

      // --- API: parallel (barrier) --------------------------------------
      const parallel = async (
        thunks: Array<() => Promise<unknown>>
      ): Promise<Array<unknown>> => {
        if (!Array.isArray(thunks)) {
          throw new TypeError('parallel(thunks): thunks must be an array')
        }
        // A barrier — every thunk runs in parallel, individual rejections
        // become `null` so the parent can `.filter(Boolean)`.
        return Promise.all(
          thunks.map((t, i) =>
            (async () => {
              if (typeof t !== 'function') {
                throw new TypeError(`parallel(thunks): thunks[${i}] is not a function`)
              }
              try {
                return await t()
              } catch (err) {
                if (controller.signal.aborted) throw err
                return null
              }
            })()
          )
        )
      }

      // --- API: pipeline (no barrier between stages) --------------------
      const pipeline = async (
        items: unknown[],
        ...stages: Array<(prev: unknown, original: unknown, index: number) => Promise<unknown>>
      ): Promise<unknown[]> => {
        if (!Array.isArray(items)) {
          throw new TypeError('pipeline(items, ...stages): items must be an array')
        }
        if (stages.length === 0) return [...items]
        return Promise.all(
          items.map(async (item, index) => {
            let value: unknown = item
            for (const stage of stages) {
              if (typeof stage !== 'function') {
                throw new TypeError('pipeline: every stage must be a function')
              }
              try {
                value = await stage(value, item, index)
              } catch (err) {
                if (controller.signal.aborted) throw err
                // Stage rejection drops the item to null and skips the
                // remaining stages — same shape as parallel().
                return null
              }
            }
            return value
          })
        )
      }

      // --- API: workflow (B4: named workflow invocation) ----------------
      // The child workflow runs as a separate runWorkflow with its own
      // runId + budget but shares the parent's progress callback (so its
      // agents flow into the same UI) and signal (so a parent abort
      // cancels the child). Nesting depth is 1: a child calling
      // workflow() throws via the same path.
      const currentDepth = input.nestingDepth ?? 0
      const workflowApi = async (
        nameOrRef: string | { scriptPath: string },
        childArgs?: unknown
      ): Promise<unknown> => {
        if (currentDepth >= 1) {
          throw new Error('workflow(): nesting is one level only')
        }
        if (!deps.loadNamedWorkflow) {
          throw new Error('workflow(): no library loader injected (set deps.loadNamedWorkflow)')
        }
        const name =
          typeof nameOrRef === 'string'
            ? nameOrRef
            : nameOrRef && typeof nameOrRef === 'object' && 'scriptPath' in nameOrRef
            ? `scriptPath:${nameOrRef.scriptPath}`
            : ''
        if (!name) throw new Error('workflow(): name or {scriptPath} required')
        const source = await deps.loadNamedWorkflow(name)
        if (!source || typeof source !== 'string') {
          throw new Error(`workflow(): no script for "${name}"`)
        }
        const child = runWorkflow(
          {
            script: source,
            args: childArgs,
            signal: controller.signal,
            concurrencyCap,
            budgetTotal:
              budgetTotal === null ? null : Math.max(0, budgetTotal - budgetTracker.spent()),
            nestingDepth: currentDepth + 1
          },
          deps
        )
        const result = await child.promise
        // Roll the child's per-tier spend into the parent so byTier sees
        // both. The child's tracker reports cheap/pro/unknown buckets.
        for (const [tierName, tokens] of Object.entries(result.budget.byTier ?? {})) {
          if (tokens > 0) {
            // Record without re-running tierOfModel — we already have the bucket.
            budgetTracker.record(
              tierName === 'cheap' ? 'cheap' : tierName === 'pro' ? 'pro' : 'unknown',
              tokens
            )
          }
        }
        runAgentCount += result.agentCount
        return result.output
      }

      const memoryApi = Object.freeze({
        list: async (filter?: unknown): Promise<unknown[]> => {
          if (!deps.memory) throw new Error('memory.list(): no memory API injected')
          const result = await deps.memory.list(filter)
          return Array.isArray(result) ? result : []
        },
        write: async (input: unknown): Promise<unknown> => {
          if (!deps.memory) throw new Error('memory.write(): no memory API injected')
          return deps.memory.write(input)
        },
        delete: async (name: string): Promise<unknown> => {
          if (!deps.memory) throw new Error('memory.delete(): no memory API injected')
          if (typeof name !== 'string' || !name.trim()) {
            throw new TypeError('memory.delete(name): name must be a non-empty string')
          }
          return deps.memory.delete(name.trim())
        }
      })

      // --- Sandbox build ------------------------------------------------
      const sandbox: Record<string, unknown> = Object.create(null)
      sandbox.agent = agent
      sandbox.parallel = parallel
      sandbox.pipeline = pipeline
      sandbox.phase = phase
      sandbox.log = log
      sandbox.workflow = workflowApi
      sandbox.memory = memoryApi
      sandbox.args = input.args
      sandbox.budget = budgetApi
      // Standard library subset — JS built-ins the script can use safely.
      sandbox.JSON = JSON
      sandbox.Math = Math
      sandbox.Promise = Promise
      sandbox.Array = Array
      sandbox.Object = Object
      sandbox.String = String
      sandbox.Number = Number
      sandbox.Boolean = Boolean
      sandbox.Map = Map
      sandbox.Set = Set
      sandbox.console = {
        log: (...msg: unknown[]) => log(msg.map(String).join(' '))
      }
      // Timer functions: workflows need these for delays inside agent() loops.
      // setTimeout/clearTimeout are deterministic enough — the journal records
      // call sequence, not wall-clock arrival times.
      sandbox.setTimeout = setTimeout
      sandbox.clearTimeout = clearTimeout
      sandbox.setImmediate = setImmediate
      sandbox.clearImmediate = clearImmediate
      Object.freeze(sandbox.budget)
      // Deliberately omitted: Date.now / Math.random / new Date() are blocked
      // higher up in the script preamble (would break resume / journaling).
      sandbox.__metaAssigned = parsed.meta

      const ctx = vm.createContext(sandbox, {
        name: `workflow:${meta.name}`
      })

      // Wrap the body in an async IIFE so top-level `await` works. Capture
      // the return value as the workflow output.
      // Block Date.now, Math.random, new Date() per the plan invariants —
      // these would break journaling/resume. The block is at sandbox level
      // so we shadow the deps before the body runs.
      const wrapped = `
        (async () => {
          const meta = __metaAssigned;
          // Block clocks/randomness per plan invariants — these would break
          // workflow journaling/resume. Stamping happens after the workflow
          // returns; randomness should come from the agent label/index.
          const __dateBlock = () => { throw new Error('workflow: Date.now / new Date() are blocked inside workflows; pass timestamps via args'); };
          const __randomBlock = () => { throw new Error('workflow: Math.random() is blocked inside workflows; vary inputs by index'); };
          const Date = new Proxy(function(){ throw new Error('workflow: new Date() is blocked'); }, {
            get(_t, p) { if (p === 'now') return __dateBlock; return undefined; },
            construct() { __dateBlock(); }
          });
          Math.random = __randomBlock;
          ${parsed.body}
        })()
      `

      const script = new vm.Script(wrapped, { filename: `workflow:${meta.name}` })
      const scriptPromise = script.runInContext(ctx, { timeout: timeoutMs }) as Promise<unknown>
      // Race the script promise against an abort listener so handle.abort()
      // immediately rejects the outer await even when the script body is
      // waiting on a setTimeout (which vm can't cancel from the outside).
      const abortPromise = new Promise<never>((_resolve, reject) => {
        if (controller.signal.aborted) {
          reject(new WorkflowAbortError(timedOut ? `workflow timed out after ${timeoutMs} ms` : undefined))
          return
        }
        controller.signal.addEventListener(
          'abort',
          () => reject(new WorkflowAbortError(timedOut ? `workflow timed out after ${timeoutMs} ms` : undefined)),
          { once: true }
        )
      })
      // Swallow the script's promise after we hand control to the race —
      // otherwise an unhandled rejection slips out if the script body itself
      // rejects after we've already abort-rejected.
      scriptPromise.catch(() => {})
      const workflowOutput = await Promise.race([scriptPromise, abortPromise])

      const durationMs = clock() - startedAt
      const finalBudget: WorkflowBudgetSnapshot = {
        total: budgetTotal,
        spent: budgetTracker.spent(),
        remaining: budgetTracker.remaining(),
        byTier: budgetTracker.byTier()
      }
      emit({
        runId,
        kind: 'finished',
        durationMs,
        finalResult: workflowOutput
      })
      if (journalPath) {
        const finishRecord: FinishJournalRecord = {
          type: 'finished',
          finishedAt: clock(),
          agentCount: runAgentCount,
          payload: JSON.stringify(workflowOutput)
        }
        try {
          appendJournalRecord(journalPath, finishRecord)
        } catch (err) {
          console.error('[workflow-runner] journal finish append failed (continuing):', err)
        }
      }
      return {
        runId,
        meta,
        output: workflowOutput,
        durationMs,
        agentCount: runAgentCount,
        budget: finalBudget
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (deps.progress) {
        try {
          deps.progress({ runId, kind: 'errored', error: message })
        } catch (notifyErr) {
          console.error('[workflow-runner] errored progress threw (continuing):', notifyErr)
        }
      }
      if (journalPath) {
        try {
          const failureRecord: FinishJournalRecord = {
            type: controller.signal.aborted ? 'aborted' : 'errored',
            finishedAt: clock(),
            agentCount: runAgentCount,
            payload: message
          }
          appendJournalRecord(journalPath, failureRecord)
        } catch (jerr) {
          console.error('[workflow-runner] journal failure append failed (continuing):', jerr)
        }
      }
      if (controller.signal.aborted && !(err instanceof WorkflowAgentCapError)) {
        throw new WorkflowAbortError(timedOut ? `workflow timed out after ${timeoutMs} ms` : undefined)
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  })()

  return { runId, abort, promise }
}
