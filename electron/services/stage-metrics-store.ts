import { randomUUID } from 'crypto'
import { getDb } from './database'

// Reasoning-Trace Phase / RT2 — write-through persistence for per-stage token
// + duration metrics emitted by the multi-agent pipeline. One row per (message,
// stage). Single-agent turns get a single row with stage='single' so the audit
// surface (StageTokenChips, Reasoning Trace Viewer) renders uniformly.
//
// Mirrors plan-goal-persistence: durable SQLite layer with an in-memory
// fallback that activates if getDb() throws (headless tests, disk failure).
// Public API never throws into the caller.

export type StageKey = 'planner' | 'coder' | 'reviewer' | 'single'

export interface StageMetrics {
  stage: StageKey
  model?: string | null
  promptTokens?: number | null
  completionTokens?: number | null
  durationMs?: number | null
}

export interface PersistedStageMetric extends StageMetrics {
  id: string
  messageId: string
  createdAt: number
}

const VALID_STAGES: ReadonlySet<StageKey> = new Set(['planner', 'coder', 'reviewer', 'single'])

interface StageMetricRow {
  id: string
  message_id: string
  stage: StageKey
  model: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  duration_ms: number | null
  created_at: number
}

// In-memory fallback keyed by messageId.
const memoryFallback = new Map<string, PersistedStageMetric[]>()
let useFallback = false

function activateFallback(reason: string): void {
  if (!useFallback) {
    useFallback = true
    console.warn(
      `[stage-metrics-store] persistence unavailable, falling back to memory: ${reason}`
    )
  }
}

export function isUsingMemoryFallback(): boolean {
  return useFallback
}

function nowMs(): number {
  return Date.now()
}

function rowToMetric(row: StageMetricRow): PersistedStageMetric {
  return {
    id: row.id,
    messageId: row.message_id,
    stage: row.stage,
    model: row.model,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    durationMs: row.duration_ms,
    createdAt: row.created_at
  }
}

/**
 * Persist one stage's metrics for a message. Idempotent on (messageId, stage)
 * in the sense that callers append rows; the schema doesn't enforce
 * uniqueness because multi-agent rerun scenarios (planner-twice) are a valid
 * audit shape. If you need exactly-one semantics, clear via
 * `deleteStageMetricsForMessage` first.
 */
export function saveStageMetrics(
  messageId: string,
  metrics: StageMetrics
): PersistedStageMetric {
  if (!messageId) throw new Error('saveStageMetrics: messageId is required')
  if (!VALID_STAGES.has(metrics.stage)) {
    throw new Error(`saveStageMetrics: invalid stage "${metrics.stage}"`)
  }

  const record: PersistedStageMetric = {
    id: randomUUID(),
    messageId,
    stage: metrics.stage,
    model: metrics.model ?? null,
    promptTokens: metrics.promptTokens ?? null,
    completionTokens: metrics.completionTokens ?? null,
    durationMs: metrics.durationMs ?? null,
    createdAt: nowMs()
  }

  if (useFallback) {
    const bucket = memoryFallback.get(messageId) ?? []
    bucket.push(record)
    memoryFallback.set(messageId, bucket)
    return record
  }

  try {
    const db = getDb()
    db.prepare(
      `INSERT INTO message_stage_metrics
         (id, message_id, stage, model, prompt_tokens, completion_tokens, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id,
      record.messageId,
      record.stage,
      record.model,
      record.promptTokens,
      record.completionTokens,
      record.durationMs,
      record.createdAt
    )
    return record
  } catch (err) {
    activateFallback(String(err))
    const bucket = memoryFallback.get(messageId) ?? []
    bucket.push(record)
    memoryFallback.set(messageId, bucket)
    return record
  }
}

/** List all stage metrics for a message, oldest first. */
export function listStageMetrics(messageId: string): PersistedStageMetric[] {
  if (!messageId) return []
  if (useFallback) {
    return [...(memoryFallback.get(messageId) ?? [])]
  }
  try {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT id, message_id, stage, model, prompt_tokens, completion_tokens, duration_ms, created_at
           FROM message_stage_metrics
          WHERE message_id = ?
          ORDER BY created_at ASC`
      )
      .all(messageId) as StageMetricRow[]
    return rows.map(rowToMetric)
  } catch (err) {
    activateFallback(String(err))
    return [...(memoryFallback.get(messageId) ?? [])]
  }
}

/** Hard-delete all metrics for a message. Used by tests + the conversation-delete cascade is the prod path. */
export function deleteStageMetricsForMessage(messageId: string): void {
  if (!messageId) return
  memoryFallback.delete(messageId)
  if (useFallback) return
  try {
    const db = getDb()
    db.prepare('DELETE FROM message_stage_metrics WHERE message_id = ?').run(messageId)
  } catch (err) {
    activateFallback(String(err))
  }
}

/** Test-only escape hatch — drops the fallback flag + memory bucket. */
export function __resetStageMetricsForTests(): void {
  memoryFallback.clear()
  useFallback = false
}

/** Test-only — pin the memory-fallback path on without needing a getDb() throw first. */
export function __forceMemoryFallback(): void {
  useFallback = true
}
