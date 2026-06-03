import { ipcMain } from 'electron'
import {
  EVENT_TYPES,
  MAX_LIST_LIMIT,
  getEvent,
  listEvents,
  listTimeline,
  type EventFilter,
  type EventSeverity,
  type EventType,
  type TimelineFilter
} from '../services/event-log'

// Read-only IPC surface for the event spine. Three handlers:
//   - events:list      — filtered cross-system feed (newest first by default)
//   - events:get       — single event by id
//   - events:timeline  — scope-bound ascending feed for the Activity Timeline
//
// The renderer cannot write events. There is no events:record IPC and there
// will not be one — producers live in main-process services so the spine
// always reflects what the main loop actually did, not what the renderer
// claims it did.

const VALID_SEVERITIES: ReadonlySet<EventSeverity> = new Set<EventSeverity>([
  'info',
  'warning',
  'error'
])

const VALID_EVENT_TYPES: ReadonlySet<EventType> = new Set<EventType>(EVENT_TYPES)

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function asPositiveInt(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return undefined
  return Math.floor(v)
}

function coerceTypeFilter(raw: unknown): EventType | EventType[] | undefined {
  if (typeof raw === 'string') {
    return VALID_EVENT_TYPES.has(raw as EventType) ? (raw as EventType) : undefined
  }
  if (Array.isArray(raw)) {
    const acc: EventType[] = []
    for (const v of raw) {
      if (typeof v === 'string' && VALID_EVENT_TYPES.has(v as EventType)) {
        acc.push(v as EventType)
      }
    }
    return acc.length > 0 ? acc : undefined
  }
  return undefined
}

function coerceSeverityFilter(
  raw: unknown
): EventSeverity | EventSeverity[] | undefined {
  if (typeof raw === 'string') {
    return VALID_SEVERITIES.has(raw as EventSeverity)
      ? (raw as EventSeverity)
      : undefined
  }
  if (Array.isArray(raw)) {
    const acc: EventSeverity[] = []
    for (const v of raw) {
      if (typeof v === 'string' && VALID_SEVERITIES.has(v as EventSeverity)) {
        acc.push(v as EventSeverity)
      }
    }
    return acc.length > 0 ? acc : undefined
  }
  return undefined
}

/**
 * Pure: validate + coerce a renderer-supplied filter object. Drops unknown
 * keys and rejects ill-typed values silently so a typo client-side becomes
 * "no filter on this dimension" rather than a 500. Exported so the test
 * file can exercise it without booting electron.
 */
export function coerceListFilter(raw: unknown): EventFilter {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const filter: EventFilter = {}
  const type = coerceTypeFilter(r.type)
  if (type !== undefined) filter.type = type
  const severity = coerceSeverityFilter(r.severity)
  if (severity !== undefined) filter.severity = severity
  const conversationId = asString(r.conversationId)
  if (conversationId) filter.conversationId = conversationId
  const projectId = asString(r.projectId)
  if (projectId) filter.projectId = projectId
  const workspacePath = asString(r.workspacePath)
  if (workspacePath) filter.workspacePath = workspacePath
  const automationId = asString(r.automationId)
  if (automationId) filter.automationId = automationId
  const toolCallId = asString(r.toolCallId)
  if (toolCallId) filter.toolCallId = toolCallId
  const correlationId = asString(r.correlationId)
  if (correlationId) filter.correlationId = correlationId
  const sinceMs = asPositiveInt(r.sinceMs)
  if (sinceMs !== undefined) filter.sinceMs = sinceMs
  const untilMs = asPositiveInt(r.untilMs)
  if (untilMs !== undefined) filter.untilMs = untilMs
  const limit = asPositiveInt(r.limit)
  if (limit !== undefined) filter.limit = Math.min(limit, MAX_LIST_LIMIT)
  if (r.order === 'asc' || r.order === 'desc') filter.order = r.order
  return filter
}

/**
 * Pure: validate + coerce a renderer-supplied timeline scope. Exactly one of
 * the scope fields must be present (matches `event-log.listTimeline`'s
 * runtime guard). Returns a discriminated result so the handler can return
 * the precise error to the renderer.
 */
export function coerceTimelineFilter(
  raw: unknown
):
  | { ok: true; filter: TimelineFilter }
  | { ok: false; error: string } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const filter: TimelineFilter = {}
  const conversationId = asString(r.conversationId)
  if (conversationId) filter.conversationId = conversationId
  const projectId = asString(r.projectId)
  if (projectId) filter.projectId = projectId
  const workspacePath = asString(r.workspacePath)
  if (workspacePath) filter.workspacePath = workspacePath
  const correlationId = asString(r.correlationId)
  if (correlationId) filter.correlationId = correlationId
  const automationId = asString(r.automationId)
  if (automationId) filter.automationId = automationId
  const limit = asPositiveInt(r.limit)
  if (limit !== undefined) filter.limit = Math.min(limit, MAX_LIST_LIMIT)

  const scopeCount = [
    filter.conversationId,
    filter.projectId,
    filter.workspacePath,
    filter.correlationId,
    filter.automationId
  ].filter((v) => typeof v === 'string' && v.length > 0).length
  if (scopeCount === 0) {
    return {
      ok: false,
      error:
        'events:timeline requires exactly one of conversationId, projectId, workspacePath, correlationId, automationId'
    }
  }
  return { ok: true, filter }
}

export function registerEventsHandlers(): void {
  ipcMain.handle('events:list', async (_event, filter: unknown) => {
    try {
      const coerced = coerceListFilter(filter)
      return { success: true, data: listEvents(coerced) }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'events:list failed' }
    }
  })

  ipcMain.handle('events:get', async (_event, id: unknown) => {
    try {
      if (typeof id !== 'string' || !id) {
        return { success: false, error: 'id is required' }
      }
      const found = getEvent(id)
      if (!found) return { success: false, error: 'not found' }
      return { success: true, data: found }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'events:get failed' }
    }
  })

  ipcMain.handle('events:timeline', async (_event, filter: unknown) => {
    try {
      const coerced = coerceTimelineFilter(filter)
      if (!coerced.ok) return { success: false, error: coerced.error }
      return { success: true, data: listTimeline(coerced.filter) }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'events:timeline failed' }
    }
  })
}
