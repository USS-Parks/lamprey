// Minimal 5-field cron parser + 60-second tick scheduler. Supports `*`,
// exact numbers, `a,b,c` lists, `a-b` ranges, and `*/N` step. Does NOT
// support names (mon, tue), `?`, or 6-field/7-field cron — keep it simple.

import { randomUUID } from 'crypto'
import { listAutomations, recordRun } from './automations-store'
import { chatOnce } from './providers/registry'
import { boundedJsonPreview, recordEvent } from './event-log'

type FieldSet = Set<number>

interface CronExpr {
  minutes: FieldSet
  hours: FieldSet
  dayOfMonth: FieldSet
  month: FieldSet
  dayOfWeek: FieldSet
}

function parseField(raw: string, min: number, max: number): FieldSet {
  const set = new Set<number>()
  for (const piece of raw.split(',')) {
    if (piece === '*') {
      for (let i = min; i <= max; i++) set.add(i)
      continue
    }
    const stepMatch = piece.match(/^(\*|\d+(-\d+)?)\/(\d+)$/)
    if (stepMatch) {
      const range = stepMatch[1]
      const step = parseInt(stepMatch[3], 10)
      if (step <= 0) throw new Error(`bad step ${step}`)
      let lo = min,
        hi = max
      if (range !== '*') {
        const m = range.match(/^(\d+)(?:-(\d+))?$/)!
        lo = parseInt(m[1], 10)
        hi = m[2] ? parseInt(m[2], 10) : max
      }
      for (let i = lo; i <= hi; i += step) set.add(i)
      continue
    }
    const rangeMatch = piece.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1], 10)
      const hi = parseInt(rangeMatch[2], 10)
      for (let i = lo; i <= hi; i++) set.add(i)
      continue
    }
    const n = parseInt(piece, 10)
    if (!Number.isFinite(n) || n < min || n > max) {
      throw new Error(`bad field value: ${piece}`)
    }
    set.add(n)
  }
  return set
}

export function parseCron(expr: string): CronExpr {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(
      `Cron needs 5 fields (min hour dom month dow), got ${parts.length}: "${expr}"`
    )
  }
  return {
    minutes: parseField(parts[0], 0, 59),
    hours: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6)
  }
}

function matches(expr: CronExpr, d: Date): boolean {
  return (
    expr.minutes.has(d.getMinutes()) &&
    expr.hours.has(d.getHours()) &&
    expr.dayOfMonth.has(d.getDate()) &&
    expr.month.has(d.getMonth() + 1) &&
    expr.dayOfWeek.has(d.getDay())
  )
}

let timer: NodeJS.Timeout | null = null
const lastFiredMinute = new Map<string, number>()

async function runOne(autoId: string): Promise<void> {
  const list = listAutomations()
  const a = list.find((x) => x.id === autoId)
  if (!a) return
  const model = a.model || 'deepseek-chat'
  // Per-run correlation id so the model.request.* events emitted from within
  // chatOnce join the automation.started/completed event-log row group. Each
  // run is its own logical "turn" — they do NOT share an id across cron firings.
  const correlationId = randomUUID()
  const startedAt = Date.now()
  emitAutomationEvent('automation.started', {
    automationId: a.id,
    label: a.label,
    cron: a.cron,
    model,
    correlationId,
    startedAt
  })
  try {
    const reply = await chatOnce(
      [{ role: 'user', content: a.prompt }] as any,
      model,
      undefined,
      // chatOnce will emit model.request.started/completed/failed tagged with
      // this correlationId, so an automation run reconstructs as
      // automation.started → model.request.* → automation.completed.
      { correlationId, purpose: 'other', role: 'automation' }
    )
    recordRun(a.id, reply.slice(0, 4000))
    emitAutomationEvent('automation.completed', {
      automationId: a.id,
      label: a.label,
      cron: a.cron,
      model,
      correlationId,
      startedAt,
      durationMs: Date.now() - startedAt,
      replyPreview: reply
    })
  } catch (err: any) {
    recordRun(a.id, `[error] ${err?.message ?? 'unknown'}`)
    emitAutomationEvent('automation.failed', {
      automationId: a.id,
      label: a.label,
      cron: a.cron,
      model,
      correlationId,
      startedAt,
      durationMs: Date.now() - startedAt,
      error: err?.message ?? 'unknown',
      errorClass: err?.name
    })
  }
}

interface AutomationEventDetail {
  automationId: string
  label?: string
  cron?: string
  model: string
  correlationId: string
  startedAt: number
  durationMs?: number
  replyPreview?: string
  error?: string
  errorClass?: string
}

function emitAutomationEvent(
  type: 'automation.started' | 'automation.completed' | 'automation.failed',
  detail: AutomationEventDetail
): void {
  try {
    recordEvent({
      type,
      actorKind: 'system',
      severity: type === 'automation.failed' ? 'error' : 'info',
      automationId: detail.automationId,
      correlationId: detail.correlationId,
      entityKind: 'automation',
      entityId: detail.automationId,
      payload: {
        automationId: detail.automationId,
        label: detail.label,
        cron: detail.cron,
        model: detail.model,
        startedAt: detail.startedAt,
        durationMs: detail.durationMs,
        replyPreview: boundedJsonPreview(detail.replyPreview),
        errorPreview: boundedJsonPreview(detail.error),
        errorClass: detail.errorClass
      }
    })
  } catch (err) {
    console.error(`[automations] ${type} event failed:`, err)
  }
}

export async function runAutomation(id: string): Promise<void> {
  await runOne(id)
}

function tick(): void {
  let autos
  try {
    autos = listAutomations()
  } catch (err) {
    console.error('[automations] list failed:', err)
    return
  }
  const now = new Date()
  const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`
  for (const a of autos) {
    if (!a.enabled) continue
    let expr: CronExpr
    try {
      expr = parseCron(a.cron)
    } catch {
      continue
    }
    if (!matches(expr, now)) continue
    // Guard against double-firing within the same minute (timer may drift).
    if (lastFiredMinute.get(a.id) === Number(`${now.getHours()}${now.getMinutes()}`)) continue
    lastFiredMinute.set(a.id, Number(`${now.getHours()}${now.getMinutes()}`))
    // Trim the dedup map occasionally so it doesn't grow unbounded.
    if (lastFiredMinute.size > 256) lastFiredMinute.clear()
    void runOne(a.id)
    void minuteKey
  }
}

export function startAutomations(): void {
  if (timer) return
  // Align first tick to the next ~minute boundary, then every 60s.
  const msUntilNextMinute = (60 - new Date().getSeconds()) * 1000
  timer = setTimeout(function tickLoop() {
    tick()
    timer = setTimeout(tickLoop, 60_000)
  }, msUntilNextMinute)
}

export function stopAutomations(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

// ─── G1 — cron preview + next-fire helpers ──────────────────────────

const COMMON_PRESETS: Record<string, string> = {
  '* * * * *': 'Every minute',
  '*/5 * * * *': 'Every 5 minutes',
  '*/10 * * * *': 'Every 10 minutes',
  '*/15 * * * *': 'Every 15 minutes',
  '*/30 * * * *': 'Every 30 minutes',
  '0 * * * *': 'Every hour, on the hour',
  '0 */2 * * *': 'Every 2 hours',
  '0 9 * * *': 'Daily at 09:00',
  '0 9 * * 1-5': 'Weekdays at 09:00',
  '0 0 * * *': 'Daily at midnight',
  '0 0 * * 0': 'Weekly at midnight Sunday',
  '0 0 1 * *': 'Monthly on the 1st'
}

function describeFieldSet(set: FieldSet, min: number, max: number, label: string): string {
  const all = max - min + 1
  if (set.size === all) return `every ${label}`
  const sorted = [...set].sort((a, b) => a - b)
  if (sorted.length === 1) return `at ${label} ${sorted[0]}`
  // Detect step pattern: equally spaced from min.
  if (sorted.length >= 3) {
    const step = sorted[1] - sorted[0]
    let stepOk = step > 1
    for (let i = 2; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] !== step) {
        stepOk = false
        break
      }
    }
    if (stepOk) return `every ${step} ${label}${label.endsWith('s') ? '' : 's'}`
  }
  return `${label}s ${sorted.join(',')}`
}

/**
 * Render a friendly description of a cron expression. Returns null if
 * the expression doesn't parse. Falls back to a field-by-field summary
 * for unrecognized patterns.
 */
export function describeCron(expr: string): string | null {
  const trimmed = expr.trim().replace(/\s+/g, ' ')
  if (COMMON_PRESETS[trimmed]) return COMMON_PRESETS[trimmed]
  let parsed: CronExpr
  try {
    parsed = parseCron(trimmed)
  } catch {
    return null
  }
  const minutes = describeFieldSet(parsed.minutes, 0, 59, 'minute')
  const hours = describeFieldSet(parsed.hours, 0, 23, 'hour')
  return `${minutes}, ${hours}`
}

/**
 * Find the next firing time on or after `from`. Returns null when no
 * match within the next 366 days (handles bad expressions defensively).
 * Tests the minute granularity the tick scheduler uses, so the result
 * is always at second 0.
 */
export function nextFireAfter(expr: string, from: Date = new Date()): Date | null {
  let parsed: CronExpr
  try {
    parsed = parseCron(expr)
  } catch {
    return null
  }
  // Start at the next minute boundary.
  const candidate = new Date(from)
  candidate.setSeconds(0, 0)
  candidate.setMinutes(candidate.getMinutes() + 1)
  const horizonMinutes = 366 * 24 * 60
  for (let i = 0; i < horizonMinutes; i++) {
    if (matches(parsed, candidate)) return new Date(candidate)
    candidate.setMinutes(candidate.getMinutes() + 1)
  }
  return null
}
