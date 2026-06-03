import { randomUUID } from 'crypto'
import { getDb } from './database'

// Append-only event log. The cross-system audit/timeline complement to the
// structured domain tables (tool_calls, permission_policies, automations,
// projects). This service is the only sanctioned writer: it owns JSON
// serialization, payload size caps, timestamping, and metadata-only redaction.
//
// What the log records vs. does NOT record:
//   - metadata, IDs, statuses, counts, durations, model/provider names, bounded
//     previews, redacted paths/args. Yes.
//   - secrets, full API keys, OAuth tokens, raw model responses, full file
//     contents, anything beyond the payload cap. No — those either belong on
//     `messages` (model content) or in the keychain (credentials), never here.
//
// See PLANNING/Lamprey_Data_Spine_Plan_and_Prompt_Timeline.md for the spine
// roadmap and how producers will be wired in Prompts 2–4.

// ──────────────────── event types ────────────────────

export const EVENT_TYPES = [
  // Tool call lifecycle (Prompt 2). Mirror tool_calls but in timeline form.
  'tool.call.started',
  'tool.call.approved',
  'tool.call.denied',
  'tool.call.completed',
  'tool.call.failed',

  // Agent pipeline (Prompt 3): planner/coder/reviewer stages.
  'agent.stage.started',
  'agent.stage.completed',
  'agent.stage.failed',

  // Model requests (Prompt 3): per-provider per-model calls.
  'model.request.started',
  'model.request.completed',
  'model.request.failed',

  // Chat (Prompt 3).
  'chat.cancelled',
  'chat.error',

  // Workspace + worktree (Prompt 4).
  'workspace.changed',
  'worktree.created',
  'worktree.removed',

  // Automations (Prompt 4).
  'automation.started',
  'automation.completed',
  'automation.failed',

  // Security / policy (Prompt 2 + ongoing).
  'security.decision',
  'permission.policy.created',
  'permission.policy.updated',
  'permission.policy.deleted',

  // Settings (Prompt 4): key-change metadata only, never raw values.
  'settings.updated',

  // Projects (Prompt 4): created/archived/pinned/deleted are discrete user
  // actions with single-flag semantics. Rename + touch are noisy
  // bookkeeping and intentionally stay off the event spine.
  'project.created',
  'project.archived',
  'project.pinned',
  'project.deleted',

  // RAG collections (R1 of the LAMPREY_RAG_PLAN). Discrete user actions on
  // the collection table. Document / chunk / ingest / query / retrieval /
  // rerank / model-download event types land in later R-prompts alongside
  // their producers.
  'rag.collection.created',
  'rag.collection.updated',
  'rag.collection.deleted',

  // RAG embedder download lifecycle (R2). Emitted by the embeddings service
  // on first activation of a model id — the underlying transformers.js
  // pipeline fetches weights from HF once and caches them in
  // userData/models/transformers/. Per-byte progress isn't surfaced by
  // transformers.js; v1 emits started + completed only.
  'rag.model.download.started',
  'rag.model.download.completed',
  'rag.model.download.failed',

  // RAG ingest pipeline (R5). One pair per file inside an ingest job.
  // correlationId on the event row is the jobId so the timeline can
  // reconstruct a multi-file ingest by one id.
  'rag.ingest.started',
  'rag.ingest.completed',
  'rag.ingest.failed',

  // RAG retrieval (R7-R9). One event per top-level query — sub-queries
  // emitted by multi-query rewrite (R9) are rolled into the parent's
  // payload, not emitted separately.
  'rag.query.completed',
  'rag.query.failed',
  'rag.rerank.completed'
] as const

export type EventType = (typeof EVENT_TYPES)[number]

export type EventSeverity = 'info' | 'warning' | 'error'

/**
 * Provenance label on the JSON payload column. `metadata` (default) means the
 * row only carries structural metadata — safe to read freely. `preview` means
 * the row includes a bounded preview of user-or-model content; UI surfaces
 * should label these accordingly. `redacted` means the writer dropped fields it
 * could not safely persist.
 */
export type EventRedaction = 'metadata' | 'preview' | 'redacted'

/**
 * Who acted. `user` = direct human action; `system` = housekeeping/timer;
 * `agent` = orchestrator (single-mode or pipeline); `model` = provider/LLM;
 * `tool` = tool invocation outcome (used for tool-completion events where the
 * tool itself, not the model that called it, is the relevant actor).
 */
export type EventActorKind = 'user' | 'system' | 'agent' | 'model' | 'tool'

// ──────────────────── records ────────────────────

export interface EventRecord {
  id: string
  type: EventType
  createdAt: number
  severity: EventSeverity
  conversationId?: string
  projectId?: string
  workspacePath?: string
  automationId?: string
  toolCallId?: string
  parentEventId?: string
  correlationId?: string
  actorKind: EventActorKind
  actorId?: string
  entityKind?: string
  entityId?: string
  payload: Record<string, unknown>
  redaction: EventRedaction
}

export interface RecordEventInput {
  type: EventType
  severity?: EventSeverity
  conversationId?: string
  projectId?: string
  workspacePath?: string
  automationId?: string
  toolCallId?: string
  parentEventId?: string
  correlationId?: string
  actorKind: EventActorKind
  actorId?: string
  entityKind?: string
  entityId?: string
  payload?: Record<string, unknown>
  redaction?: EventRedaction
}

export interface EventFilter {
  type?: EventType | EventType[]
  conversationId?: string
  projectId?: string
  workspacePath?: string
  automationId?: string
  toolCallId?: string
  correlationId?: string
  severity?: EventSeverity | EventSeverity[]
  /** Inclusive lower bound (epoch ms). */
  sinceMs?: number
  /** Inclusive upper bound (epoch ms). */
  untilMs?: number
  /** Max rows. Clamped to MAX_LIST_LIMIT. Default 200. */
  limit?: number
  /** Order: 'desc' (default, recent first) or 'asc' (timeline order). */
  order?: 'asc' | 'desc'
}

// ──────────────────── caps + redaction ────────────────────

/**
 * Maximum serialized payload size. Anything larger is wrapped into a
 * `{ truncated: true, originalBytes }` envelope and stored as `redacted`. This
 * is intentionally well below SQLite's row limit — the event log is for
 * timeline metadata, not bulk content storage.
 */
export const PAYLOAD_BYTE_CAP = 16 * 1024

/**
 * Maximum rows a single listEvents call will return. Callers asking for more
 * are silently clamped — the event log is a timeline aid, not a bulk export.
 */
export const MAX_LIST_LIMIT = 1000

const SECRET_KEY_PATTERNS: RegExp[] = [
  /api[_-]?key/i,
  /secret/i,
  /token/i,
  /password/i,
  /passwd/i,
  /authorization/i,
  /bearer/i,
  /private[_-]?key/i,
  /client[_-]?secret/i,
  /refresh[_-]?token/i,
  /access[_-]?token/i,
  /openai[_-]?key/i,
  /anthropic[_-]?key/i,
  /credential/i,
  /cookie/i,
  /session[_-]?id/i
]

function looksSensitive(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((re) => re.test(key))
}

/**
 * Walk a JSON-serializable payload and drop values under keys that look like
 * credentials. We replace the value with the literal string '[redacted]' so
 * timeline consumers still see the field's *presence* (useful for "the request
 * carried an auth header" without leaking the header itself). Returns the
 * cleaned payload plus whether any redaction occurred.
 *
 * Cycle-safe: tracks objects we've already seen so a self-referential payload
 * cannot send the walker into an infinite loop.
 */
export function redactPayload(value: unknown): {
  value: unknown
  redacted: boolean
} {
  const seen = new WeakSet<object>()
  let anyRedacted = false

  function walk(v: unknown): unknown {
    if (v === null || typeof v !== 'object') return v
    if (seen.has(v as object)) {
      anyRedacted = true
      return '[cycle]'
    }
    seen.add(v as object)
    if (Array.isArray(v)) {
      return v.map((item) => walk(item))
    }
    const out: Record<string, unknown> = {}
    for (const [k, raw] of Object.entries(v)) {
      if (looksSensitive(k)) {
        anyRedacted = true
        out[k] = '[redacted]'
      } else {
        out[k] = walk(raw)
      }
    }
    return out
  }

  return { value: walk(value), redacted: anyRedacted }
}

/**
 * Per-field preview cap. Producers (tool registry, agent pipeline, retrieval)
 * call boundedJsonPreview to inline a short, redacted view of a specific value
 * — args, result text, model response — into an event payload. The full
 * payload cap still applies, but using this helper means a single large field
 * can't push the *whole* payload into a truncation envelope, which would lose
 * the surrounding metadata (toolId, durationMs, etc.) that makes the event
 * useful in the timeline.
 */
export const FIELD_PREVIEW_CHAR_CAP = 2048

/**
 * Build a bounded, redacted JSON preview of a value. Suitable for stuffing
 * into a payload field whose primary job is "give the user a hint of what
 * this call carried" without leaking secrets or duplicating large blobs into
 * the event log. Returns null when the input is undefined so callers can
 * conditionally omit the field.
 */
export function boundedJsonPreview(
  value: unknown,
  maxChars: number = FIELD_PREVIEW_CHAR_CAP
): string | null {
  if (value === undefined) return null
  if (typeof value === 'string') {
    if (value.length <= maxChars) return value
    return value.slice(0, Math.max(0, maxChars - 16)) + '… (truncated)'
  }
  const { value: cleaned } = redactPayload(value)
  let json: string
  try {
    json = JSON.stringify(cleaned)
  } catch (err) {
    json = JSON.stringify({
      _serializationError: String((err as Error)?.message ?? err)
    })
  }
  if (json.length <= maxChars) return json
  return json.slice(0, Math.max(0, maxChars - 16)) + '… (truncated)'
}

interface SerializeResult {
  json: string
  redaction: EventRedaction
}

/**
 * Serialize a payload to JSON with redaction + size cap. The result is what
 * actually lands in the `payload_json` column. Pure: callers in tests can
 * exercise size-cap behavior without writing to the database.
 */
export function serializePayload(
  payload: Record<string, unknown> | undefined,
  declared: EventRedaction = 'metadata'
): SerializeResult {
  const base = payload ?? {}
  const { value: cleaned, redacted } = redactPayload(base)
  let json: string
  try {
    json = JSON.stringify(cleaned)
  } catch (err) {
    json = JSON.stringify({
      _serializationError: String((err as Error)?.message ?? err)
    })
    return { json, redaction: 'redacted' }
  }
  let resolved: EventRedaction = declared
  if (redacted && resolved !== 'redacted') resolved = 'redacted'

  if (json.length > PAYLOAD_BYTE_CAP) {
    const envelope = {
      truncated: true,
      originalBytes: json.length,
      cap: PAYLOAD_BYTE_CAP
    }
    return { json: JSON.stringify(envelope), redaction: 'redacted' }
  }
  return { json, redaction: resolved }
}

// ──────────────────── DB row mapping ────────────────────

interface EventRow {
  id: string
  type: string
  created_at: number
  severity: string
  conversation_id: string | null
  project_id: string | null
  workspace_path: string | null
  automation_id: string | null
  tool_call_id: string | null
  parent_event_id: string | null
  correlation_id: string | null
  actor_kind: string
  actor_id: string | null
  entity_kind: string | null
  entity_id: string | null
  payload_json: string
  redaction: string
}

function rowToEvent(row: EventRow): EventRecord {
  let payload: Record<string, unknown>
  try {
    const parsed = JSON.parse(row.payload_json)
    payload =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : { value: parsed }
  } catch {
    payload = { _parseError: true }
  }
  return {
    id: row.id,
    type: row.type as EventType,
    createdAt: row.created_at,
    severity: row.severity as EventSeverity,
    conversationId: row.conversation_id ?? undefined,
    projectId: row.project_id ?? undefined,
    workspacePath: row.workspace_path ?? undefined,
    automationId: row.automation_id ?? undefined,
    toolCallId: row.tool_call_id ?? undefined,
    parentEventId: row.parent_event_id ?? undefined,
    correlationId: row.correlation_id ?? undefined,
    actorKind: row.actor_kind as EventActorKind,
    actorId: row.actor_id ?? undefined,
    entityKind: row.entity_kind ?? undefined,
    entityId: row.entity_id ?? undefined,
    payload,
    redaction: row.redaction as EventRedaction
  }
}

// ──────────────────── memory fallback ────────────────────

// Activates when getDb() throws (headless tests without an Electron app). The
// pattern mirrors permission-policies-store: same public API, the swap happens
// inside the service so callers never have to know which path they hit.
const memoryFallback: EventRecord[] = []
let useFallback = false

function activateFallback(reason: string): void {
  if (!useFallback) {
    useFallback = true
    console.warn(
      `[event-log] persistence unavailable, falling back to memory: ${reason}`
    )
  }
}

export function isUsingMemoryFallback(): boolean {
  return useFallback
}

// ──────────────────── writer ────────────────────

/**
 * Record a single event. Returns the persisted EventRecord with id +
 * createdAt populated. Never throws on payload size — oversize payloads are
 * truncated to an envelope and marked `redaction: 'redacted'`.
 */
export function recordEvent(input: RecordEventInput): EventRecord {
  if (!EVENT_TYPES.includes(input.type)) {
    throw new Error(`recordEvent: unknown event type "${input.type}"`)
  }
  if (!input.actorKind) {
    throw new Error('recordEvent: actorKind is required')
  }

  const id = randomUUID()
  const createdAt = Date.now()
  const severity: EventSeverity = input.severity ?? 'info'
  const { json, redaction } = serializePayload(input.payload, input.redaction)

  const record: EventRecord = {
    id,
    type: input.type,
    createdAt,
    severity,
    conversationId: input.conversationId,
    projectId: input.projectId,
    workspacePath: input.workspacePath,
    automationId: input.automationId,
    toolCallId: input.toolCallId,
    parentEventId: input.parentEventId,
    correlationId: input.correlationId,
    actorKind: input.actorKind,
    actorId: input.actorId,
    entityKind: input.entityKind,
    entityId: input.entityId,
    payload: safeParsePayload(json),
    redaction
  }

  if (!useFallback) {
    try {
      const db = getDb()
      db.prepare(
        `INSERT INTO events
           (id, type, created_at, severity,
            conversation_id, project_id, workspace_path,
            automation_id, tool_call_id, parent_event_id, correlation_id,
            actor_kind, actor_id, entity_kind, entity_id,
            payload_json, redaction)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        input.type,
        createdAt,
        severity,
        input.conversationId ?? null,
        input.projectId ?? null,
        input.workspacePath ?? null,
        input.automationId ?? null,
        input.toolCallId ?? null,
        input.parentEventId ?? null,
        input.correlationId ?? null,
        input.actorKind,
        input.actorId ?? null,
        input.entityKind ?? null,
        input.entityId ?? null,
        json,
        redaction
      )
      return record
    } catch (err: any) {
      activateFallback(err?.message ?? 'unknown')
    }
  }
  memoryFallback.push(record)
  return record
}

function safeParsePayload(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return { value: parsed }
  } catch {
    return {}
  }
}

// ──────────────────── helpers ────────────────────

type SeverityHelperInput = Omit<RecordEventInput, 'severity'>

export function recordInfo(input: SeverityHelperInput): EventRecord {
  return recordEvent({ ...input, severity: 'info' })
}

export function recordWarning(input: SeverityHelperInput): EventRecord {
  return recordEvent({ ...input, severity: 'warning' })
}

export function recordError(input: SeverityHelperInput): EventRecord {
  return recordEvent({ ...input, severity: 'error' })
}

// ──────────────────── readers ────────────────────

export function getEvent(id: string): EventRecord | null {
  if (!useFallback) {
    try {
      const db = getDb()
      const row = db.prepare(`SELECT * FROM events WHERE id = ?`).get(id) as
        | EventRow
        | undefined
      return row ? rowToEvent(row) : null
    } catch (err: any) {
      activateFallback(err?.message ?? 'unknown')
    }
  }
  return memoryFallback.find((e) => e.id === id) ?? null
}

interface BuiltQuery {
  sql: string
  params: Array<string | number>
}

function buildListQuery(filter: EventFilter): BuiltQuery {
  const where: string[] = []
  const params: Array<string | number> = []

  if (filter.type) {
    const types = Array.isArray(filter.type) ? filter.type : [filter.type]
    if (types.length > 0) {
      where.push(`type IN (${types.map(() => '?').join(', ')})`)
      params.push(...types)
    }
  }
  if (filter.severity) {
    const sevs = Array.isArray(filter.severity) ? filter.severity : [filter.severity]
    if (sevs.length > 0) {
      where.push(`severity IN (${sevs.map(() => '?').join(', ')})`)
      params.push(...sevs)
    }
  }
  if (filter.conversationId) {
    where.push('conversation_id = ?')
    params.push(filter.conversationId)
  }
  if (filter.projectId) {
    where.push('project_id = ?')
    params.push(filter.projectId)
  }
  if (filter.workspacePath) {
    where.push('workspace_path = ?')
    params.push(filter.workspacePath)
  }
  if (filter.automationId) {
    where.push('automation_id = ?')
    params.push(filter.automationId)
  }
  if (filter.toolCallId) {
    where.push('tool_call_id = ?')
    params.push(filter.toolCallId)
  }
  if (filter.correlationId) {
    where.push('correlation_id = ?')
    params.push(filter.correlationId)
  }
  if (typeof filter.sinceMs === 'number') {
    where.push('created_at >= ?')
    params.push(filter.sinceMs)
  }
  if (typeof filter.untilMs === 'number') {
    where.push('created_at <= ?')
    params.push(filter.untilMs)
  }

  const order = filter.order === 'asc' ? 'ASC' : 'DESC'
  const limit = clampLimit(filter.limit)
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const sql =
    `SELECT * FROM events ${whereClause} ORDER BY created_at ${order} LIMIT ?`.trim()
  params.push(limit)
  return { sql, params }
}

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return 200
  }
  return Math.min(Math.floor(limit), MAX_LIST_LIMIT)
}

function eventMatchesFilter(e: EventRecord, filter: EventFilter): boolean {
  if (filter.type) {
    const types = Array.isArray(filter.type) ? filter.type : [filter.type]
    if (types.length > 0 && !types.includes(e.type)) return false
  }
  if (filter.severity) {
    const sevs = Array.isArray(filter.severity) ? filter.severity : [filter.severity]
    if (sevs.length > 0 && !sevs.includes(e.severity)) return false
  }
  if (filter.conversationId && e.conversationId !== filter.conversationId) return false
  if (filter.projectId && e.projectId !== filter.projectId) return false
  if (filter.workspacePath && e.workspacePath !== filter.workspacePath) return false
  if (filter.automationId && e.automationId !== filter.automationId) return false
  if (filter.toolCallId && e.toolCallId !== filter.toolCallId) return false
  if (filter.correlationId && e.correlationId !== filter.correlationId) return false
  if (typeof filter.sinceMs === 'number' && e.createdAt < filter.sinceMs) return false
  if (typeof filter.untilMs === 'number' && e.createdAt > filter.untilMs) return false
  return true
}

export function listEvents(filter: EventFilter = {}): EventRecord[] {
  if (!useFallback) {
    try {
      const db = getDb()
      const { sql, params } = buildListQuery(filter)
      const rows = db.prepare(sql).all(...params) as EventRow[]
      return rows.map(rowToEvent)
    } catch (err: any) {
      activateFallback(err?.message ?? 'unknown')
    }
  }
  const order = filter.order === 'asc' ? 'asc' : 'desc'
  const limit = clampLimit(filter.limit)
  const matched = memoryFallback.filter((e) => eventMatchesFilter(e, filter))
  matched.sort((a, b) =>
    order === 'asc' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt
  )
  return matched.slice(0, limit)
}

export interface TimelineFilter {
  conversationId?: string
  projectId?: string
  workspacePath?: string
  correlationId?: string
  automationId?: string
  /** Max rows. Clamped to MAX_LIST_LIMIT. Default 500. */
  limit?: number
}

/**
 * Convenience reader: returns events for a single scope in ascending time
 * order (oldest → newest) so consumers can render a top-to-bottom timeline.
 * Exactly one of conversationId / projectId / workspacePath / correlationId /
 * automationId must be set; passing none throws so callers can't accidentally
 * pull the entire log under the timeline banner.
 */
export function listTimeline(filter: TimelineFilter): EventRecord[] {
  const scopes = [
    filter.conversationId,
    filter.projectId,
    filter.workspacePath,
    filter.correlationId,
    filter.automationId
  ].filter((v) => typeof v === 'string' && v.length > 0)
  if (scopes.length === 0) {
    throw new Error(
      'listTimeline: at least one of conversationId, projectId, workspacePath, correlationId, automationId is required'
    )
  }
  return listEvents({
    conversationId: filter.conversationId,
    projectId: filter.projectId,
    workspacePath: filter.workspacePath,
    correlationId: filter.correlationId,
    automationId: filter.automationId,
    order: 'asc',
    limit: filter.limit ?? 500
  })
}

// ──────────────────── test-only hooks ────────────────────

/** Test-only: drop the in-memory fallback so tests start clean. */
export function __resetEventLog(): void {
  memoryFallback.length = 0
  useFallback = false
}

/** Test-only: force the memory fallback path. */
export function __forceMemoryFallback(): void {
  useFallback = true
}
