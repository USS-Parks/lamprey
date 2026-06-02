import { getDb } from './database'
import type { LampreyToolCall, LampreyToolCallStatus } from './tool-registry'

// Tool-call audit log. Every model-initiated tool invocation is persisted
// here for inspection in the UI and replay diagnostics. The full result
// content also lives on the related `messages` row; this table stores a
// bounded preview to keep the recent-calls UI cheap to render.

const RESULT_PREVIEW_CAP = 4096

interface ToolCallRow {
  id: string
  tool_id: string
  name: string
  conversation_id: string | null
  args_json: string
  status: LampreyToolCallStatus
  result_preview: string | null
  error: string | null
  started_at: number
  finished_at: number | null
  duration_ms: number | null
  approval_source: string | null
  parent_call_id: string | null
}

function toToolCall(row: ToolCallRow): LampreyToolCall {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(row.args_json) as Record<string, unknown>
  } catch {
    args = {}
  }
  return {
    id: row.id,
    toolId: row.tool_id,
    name: row.name,
    conversationId: row.conversation_id ?? undefined,
    args,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    status: row.status,
    result: row.result_preview ?? undefined,
    error: row.error ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    approvalSource: row.approval_source ?? undefined,
    parentCallId: row.parent_call_id ?? undefined
  }
}

function previewOf(s: string | undefined): string | null {
  if (s === undefined) return null
  if (s.length <= RESULT_PREVIEW_CAP) return s
  return s.slice(0, RESULT_PREVIEW_CAP - 16) + '… (truncated)'
}

export function insertToolCall(call: LampreyToolCall): void {
  const db = getDb()
  db.prepare(
    `INSERT INTO tool_calls
       (id, tool_id, name, conversation_id, args_json, status,
        result_preview, error, started_at, finished_at, duration_ms,
        approval_source, parent_call_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       tool_id = excluded.tool_id,
       name = excluded.name,
       conversation_id = excluded.conversation_id,
       args_json = excluded.args_json,
       status = excluded.status,
       result_preview = excluded.result_preview,
       error = excluded.error,
       started_at = excluded.started_at,
       finished_at = excluded.finished_at,
       duration_ms = excluded.duration_ms,
       approval_source = COALESCE(excluded.approval_source, tool_calls.approval_source),
       parent_call_id = COALESCE(excluded.parent_call_id, tool_calls.parent_call_id)`
  ).run(
    call.id,
    call.toolId,
    call.name,
    call.conversationId ?? null,
    JSON.stringify(call.args ?? {}),
    call.status,
    previewOf(call.result),
    call.error ?? null,
    call.startedAt,
    call.finishedAt ?? null,
    call.durationMs ?? null,
    call.approvalSource ?? null,
    call.parentCallId ?? null
  )
}

/**
 * Update an existing tool-call audit row. Semantics:
 *
 *   - `result` undefined → leave result_preview as-is.
 *   - `result` defined  → overwrite result_preview (pass empty string to clear).
 *   - `error` undefined  → leave error as-is.
 *   - `error` defined   → overwrite error (pass empty string to clear).
 *
 * Additionally, when `status` transitions to a successful terminal state
 * (`done`), any previously-recorded `error` is cleared so the row reflects
 * the final outcome — and when transitioning to `error`, the previous
 * `result_preview` is cleared (unless the caller explicitly sets one) so
 * stale "success output" doesn't linger next to an error.
 */
export function updateToolCall(
  id: string,
  patch: {
    status: LampreyToolCallStatus
    result?: string
    error?: string
    finishedAt?: number
    durationMs?: number
    approvalSource?: string
    parentCallId?: string
  }
): void {
  const db = getDb()

  // Build the SET clause dynamically so undefined fields stay untouched and
  // defined fields (including empty strings) overwrite. SQLite better-sqlite3
  // accepts a string for prepared SQL plus a positional params array.
  const sets: string[] = ['status = ?']
  const params: Array<string | number | null> = [patch.status]

  if (patch.result !== undefined) {
    sets.push('result_preview = ?')
    params.push(previewOf(patch.result))
  } else if (patch.status === 'error') {
    // Clear stale success output on the error transition unless the caller
    // explicitly preserves it (by setting result).
    sets.push('result_preview = NULL')
  }

  if (patch.error !== undefined) {
    sets.push('error = ?')
    params.push(patch.error)
  } else if (patch.status === 'done') {
    // Success terminal — clear any previously-recorded error message.
    sets.push('error = NULL')
  }

  if (patch.finishedAt !== undefined) {
    sets.push('finished_at = ?')
    params.push(patch.finishedAt)
  }
  if (patch.durationMs !== undefined) {
    sets.push('duration_ms = ?')
    params.push(patch.durationMs)
  }
  if (patch.approvalSource !== undefined) {
    sets.push('approval_source = ?')
    params.push(patch.approvalSource)
  }
  if (patch.parentCallId !== undefined) {
    sets.push('parent_call_id = ?')
    params.push(patch.parentCallId)
  }

  params.push(id)
  db.prepare(`UPDATE tool_calls SET ${sets.join(', ')} WHERE id = ?`).run(...params)
}

export function listRecentToolCalls(limit?: number): LampreyToolCall[] {
  const db = getDb()
  const cap = typeof limit === 'number' && limit > 0 ? Math.min(limit, 500) : 100
  const rows = db
    .prepare(
      `SELECT * FROM tool_calls ORDER BY started_at DESC LIMIT ?`
    )
    .all(cap) as ToolCallRow[]
  return rows.map(toToolCall)
}

export function listToolCallsForConversation(
  conversationId: string,
  limit?: number
): LampreyToolCall[] {
  const db = getDb()
  const cap = typeof limit === 'number' && limit > 0 ? Math.min(limit, 500) : 200
  const rows = db
    .prepare(
      `SELECT * FROM tool_calls
       WHERE conversation_id = ?
       ORDER BY started_at DESC
       LIMIT ?`
    )
    .all(conversationId, cap) as ToolCallRow[]
  return rows.map(toToolCall)
}

export function getToolCall(id: string): LampreyToolCall | null {
  const db = getDb()
  const row = db.prepare(`SELECT * FROM tool_calls WHERE id = ?`).get(id) as
    | ToolCallRow
    | undefined
  return row ? toToolCall(row) : null
}
