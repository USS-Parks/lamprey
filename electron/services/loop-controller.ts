import * as store from './loop-store'
import { getLoopTurnRunner } from './loop-runner'
import { recordEvent, boundedJsonPreview } from './event-log'
import { gcSpillDir } from './tool-result-spill'
import { readLoopConfig } from './loop-config'
import { BrowserWindow } from 'electron'
import type {
  Loop,
  LoopStatus,
  BacklogItem,
  BacklogStatus,
  LoopRun
} from './loop-store'

// Loop Phase LP-3 — the loop controller. Owns the per-iteration lifecycle:
// pre-flight ceilings → pull next backlog item → run a turn → record + advance
// → schedule next or stop. The CORE (`runLoopIteration`) takes an injected
// store + runTurn seam so its ceiling / stop-authority logic is unit-tested as
// pure logic that ACTUALLY RUNS (no DB, no native binding, no skip). The pure
// helpers below are tested directly.
//
// LP-3 implements interval mode + all ceilings + stop authorities. Self-paced
// (LP-4) and autonomous (LP-5) extend `computeNextFire` + the backlog-empty
// handling; they reuse this same core.

export const DEFAULT_INTERVAL_SECONDS = 300
export const MIN_INTERVAL_SECONDS = 30 // runaway floor (LP-7 makes it a setting)
export const DEFAULT_ITERATION_TIMEOUT_MS = 10 * 60_000 // per-iteration wall-clock budget
const SPILL_GC_THROTTLE_MS = 60 * 60_000 // GC spill dir at most hourly while loops run

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable, no DB)
// ---------------------------------------------------------------------------

export interface CeilingDecision {
  stop: boolean
  status?: LoopStatus
  reason?: string
}

/**
 * Hard ceilings. Checked BEFORE an iteration (so a loop that already hit a cap
 * never runs another turn) and AFTER (so the cap that the just-finished turn
 * crossed stops the loop). Returns `{stop:false}` when the loop may continue.
 */
export function checkCeilings(
  loop: Pick<
    Loop,
    'iteration' | 'maxIterations' | 'maxWallclockMs' | 'tokenBudget' | 'tokensUsed' | 'startedAt'
  >,
  now: number
): CeilingDecision {
  if (loop.maxIterations != null && loop.iteration >= loop.maxIterations) {
    return { stop: true, status: 'done', reason: 'max-iterations' }
  }
  if (
    loop.maxWallclockMs != null &&
    loop.startedAt != null &&
    now - loop.startedAt >= loop.maxWallclockMs
  ) {
    return { stop: true, status: 'done', reason: 'max-wallclock' }
  }
  if (loop.tokenBudget != null && loop.tokenBudget > 0 && loop.tokensUsed >= loop.tokenBudget) {
    return { stop: true, status: 'done', reason: 'token-budget' }
  }
  return { stop: false }
}

/**
 * When the next iteration should fire. Interval mode = now + interval (clamped
 * to the runaway floor). Self-paced (LP-4) defers to the model's schedule, so a
 * short default keeps the loop alive until then. Autonomous (LP-5) fires
 * promptly while the backlog has work.
 */
export function computeNextFire(
  loop: Pick<Loop, 'mode' | 'intervalSeconds'>,
  now: number,
  minIntervalSeconds: number = MIN_INTERVAL_SECONDS
): number {
  const floor = Math.max(1, minIntervalSeconds)
  if (loop.mode === 'interval') {
    const secs = Math.max(floor, loop.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS)
    return now + secs * 1000
  }
  if (loop.mode === 'autonomous') {
    // Prompt re-fire, but never faster than the floor (runaway guard).
    return now + floor * 1000
  }
  // self_paced — a default heartbeat; the model's schedule_wakeup (LP-4) sets
  // the real cadence by re-scheduling within the turn.
  const secs = Math.max(floor, loop.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS)
  return now + secs * 1000
}

/** Rough token estimate (~4 chars/token). Real usage accounting is approximate
 *  in v1; iteration + wall-clock caps are the hard guards. */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

export interface LedgerInfo {
  iteration: number
  remaining: number
  /** Recently-completed tasks + their outcomes — the idempotency ledger. */
  completed?: Array<{ task: string; result: string | null }>
}

/** Cap on how much ledger text we inject, so a long-running loop's prompt
 *  stays bounded regardless of how many tasks it has completed. */
export const LEDGER_RESULT_MAX_CHARS = 240

/**
 * The per-iteration prompt: the loop's standing instruction + the current task
 * + a progress ledger. The ledger lists recently-completed tasks with their
 * outcomes so the model does not redo settled work (idempotency). For
 * autonomous loops it also reminds the model it may enqueue follow-up work and
 * declare the mission complete when nothing remains.
 */
export function buildIterationPrompt(
  loop: Pick<Loop, 'instruction' | 'mode'>,
  item: BacklogItem | null,
  ledger: LedgerInfo
): string {
  const parts: string[] = []
  if (loop.instruction?.trim()) parts.push(loop.instruction.trim())
  parts.push(
    `Loop iteration ${ledger.iteration}. ${ledger.remaining} task(s) remain in the backlog after this one.`
  )
  if (ledger.completed && ledger.completed.length > 0) {
    const lines = ledger.completed.map((c) => {
      const outcome = (c.result ?? '').trim().slice(0, LEDGER_RESULT_MAX_CHARS)
      return `- ${c.task}${outcome ? ` → ${outcome}` : ' → (done)'}`
    })
    parts.push(`Already done (do NOT repeat):\n${lines.join('\n')}`)
  }
  if (item) parts.push(`Current task:\n${item.task}`)
  const tail = [
    'Complete this task, then call loop_complete_task with a one-line outcome.'
  ]
  if (loop.mode === 'autonomous') {
    tail.push(
      'If you discover follow-up work, add it with loop_enqueue. When nothing worthwhile remains, call loop_control with action "mission_complete".'
    )
  }
  parts.push(tail.join(' '))
  return parts.join('\n\n')
}

// ---------------------------------------------------------------------------
// Injected seams
// ---------------------------------------------------------------------------

export interface LoopStoreSeam {
  getLoop(id: string): Loop | null
  updateLoop(id: string, patch: Parameters<typeof store.updateLoop>[1]): Loop | null
  nextBacklogItem(loopId: string): BacklogItem | null
  updateBacklogItem(id: string, patch: Parameters<typeof store.updateBacklogItem>[1]): BacklogItem | null
  countBacklog(loopId: string, status?: BacklogStatus): number
  listRecentDone(loopId: string, limit: number): BacklogItem[]
  recordLoopRun(input: { loopId: string; iteration: number; backlogId?: string | null; startedAt?: number }): LoopRun
  finishLoopRun(id: string, patch: { status: 'running' | 'done' | 'error' | 'timeout'; tokensUsed?: number | null; finishedAt?: number }): LoopRun | null
  listDueLoops(now: number): Loop[]
}

export type LoopTurnFn = (input: {
  conversationId: string
  model: string
  promptBody: string
  signal?: AbortSignal
}) => Promise<{ tokensUsed?: number } | unknown>

export interface LoopIterationDeps {
  store: LoopStoreSeam
  runTurn: LoopTurnFn
  clock?: () => number
  minIntervalSeconds?: number
  /** Per-iteration wall-clock budget (ms). 0/undefined disables the watchdog. */
  iterationTimeoutMs?: number
  emit?: (channel: string, payload: unknown) => void
}

export interface IterationOutcome {
  ran: boolean
  stopped: boolean
  reason?: string
  error?: string
  timedOut?: boolean
}

function tokensFrom(result: unknown): number {
  if (result && typeof result === 'object' && 'tokensUsed' in result) {
    const t = (result as { tokensUsed?: unknown }).tokensUsed
    if (typeof t === 'number' && Number.isFinite(t)) return t
  }
  return 0
}

// ---------------------------------------------------------------------------
// Core iteration (pure-logic, injected deps)
// ---------------------------------------------------------------------------

export async function runLoopIteration(
  loop: Loop,
  deps: LoopIterationDeps
): Promise<IterationOutcome> {
  const now = () => (deps.clock ?? Date.now)()
  const emit = deps.emit ?? (() => {})

  // 1. Pre-flight ceilings — never run a turn past a cap.
  const pre = checkCeilings(loop, now())
  if (pre.stop) {
    deps.store.updateLoop(loop.id, { status: pre.status, stopReason: pre.reason, nextFireAt: null })
    emit('loop:stopped', { id: loop.id, reason: pre.reason })
    return { ran: false, stopped: true, reason: pre.reason }
  }

  // 2. Pull the next backlog item.
  const item = deps.store.nextBacklogItem(loop.id)
  if (!item) {
    deps.store.updateLoop(loop.id, {
      status: 'done',
      stopReason: 'backlog-empty',
      nextFireAt: null
    })
    emit('loop:stopped', { id: loop.id, reason: 'backlog-empty' })
    return { ran: false, stopped: true, reason: 'backlog-empty' }
  }

  // 3. Mark in-progress + open a run audit row.
  const startedAt = now()
  deps.store.updateBacklogItem(item.id, { status: 'in_progress', startedAt })
  const nextIteration = loop.iteration + 1
  const run = deps.store.recordLoopRun({
    loopId: loop.id,
    iteration: nextIteration,
    backlogId: item.id,
    startedAt
  })

  // 4. Build the iteration prompt (instruction + task + ledger). The current
  // item is already marked in_progress above, so the pending count is exactly
  // the number of tasks remaining AFTER this one.
  const remainingAfter = deps.store.countBacklog(loop.id, 'pending')
  const completed = deps.store
    .listRecentDone(loop.id, 5)
    .map((c) => ({ task: c.task, result: c.result }))
  const prompt = buildIterationPrompt(loop, item, {
    iteration: nextIteration,
    remaining: remainingAfter,
    completed
  })
  emit('loop:iteration:start', { id: loop.id, iteration: nextIteration, backlogId: item.id })

  // 5. Run the turn under a per-iteration stall watchdog. If the turn exceeds
  // the wall-clock budget, abort it via the signal and treat it as a timeout —
  // the item is marked error so the loop advances rather than wedging.
  const iterationTimeoutMs = deps.iterationTimeoutMs ?? 0
  const watchdog = new AbortController()
  let timedOut = false
  const watchdogTimer =
    iterationTimeoutMs > 0
      ? setTimeout(() => {
          timedOut = true
          watchdog.abort()
        }, iterationTimeoutMs)
      : null
  try {
    const result = await deps.runTurn({
      conversationId: loop.conversationId,
      model: loop.model ?? 'deepseek-v4-pro',
      promptBody: prompt,
      signal: watchdog.signal
    })
    const turnTokens = tokensFrom(result)
    const finishedAt = now()
    deps.store.finishLoopRun(run.id, { status: 'done', tokensUsed: turnTokens, finishedAt })
    deps.store.updateBacklogItem(item.id, { status: 'done', finishedAt })

    const newTokens = loop.tokensUsed + turnTokens
    const advanced: Loop = {
      ...loop,
      iteration: nextIteration,
      tokensUsed: newTokens
    }

    // 6a. Backlog drained → done.
    if (deps.store.countBacklog(loop.id, 'pending') === 0) {
      deps.store.updateLoop(loop.id, {
        iteration: nextIteration,
        tokensUsed: newTokens,
        lastIterationAt: finishedAt,
        status: 'done',
        stopReason: 'backlog-empty',
        nextFireAt: null
      })
      emit('loop:iteration:done', { id: loop.id, iteration: nextIteration })
      emit('loop:stopped', { id: loop.id, reason: 'backlog-empty' })
      return { ran: true, stopped: true, reason: 'backlog-empty' }
    }

    // 6b. Post-iteration ceilings (the cap this turn just crossed).
    const post = checkCeilings(advanced, now())
    if (post.stop) {
      deps.store.updateLoop(loop.id, {
        iteration: nextIteration,
        tokensUsed: newTokens,
        lastIterationAt: finishedAt,
        status: post.status,
        stopReason: post.reason,
        nextFireAt: null
      })
      emit('loop:iteration:done', { id: loop.id, iteration: nextIteration })
      emit('loop:stopped', { id: loop.id, reason: post.reason })
      return { ran: true, stopped: true, reason: post.reason }
    }

    // 6c. The model may have changed loop state DURING the turn via
    // loop_control (pause / stop / mission_complete, or continue to set a
    // self-paced cadence). Re-read before scheduling so we never resurrect a
    // loop the model just terminated.
    const fresh = deps.store.getLoop(loop.id)
    if (fresh && fresh.status !== 'running') {
      deps.store.updateLoop(loop.id, {
        iteration: nextIteration,
        tokensUsed: newTokens,
        lastIterationAt: finishedAt
      })
      emit('loop:iteration:done', { id: loop.id, iteration: nextIteration })
      emit('loop:stopped', { id: loop.id, reason: fresh.stopReason ?? fresh.status })
      return { ran: true, stopped: true, reason: fresh.stopReason ?? fresh.status }
    }

    // Continue — schedule the next iteration. Self-paced honours a future
    // next-fire the model set this turn; otherwise the per-mode default.
    let nextFire = computeNextFire(loop, now(), deps.minIntervalSeconds)
    if (loop.mode === 'self_paced' && fresh && fresh.nextFireAt != null && fresh.nextFireAt > now()) {
      nextFire = fresh.nextFireAt
    }
    deps.store.updateLoop(loop.id, {
      iteration: nextIteration,
      tokensUsed: newTokens,
      lastIterationAt: finishedAt,
      nextFireAt: nextFire
    })
    emit('loop:iteration:done', { id: loop.id, iteration: nextIteration })
    return { ran: true, stopped: false }
  } catch (err) {
    const finishedAt = now()
    if (timedOut) {
      // Watchdog tripped — record the run as a timeout, mark the item error,
      // and advance (the iteration counter still ticks toward maxIterations).
      deps.store.finishLoopRun(run.id, { status: 'timeout', finishedAt })
      deps.store.updateBacklogItem(item.id, {
        status: 'error',
        result: `iteration timed out after ${iterationTimeoutMs} ms`,
        finishedAt
      })
      const nextFire = computeNextFire(loop, now(), deps.minIntervalSeconds)
      deps.store.updateLoop(loop.id, {
        iteration: nextIteration,
        lastIterationAt: finishedAt,
        nextFireAt: nextFire
      })
      emit('loop:iteration:error', { id: loop.id, iteration: nextIteration, error: 'timeout' })
      return { ran: true, stopped: false, error: 'iteration timed out', timedOut: true }
    }
    const msg = err instanceof Error ? err.message : String(err)
    deps.store.finishLoopRun(run.id, { status: 'error', finishedAt })
    deps.store.updateBacklogItem(item.id, { status: 'error', result: msg, finishedAt })
    // A failed iteration marks the item error and advances; the loop keeps
    // going (the iteration counter still ticks toward maxIterations, so a
    // persistently-failing loop can't spin forever). Schedule the next fire.
    const nextFire = computeNextFire(loop, now(), deps.minIntervalSeconds)
    deps.store.updateLoop(loop.id, {
      iteration: nextIteration,
      lastIterationAt: finishedAt,
      nextFireAt: nextFire
    })
    emit('loop:iteration:error', { id: loop.id, iteration: nextIteration, error: msg })
    return { ran: true, stopped: false, error: msg }
  } finally {
    if (watchdogTimer) clearTimeout(watchdogTimer)
  }
}

// ---------------------------------------------------------------------------
// Production wiring (DB-backed deps + 30s timer)
// ---------------------------------------------------------------------------

function emitToAll(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

function productionDeps(): LoopIterationDeps {
  return {
    store: {
      getLoop: store.getLoop,
      updateLoop: store.updateLoop,
      nextBacklogItem: store.nextBacklogItem,
      updateBacklogItem: store.updateBacklogItem,
      countBacklog: store.countBacklog,
      listRecentDone: store.listRecentDone,
      recordLoopRun: store.recordLoopRun,
      finishLoopRun: store.finishLoopRun,
      listDueLoops: store.listDueLoops
    },
    runTurn: async (input) => {
      const runner = getLoopTurnRunner()
      if (!runner) throw new Error('loop turn runner not wired')
      const result = await runner({
        conversationId: input.conversationId,
        model: input.model,
        promptBody: input.promptBody
      })
      // runHeadlessTurn returns a context-aware { tokensEstimate } counting the
      // full sent message stack (system prompt + history + prompt) plus reply —
      // prefer it over the prompt-only fallback below.
      if (
        result &&
        typeof result === 'object' &&
        typeof (result as { tokensEstimate?: unknown }).tokensEstimate === 'number'
      ) {
        return { tokensUsed: (result as { tokensEstimate: number }).tokensEstimate }
      }
      const replyText = ((): string => {
        try {
          return JSON.stringify(result ?? '')
        } catch {
          return ''
        }
      })()
      return { tokensUsed: estimateTokens(input.promptBody) + estimateTokens(replyText) }
    },
    iterationTimeoutMs: DEFAULT_ITERATION_TIMEOUT_MS,
    minIntervalSeconds: readLoopConfig().minIntervalSeconds,
    emit: emitToAll
  }
}

let lastSpillGcAt = 0

/** Bound the spill dir during long-running loop sessions (the app-startup GC
 *  won't run again until restart). Throttled to hourly, best-effort. */
function maybeGcSpill(now: number): void {
  if (now - lastSpillGcAt < SPILL_GC_THROTTLE_MS) return
  lastSpillGcAt = now
  try {
    gcSpillDir()
  } catch (err) {
    console.error('[loops] spill gc failed:', err)
  }
}

export async function tickLoops(now = Date.now()): Promise<void> {
  // No runner wired → nothing can run; skip quietly (e.g. very early boot).
  if (!getLoopTurnRunner()) return
  const deps = productionDeps()
  const maxConcurrent = readLoopConfig().maxConcurrent
  const due = deps.store.listDueLoops(now).slice(0, Math.max(1, maxConcurrent))
  if (due.length > 0) maybeGcSpill(now)
  for (const loop of due) {
    try {
      const outcome = await runLoopIteration(loop, deps)
      try {
        recordEvent({
          type: outcome.error ? 'loop.iteration.error' : 'loop.iteration',
          actorKind: 'system',
          severity: outcome.error ? 'warning' : 'info',
          conversationId: loop.conversationId,
          entityKind: 'loop',
          entityId: loop.id,
          payload: {
            iteration: loop.iteration + 1,
            ran: outcome.ran,
            stopped: outcome.stopped,
            reason: outcome.reason,
            error: outcome.error ? boundedJsonPreview(outcome.error) : undefined
          }
        })
      } catch (e) {
        console.error('[loops] iteration event write failed:', e)
      }
    } catch (err) {
      console.error('[loops] iteration failed:', err)
    }
  }
}

let controllerTimer: NodeJS.Timeout | null = null

export function startLoopController(): void {
  if (controllerTimer) return
  const tick = (): void => {
    void tickLoops().catch((err) => console.error('[loops] controller tick failed:', err))
  }
  tick()
  controllerTimer = setInterval(tick, 30_000)
}

export function stopLoopController(): void {
  if (!controllerTimer) return
  clearInterval(controllerTimer)
  controllerTimer = null
}
