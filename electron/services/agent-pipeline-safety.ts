// CR-2 (Cogency Restore Phase, 2026-06-09) — abort-safe rollback + stall
// detection for the multi-agent pipeline.
//
// The LL_SMOKE_PLAYBOOK exposed two destructive failure modes on the
// `runAgentPipeline` (multi-agent) path:
//
//   * F2 (Ask 7 v0.11.0)  — Coder mutated 7 files, Reviewer threw partway
//     through, pipeline terminated WITHOUT firing the Composer wrap-up and
//     WITHOUT any user-visible chat message. The user was left with broken
//     files on disk and an idle-looking chat.
//   * F15 (Ask 6 v0.11.1) — Coder scaffolded a Vite project, started slice
//     creation, and the pipeline went silent at ~54 tool calls. No stage
//     threw — it just stopped responding. Same outcome: mutations on disk,
//     no user-visible reply.
//
// Both failures share a property: the pipeline bailed AFTER mutations
// landed but BEFORE the Composer wrote a user-visible reply. The safety
// helper here detects that condition in a `finally` block and synthesises
// a `role:'system'` message naming the modified paths so the user has a
// clear `git restore` / `git stash` target.
//
// This module is pure logic — it does not touch the message persistence
// layer directly; it returns a `ClosureAction` that the chat layer
// translates into a `saveMessage` + emitter call. Pure logic = trivial
// to unit-test (`agent-pipeline-safety.test.ts`).

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

export type PipelineStage = 'planner' | 'coder' | 'reviewer' | 'composer'

/** Why the pipeline stopped at the given highest-reached stage. */
export type TerminationReason =
  | 'normal'     // composer ran clean — happy path, helper is a no-op
  | 'thrown'    // a stage caught an unrecoverable error
  | 'stalled'   // F15 — stage emitted no activity for stageInactivityMs
  | 'cancelled' // user-initiated abort (signal aborted before anything mutated)

/** What the safety helper decided to do for this turn. */
export type ClosureAction =
  | { kind: 'none'; reason: string }
  | {
      kind: 'synthesize-system-message'
      reason: string
      stage: PipelineStage
      terminationReason: TerminationReason
      mutatedPaths: readonly string[]
      messageText: string
    }

export interface EvaluateClosureInput {
  /** The highest stage the pipeline reached before stopping. */
  highestReachedStage: PipelineStage
  /** What caused the pipeline to stop. */
  terminationReason: TerminationReason
  /** File paths the Coder mutated this turn (from MutationTracker.diff). */
  mutatedPaths: readonly string[]
}

/**
 * Pure decision function. Given the three signals above, decide whether the
 * chat layer should synthesise a user-visible system message, and what it
 * should say. No side effects.
 *
 * Decision rule:
 *   - terminationReason === 'normal' → no action (happy path)
 *   - mutatedPaths is empty            → no action (nothing to surface)
 *   - otherwise                        → synthesise a `role:'system'` message
 *
 * The "no system message on zero mutations" branch is deliberate: a read-only
 * investigation turn that throws or stalls is annoying but not destructive,
 * and a synthesised system message there would be noise. We only surface
 * the safety net when the user might lose work.
 */
export function evaluateClosure(input: EvaluateClosureInput): ClosureAction {
  if (input.terminationReason === 'normal') {
    return { kind: 'none', reason: 'pipeline reached composer cleanly' }
  }
  if (input.mutatedPaths.length === 0) {
    return {
      kind: 'none',
      reason: `pipeline ${input.terminationReason} at ${input.highestReachedStage} but no mutations to surface`
    }
  }
  const reason = input.terminationReason
  const stage = input.highestReachedStage
  const messageText = buildAbortMessageText({
    stage,
    terminationReason: reason,
    mutatedPaths: input.mutatedPaths
  })
  return {
    kind: 'synthesize-system-message',
    reason: `pipeline ${reason} at ${stage} with ${input.mutatedPaths.length} mutated file(s)`,
    stage,
    terminationReason: reason,
    mutatedPaths: input.mutatedPaths,
    messageText
  }
}

/**
 * Pure formatter for the synthesised system message. Locked by snapshot
 * test so future changes are deliberate.
 */
export function buildAbortMessageText(input: {
  stage: PipelineStage
  terminationReason: TerminationReason
  mutatedPaths: readonly string[]
}): string {
  const reasonLabel: Record<TerminationReason, string> = {
    normal: 'completed',
    thrown: 'errored',
    stalled: 'stalled',
    cancelled: 'was cancelled'
  }
  const pathLines = input.mutatedPaths.map((p) => `  - ${p}`).join('\n')
  const count = input.mutatedPaths.length
  return [
    `Multi-agent turn ${reasonLabel[input.terminationReason]} at the ${input.stage} stage.`,
    `${count} file${count === 1 ? '' : 's'} ${count === 1 ? 'was' : 'were'} modified before the turn aborted:`,
    pathLines,
    '',
    "Reply 'revert' to restore, or 'continue' to let me try recovery."
  ].join('\n')
}

/**
 * Best-effort mutation tracker. Snapshots `git status --porcelain` at the
 * start of the Coder stage, then again on demand. The diff is the set of
 * paths whose status changed (new file, modified file, etc.) — that's a
 * conservative superset of "files the Coder mutated this turn."
 *
 * If git isn't available (no .git, git binary missing, non-zero exit), the
 * tracker silently degrades to an empty set. The closure helper handles
 * that case by suppressing the system message (no paths to surface →
 * no action).
 */
export class MutationTracker {
  private readonly cwd: string
  private snapshotAtStart: Map<string, string> = new Map()
  private snapshotTaken = false

  constructor(cwd: string) {
    this.cwd = cwd
  }

  /** Capture the pre-state. Idempotent — first call wins. */
  snapshot(): void {
    if (this.snapshotTaken) return
    this.snapshotTaken = true
    this.snapshotAtStart = readGitStatus(this.cwd)
  }

  /** Return paths that have a different status now vs. the snapshot. */
  diff(): string[] {
    if (!this.snapshotTaken) return []
    const now = readGitStatus(this.cwd)
    const out = new Set<string>()
    for (const [path, code] of now) {
      if (this.snapshotAtStart.get(path) !== code) out.add(path)
    }
    // Also include files that existed in the snapshot but are gone now
    // (deletions that aren't in `now` because porcelain dropped them).
    for (const [path] of this.snapshotAtStart) {
      if (!now.has(path)) out.add(path)
    }
    return [...out].sort()
  }
}

function readGitStatus(cwd: string): Map<string, string> {
  try {
    const stdout = execFileSync('git', ['status', '--porcelain'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 5_000
    })
    const out = new Map<string, string>()
    for (const line of stdout.split('\n')) {
      if (line.length < 4) continue
      const code = line.slice(0, 2)
      const path = line.slice(3).trim()
      if (path) out.set(path, code)
    }
    return out
  } catch {
    // No git, no repo, timeout, or any other failure → return empty.
    // The closure helper will suppress the system message in that case.
    return new Map()
  }
}

/**
 * Per-stage inactivity watchdog (F15). When the pipeline starts a stage we
 * call `armStage(role)`. As long as activity events fire (tool calls
 * completing, model chunks streaming), the chat layer calls `kick()` to
 * reset the timer. If `stageInactivityMs` elapses without a kick, `onStall`
 * fires once and the watchdog disarms. Multiple `armStage` calls in
 * sequence (one stage following another) are supported — the timer resets
 * on each `armStage`.
 *
 * Default `stageInactivityMs` is 0 (disabled) so existing tests don't
 * regress; chat.ts opts in by passing a positive number from
 * `settings.stageInactivityMs`.
 */
export class StageInactivityWatchdog {
  private timer: ReturnType<typeof setTimeout> | null = null
  private currentStage: PipelineStage | null = null
  private fired = false

  constructor(
    private readonly inactivityMs: number,
    private readonly onStall: (stage: PipelineStage) => void
  ) {}

  armStage(stage: PipelineStage): void {
    this.currentStage = stage
    this.kick()
  }

  kick(): void {
    if (this.inactivityMs <= 0) return
    if (this.fired) return
    if (this.timer) clearTimeout(this.timer)
    const stage = this.currentStage
    if (!stage) return
    this.timer = setTimeout(() => {
      this.fired = true
      this.timer = null
      try {
        this.onStall(stage)
      } catch {
        // Stall handler must not propagate — pipeline finally{} owns recovery.
      }
    }, this.inactivityMs)
  }

  disarm(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.currentStage = null
  }

  /** Test helper — has the watchdog fired this run? */
  hasFired(): boolean {
    return this.fired
  }
}

// ---------------------------------------------------------------------------
// withPipelineSafety — the wrapper called from chat.ts at the multi-agent
// dispatch site (~chat.ts:609). It captures the pre-state, runs the pipeline
// inside a try/finally, computes the closure action, and uses the supplied
// callbacks to persist the synthesised system message (if any).
// ---------------------------------------------------------------------------

export interface SystemMessagePayload {
  conversationId: string
  text: string
  mutatedPaths: readonly string[]
  stage: PipelineStage
  terminationReason: TerminationReason
}

export interface WithPipelineSafetyOptions {
  conversationId: string
  workspacePath: string
  /** When > 0, a stage-inactivity watchdog is wired (F15). */
  stageInactivityMs?: number
  /** Persist callback the wrapper calls with the synthesised message text. */
  persistSystemMessage: (payload: SystemMessagePayload) => void
  /** The pipeline run, invoked once with the wrapper's hooks bound. */
  runPipeline: (hooks: {
    mutationTracker: MutationTracker
    watchdog: StageInactivityWatchdog
    /** Update the "highest reached stage" cursor as stages complete. */
    reachedStage: (stage: PipelineStage) => void
  }) => Promise<void>
}

export interface WithPipelineSafetyResult {
  /** What the closure helper decided. Useful for tests and telemetry. */
  closureAction: ClosureAction
  /** The error the pipeline threw, if any. */
  thrownError: unknown
  /** Whether the inactivity watchdog fired. */
  stalled: boolean
  /** The highest stage that completed (or 'planner' if nothing did). */
  highestReachedStage: PipelineStage
}

/**
 * The wrapper. Always runs the closure helper in `finally` regardless of how
 * the inner pipeline terminates. The chat layer threads the callbacks; the
 * wrapper owns the order-of-operations (snapshot → run → diff → evaluate →
 * persist).
 */
export async function withPipelineSafety(
  opts: WithPipelineSafetyOptions
): Promise<WithPipelineSafetyResult> {
  const tracker = new MutationTracker(opts.workspacePath)
  // Tracked by closure inside runPipeline; TS' control-flow analysis can't
  // see through the closure, so we hold it in a box to keep the union type.
  const stageBox: { value: PipelineStage } = { value: 'planner' }
  let stalled = false
  let stalledStage: PipelineStage | null = null

  const watchdog = new StageInactivityWatchdog(opts.stageInactivityMs ?? 0, (stage) => {
    stalled = true
    stalledStage = stage
  })

  const reachedStage = (stage: PipelineStage): void => {
    stageBox.value = stage
  }

  // Snapshot before anything runs so the Coder's mutations are detectable.
  tracker.snapshot()

  let thrownError: unknown = undefined
  try {
    await opts.runPipeline({ mutationTracker: tracker, watchdog, reachedStage })
  } catch (err) {
    thrownError = err
  } finally {
    watchdog.disarm()
  }

  // Decide the termination reason.
  let terminationReason: TerminationReason
  if (stalled) {
    terminationReason = 'stalled'
    if (stalledStage) stageBox.value = stalledStage
  } else if (thrownError) {
    terminationReason = 'thrown'
  } else if (stageBox.value === 'composer') {
    terminationReason = 'normal'
  } else {
    // Pipeline returned without throwing but didn't reach composer — treat
    // as thrown so the closure helper surfaces any mutations.
    terminationReason = 'thrown'
  }

  const highestReachedStage = stageBox.value
  const mutatedPaths = tracker.diff()
  const closureAction = evaluateClosure({
    highestReachedStage,
    terminationReason,
    mutatedPaths
  })

  if (closureAction.kind === 'synthesize-system-message') {
    opts.persistSystemMessage({
      conversationId: opts.conversationId,
      text: closureAction.messageText,
      mutatedPaths: closureAction.mutatedPaths,
      stage: closureAction.stage,
      terminationReason: closureAction.terminationReason
    })
  }

  return {
    closureAction,
    thrownError,
    stalled,
    highestReachedStage
  }
}

// Re-export for callers that want a unique id (e.g. when persisting a row).
// Re-export here so chat.ts doesn't need to import from 'node:crypto' just
// for the system-message id.
export function newSystemMessageId(): string {
  return randomUUID()
}
