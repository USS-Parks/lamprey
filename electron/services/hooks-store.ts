import { randomUUID } from 'crypto'
import { getDb } from './database'

export type HookEvent =
  | 'sessionStart'
  | 'promptSubmit'
  | 'preToolUse'
  | 'postToolUse'
  | 'agentStop'

// Track 2 / C2 — hooks can be authored in JavaScript (the new default,
// executed in a `vm` sandbox) or in legacy shell-command form. The
// renderer creates JS hooks only; the shell path stays for rows that
// existed before the migration.
export type HookLanguage = 'js' | 'shell'

export interface HookRow {
  id: string
  event: HookEvent
  label: string
  command: string
  enabled: 0 | 1
  created_at: number
  language: HookLanguage
  timeout_ms: number
}

export interface Hook {
  id: string
  event: HookEvent
  label: string
  command: string
  enabled: boolean
  createdAt: number
  language: HookLanguage
  timeoutMs: number
}

export const DEFAULT_HOOK_TIMEOUT_MS = 5000

function normalizeLanguage(raw: unknown): HookLanguage {
  return raw === 'shell' ? 'shell' : 'js'
}

function fromRow(r: HookRow): Hook {
  return {
    id: r.id,
    event: r.event,
    label: r.label,
    command: r.command,
    enabled: !!r.enabled,
    createdAt: r.created_at,
    // Defensive defaults: an older row read before the migration ran would
    // come back undefined; treat that as the (legacy) shell shape.
    language: normalizeLanguage(r.language),
    timeoutMs:
      typeof r.timeout_ms === 'number' && r.timeout_ms > 0
        ? r.timeout_ms
        : DEFAULT_HOOK_TIMEOUT_MS
  }
}

export function listHooks(): Hook[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM hooks ORDER BY event, created_at').all() as HookRow[]
  return rows.map(fromRow)
}

export function listHooksForEvent(event: HookEvent): Hook[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM hooks WHERE event = ? AND enabled = 1 ORDER BY created_at')
    .all(event) as HookRow[]
  return rows.map(fromRow)
}

export function getHook(id: string): Hook | undefined {
  const db = getDb()
  const row = db.prepare('SELECT * FROM hooks WHERE id = ?').get(id) as HookRow | undefined
  return row ? fromRow(row) : undefined
}

export function createHook(input: {
  event: HookEvent
  label: string
  command: string
  language?: HookLanguage
  timeoutMs?: number
}): Hook {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()
  const language: HookLanguage = input.language ?? 'js'
  const timeoutMs =
    typeof input.timeoutMs === 'number' && input.timeoutMs > 0
      ? input.timeoutMs
      : DEFAULT_HOOK_TIMEOUT_MS
  db.prepare(
    `INSERT INTO hooks (id, event, label, command, enabled, created_at, language, timeout_ms)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
  ).run(id, input.event, input.label, input.command, now, language, timeoutMs)
  return {
    id,
    event: input.event,
    label: input.label,
    command: input.command,
    enabled: true,
    createdAt: now,
    language,
    timeoutMs
  }
}

export function updateHook(
  id: string,
  patch: Partial<{
    event: HookEvent
    label: string
    command: string
    enabled: boolean
    language: HookLanguage
    timeoutMs: number
  }>
): void {
  const db = getDb()
  const cur = db.prepare('SELECT * FROM hooks WHERE id = ?').get(id) as HookRow | undefined
  if (!cur) return
  const next: HookRow = {
    ...cur,
    ...(patch.event !== undefined ? { event: patch.event } : {}),
    ...(patch.label !== undefined ? { label: patch.label } : {}),
    ...(patch.command !== undefined ? { command: patch.command } : {}),
    ...(patch.enabled !== undefined ? { enabled: (patch.enabled ? 1 : 0) as 0 | 1 } : {}),
    ...(patch.language !== undefined ? { language: patch.language } : {}),
    ...(patch.timeoutMs !== undefined && patch.timeoutMs > 0
      ? { timeout_ms: patch.timeoutMs }
      : {})
  }
  db.prepare(
    `UPDATE hooks
        SET event = ?, label = ?, command = ?, enabled = ?, language = ?, timeout_ms = ?
      WHERE id = ?`
  ).run(
    next.event,
    next.label,
    next.command,
    next.enabled,
    next.language,
    next.timeout_ms,
    id
  )
}

export function deleteHook(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM hooks WHERE id = ?').run(id)
}
