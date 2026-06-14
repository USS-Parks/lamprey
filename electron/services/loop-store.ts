import { randomUUID } from 'crypto'
import { getDb } from './database'

// Loop Phase LP-2 — persistence for the recurring loop entity, its dedicated
// backlog queue, and the per-iteration run audit. Tables are created by
// migration v17 (db-migrations.ts). This module is the single SQL surface for
// loops; the controller (LP-3) and IPC (LP-7) call these functions only.
//
// Distinct from `loop-runner.ts` (the one-shot self-paced wake-up mechanism).
// A loop OWNS wake-ups as its cadence in self-paced mode; the entity here is
// the recurring controller state.

export type LoopMode = 'interval' | 'self_paced' | 'autonomous'
export type LoopStatus = 'running' | 'paused' | 'stopped' | 'done' | 'error'
export type BacklogStatus = 'pending' | 'in_progress' | 'done' | 'skipped' | 'error'
export type LoopRunStatus = 'running' | 'done' | 'error' | 'timeout'

export interface Loop {
  id: string
  conversationId: string
  mode: LoopMode
  status: LoopStatus
  instruction: string | null
  model: string | null
  intervalSeconds: number | null
  maxIterations: number | null
  maxWallclockMs: number | null
  tokenBudget: number | null
  iteration: number
  tokensUsed: number
  startedAt: number | null
  lastIterationAt: number | null
  nextFireAt: number | null
  stopReason: string | null
  createdAt: number
  updatedAt: number
}

export interface BacklogItem {
  id: string
  loopId: string
  position: number
  task: string
  status: BacklogStatus
  result: string | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
}

export interface LoopRun {
  id: string
  loopId: string
  iteration: number
  backlogId: string | null
  startedAt: number
  finishedAt: number | null
  status: LoopRunStatus
  tokensUsed: number | null
  createdAt: number
}

export interface CreateLoopInput {
  conversationId: string
  mode: LoopMode
  instruction?: string | null
  model?: string | null
  intervalSeconds?: number | null
  maxIterations?: number | null
  maxWallclockMs?: number | null
  tokenBudget?: number | null
  /** When the first iteration should fire. Defaults to now (immediate). */
  nextFireAt?: number | null
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable without a DB)
// ---------------------------------------------------------------------------

/** Next append position: one past the current max, or 0 for an empty queue. */
export function nextPosition(existingPositions: number[]): number {
  if (existingPositions.length === 0) return 0
  return Math.max(...existingPositions) + 1
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToLoop(row: any): Loop {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    mode: row.mode,
    status: row.status,
    instruction: row.instruction ?? null,
    model: row.model ?? null,
    intervalSeconds: row.interval_seconds ?? null,
    maxIterations: row.max_iterations ?? null,
    maxWallclockMs: row.max_wallclock_ms ?? null,
    tokenBudget: row.token_budget ?? null,
    iteration: row.iteration,
    tokensUsed: row.tokens_used,
    startedAt: row.started_at ?? null,
    lastIterationAt: row.last_iteration_at ?? null,
    nextFireAt: row.next_fire_at ?? null,
    stopReason: row.stop_reason ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function rowToBacklog(row: any): BacklogItem {
  return {
    id: row.id,
    loopId: row.loop_id,
    position: row.position,
    task: row.task,
    status: row.status,
    result: row.result ?? null,
    createdAt: row.created_at,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null
  }
}

function rowToRun(row: any): LoopRun {
  return {
    id: row.id,
    loopId: row.loop_id,
    iteration: row.iteration,
    backlogId: row.backlog_id ?? null,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? null,
    status: row.status,
    tokensUsed: row.tokens_used ?? null,
    createdAt: row.created_at
  }
}

// ---------------------------------------------------------------------------
// Loop CRUD
// ---------------------------------------------------------------------------

export function createLoop(input: CreateLoopInput): Loop {
  const now = Date.now()
  const row = {
    id: randomUUID(),
    conversation_id: input.conversationId,
    mode: input.mode,
    status: 'running' as LoopStatus,
    instruction: input.instruction ?? null,
    model: input.model ?? null,
    interval_seconds: input.intervalSeconds ?? null,
    max_iterations: input.maxIterations ?? null,
    max_wallclock_ms: input.maxWallclockMs ?? null,
    token_budget: input.tokenBudget ?? null,
    iteration: 0,
    tokens_used: 0,
    started_at: now,
    last_iteration_at: null,
    next_fire_at: input.nextFireAt ?? now,
    stop_reason: null,
    created_at: now,
    updated_at: now
  }
  getDb()
    .prepare(
      `INSERT INTO loops
       (id, conversation_id, mode, status, instruction, model, interval_seconds,
        max_iterations, max_wallclock_ms, token_budget, iteration, tokens_used,
        started_at, last_iteration_at, next_fire_at, stop_reason, created_at, updated_at)
       VALUES (@id, @conversation_id, @mode, @status, @instruction, @model, @interval_seconds,
        @max_iterations, @max_wallclock_ms, @token_budget, @iteration, @tokens_used,
        @started_at, @last_iteration_at, @next_fire_at, @stop_reason, @created_at, @updated_at)`
    )
    .run(row)
  return rowToLoop(row)
}

export function getLoop(id: string): Loop | null {
  const row = getDb().prepare('SELECT * FROM loops WHERE id = ?').get(id)
  return row ? rowToLoop(row) : null
}

export function listLoops(filter?: {
  conversationId?: string
  status?: LoopStatus | LoopStatus[]
  limit?: number
}): Loop[] {
  const where: string[] = []
  const params: unknown[] = []
  if (filter?.conversationId) {
    where.push('conversation_id = ?')
    params.push(filter.conversationId)
  }
  if (filter?.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status]
    where.push(`status IN (${statuses.map(() => '?').join(',')})`)
    params.push(...statuses)
  }
  const limit = Math.min(Math.max(filter?.limit ?? 100, 1), 500)
  const sql =
    'SELECT * FROM loops' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY created_at DESC LIMIT ?'
  return getDb()
    .prepare(sql)
    .all(...params, limit)
    .map(rowToLoop)
}

/** Loops eligible to tick: running, with a due (or null) next_fire_at. */
export function listDueLoops(now = Date.now()): Loop[] {
  return getDb()
    .prepare(
      "SELECT * FROM loops WHERE status = 'running' AND (next_fire_at IS NULL OR next_fire_at <= ?) ORDER BY next_fire_at ASC LIMIT 50"
    )
    .all(now)
    .map(rowToLoop)
}

const LOOP_PATCH_COLUMNS: Record<string, string> = {
  status: 'status',
  instruction: 'instruction',
  model: 'model',
  intervalSeconds: 'interval_seconds',
  maxIterations: 'max_iterations',
  maxWallclockMs: 'max_wallclock_ms',
  tokenBudget: 'token_budget',
  iteration: 'iteration',
  tokensUsed: 'tokens_used',
  startedAt: 'started_at',
  lastIterationAt: 'last_iteration_at',
  nextFireAt: 'next_fire_at',
  stopReason: 'stop_reason'
}

export function updateLoop(
  id: string,
  patch: Partial<{
    status: LoopStatus
    instruction: string | null
    model: string | null
    intervalSeconds: number | null
    maxIterations: number | null
    maxWallclockMs: number | null
    tokenBudget: number | null
    iteration: number
    tokensUsed: number
    startedAt: number | null
    lastIterationAt: number | null
    nextFireAt: number | null
    stopReason: string | null
  }>
): Loop | null {
  const sets: string[] = []
  const params: Record<string, unknown> = { id, updated_at: Date.now() }
  for (const [key, col] of Object.entries(LOOP_PATCH_COLUMNS)) {
    if (key in patch) {
      sets.push(`${col} = @${col}`)
      params[col] = (patch as Record<string, unknown>)[key] ?? null
    }
  }
  if (sets.length === 0) return getLoop(id)
  getDb()
    .prepare(`UPDATE loops SET ${sets.join(', ')}, updated_at = @updated_at WHERE id = @id`)
    .run(params)
  return getLoop(id)
}

export function deleteLoop(id: string): boolean {
  const db = getDb()
  const tx = db.transaction((loopId: string) => {
    db.prepare('DELETE FROM loop_backlog WHERE loop_id = ?').run(loopId)
    db.prepare('DELETE FROM loop_runs WHERE loop_id = ?').run(loopId)
    return db.prepare('DELETE FROM loops WHERE id = ?').run(loopId).changes
  })
  return (tx(id) as number) > 0
}

// ---------------------------------------------------------------------------
// Backlog queue
// ---------------------------------------------------------------------------

export function enqueueBacklog(loopId: string, tasks: string[]): BacklogItem[] {
  const db = getDb()
  const existing = (
    db.prepare('SELECT position FROM loop_backlog WHERE loop_id = ?').all(loopId) as {
      position: number
    }[]
  ).map((r) => r.position)
  let pos = nextPosition(existing)
  const now = Date.now()
  const created: BacklogItem[] = []
  const insert = db.prepare(
    `INSERT INTO loop_backlog (id, loop_id, position, task, status, result, created_at, started_at, finished_at)
     VALUES (@id, @loop_id, @position, @task, 'pending', NULL, @created_at, NULL, NULL)`
  )
  const tx = db.transaction(() => {
    for (const task of tasks) {
      const trimmed = task?.trim()
      if (!trimmed) continue
      const row = { id: randomUUID(), loop_id: loopId, position: pos, task: trimmed, created_at: now }
      insert.run(row)
      created.push(rowToBacklog({ ...row, status: 'pending', result: null, started_at: null, finished_at: null }))
      pos += 1
    }
  })
  tx()
  return created
}

/** The running/paused loop for a conversation, if any (most recent). Used by
 *  the model loop-control tools to resolve "the current loop" from ctx. */
export function getActiveLoopForConversation(conversationId: string): Loop | null {
  const row = getDb()
    .prepare(
      "SELECT * FROM loops WHERE conversation_id = ? AND status IN ('running','paused') ORDER BY created_at DESC LIMIT 1"
    )
    .get(conversationId)
  return row ? rowToLoop(row) : null
}

/** The item currently being worked (status='in_progress'), if any. */
export function inProgressBacklogItem(loopId: string): BacklogItem | null {
  const row = getDb()
    .prepare(
      "SELECT * FROM loop_backlog WHERE loop_id = ? AND status = 'in_progress' ORDER BY position ASC LIMIT 1"
    )
    .get(loopId)
  return row ? rowToBacklog(row) : null
}

/** The next item to work: lowest-position pending row. */
export function nextBacklogItem(loopId: string): BacklogItem | null {
  const row = getDb()
    .prepare(
      "SELECT * FROM loop_backlog WHERE loop_id = ? AND status = 'pending' ORDER BY position ASC LIMIT 1"
    )
    .get(loopId)
  return row ? rowToBacklog(row) : null
}

export function listBacklog(loopId: string, status?: BacklogStatus | BacklogStatus[]): BacklogItem[] {
  const where: string[] = ['loop_id = ?']
  const params: unknown[] = [loopId]
  if (status) {
    const statuses = Array.isArray(status) ? status : [status]
    where.push(`status IN (${statuses.map(() => '?').join(',')})`)
    params.push(...statuses)
  }
  return getDb()
    .prepare(`SELECT * FROM loop_backlog WHERE ${where.join(' AND ')} ORDER BY position ASC`)
    .all(...params)
    .map(rowToBacklog)
}

/** Most-recently-finished done items — the progress ledger fed back to the
 *  model each iteration so settled work is not repeated (idempotency seed). */
export function listRecentDone(loopId: string, limit = 5): BacklogItem[] {
  const lim = Math.min(Math.max(limit, 1), 50)
  return getDb()
    .prepare(
      "SELECT * FROM loop_backlog WHERE loop_id = ? AND status = 'done' ORDER BY finished_at DESC LIMIT ?"
    )
    .all(loopId, lim)
    .map(rowToBacklog)
}

export function countBacklog(loopId: string, status?: BacklogStatus): number {
  const sql = status
    ? 'SELECT COUNT(*) AS n FROM loop_backlog WHERE loop_id = ? AND status = ?'
    : 'SELECT COUNT(*) AS n FROM loop_backlog WHERE loop_id = ?'
  const row = (status
    ? getDb().prepare(sql).get(loopId, status)
    : getDb().prepare(sql).get(loopId)) as { n: number }
  return row.n
}

export function updateBacklogItem(
  id: string,
  patch: Partial<{ status: BacklogStatus; result: string | null; startedAt: number | null; finishedAt: number | null }>
): BacklogItem | null {
  const map: Record<string, string> = {
    status: 'status',
    result: 'result',
    startedAt: 'started_at',
    finishedAt: 'finished_at'
  }
  const sets: string[] = []
  const params: Record<string, unknown> = { id }
  for (const [key, col] of Object.entries(map)) {
    if (key in patch) {
      sets.push(`${col} = @${col}`)
      params[col] = (patch as Record<string, unknown>)[key] ?? null
    }
  }
  if (sets.length === 0) {
    const row = getDb().prepare('SELECT * FROM loop_backlog WHERE id = ?').get(id)
    return row ? rowToBacklog(row) : null
  }
  getDb().prepare(`UPDATE loop_backlog SET ${sets.join(', ')} WHERE id = @id`).run(params)
  const row = getDb().prepare('SELECT * FROM loop_backlog WHERE id = ?').get(id)
  return row ? rowToBacklog(row) : null
}

export function reorderBacklog(loopId: string, orderedIds: string[]): void {
  const db = getDb()
  const update = db.prepare('UPDATE loop_backlog SET position = ? WHERE id = ? AND loop_id = ?')
  const tx = db.transaction(() => {
    orderedIds.forEach((id, i) => update.run(i, id, loopId))
  })
  tx()
}

export function removeBacklogItem(id: string): boolean {
  return getDb().prepare('DELETE FROM loop_backlog WHERE id = ?').run(id).changes > 0
}

// ---------------------------------------------------------------------------
// Run audit
// ---------------------------------------------------------------------------

export function recordLoopRun(input: {
  loopId: string
  iteration: number
  backlogId?: string | null
  startedAt?: number
}): LoopRun {
  const now = Date.now()
  const row = {
    id: randomUUID(),
    loop_id: input.loopId,
    iteration: input.iteration,
    backlog_id: input.backlogId ?? null,
    started_at: input.startedAt ?? now,
    finished_at: null,
    status: 'running' as LoopRunStatus,
    tokens_used: null,
    created_at: now
  }
  getDb()
    .prepare(
      `INSERT INTO loop_runs (id, loop_id, iteration, backlog_id, started_at, finished_at, status, tokens_used, created_at)
       VALUES (@id, @loop_id, @iteration, @backlog_id, @started_at, @finished_at, @status, @tokens_used, @created_at)`
    )
    .run(row)
  return rowToRun(row)
}

export function finishLoopRun(
  id: string,
  patch: { status: LoopRunStatus; tokensUsed?: number | null; finishedAt?: number }
): LoopRun | null {
  getDb()
    .prepare('UPDATE loop_runs SET status = ?, tokens_used = ?, finished_at = ? WHERE id = ?')
    .run(patch.status, patch.tokensUsed ?? null, patch.finishedAt ?? Date.now(), id)
  const row = getDb().prepare('SELECT * FROM loop_runs WHERE id = ?').get(id)
  return row ? rowToRun(row) : null
}

export function listLoopRuns(loopId: string, limit = 50): LoopRun[] {
  const lim = Math.min(Math.max(limit, 1), 500)
  return getDb()
    .prepare('SELECT * FROM loop_runs WHERE loop_id = ? ORDER BY iteration DESC LIMIT ?')
    .all(loopId, lim)
    .map(rowToRun)
}
