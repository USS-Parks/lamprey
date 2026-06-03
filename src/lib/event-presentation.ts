import type {
  EventRecord,
  EventSeverity,
  EventType
} from './types'

// Pure presentation helpers for Activity Timeline rows. Lives in `src/lib`
// (not in a component) so the helpers can be exercised by vitest in node-env
// mode without booting jsdom. ALL renderer formatting choices land here so
// the React component is just layout + state, never string juggling.

// ──────────────────── labels ────────────────────

const TYPE_LABELS: Record<EventType, string> = {
  'tool.call.started': 'Tool started',
  'tool.call.approved': 'Tool approved',
  'tool.call.denied': 'Tool denied',
  'tool.call.completed': 'Tool completed',
  'tool.call.failed': 'Tool failed',
  'agent.stage.started': 'Stage started',
  'agent.stage.completed': 'Stage completed',
  'agent.stage.failed': 'Stage failed',
  'model.request.started': 'Model request',
  'model.request.completed': 'Model response',
  'model.request.failed': 'Model error',
  'chat.cancelled': 'Chat cancelled',
  'chat.error': 'Chat error',
  'workspace.changed': 'Workspace changed',
  'worktree.created': 'Worktree created',
  'worktree.removed': 'Worktree removed',
  'automation.started': 'Automation started',
  'automation.completed': 'Automation completed',
  'automation.failed': 'Automation failed',
  'security.decision': 'Security decision',
  'permission.policy.created': 'Policy added',
  'permission.policy.updated': 'Policy updated',
  'permission.policy.deleted': 'Policy removed',
  'settings.updated': 'Settings updated',
  'project.created': 'Project created',
  'project.archived': 'Project archived',
  'project.pinned': 'Project pinned',
  'project.deleted': 'Project deleted',
  'rag.collection.created': 'Collection created',
  'rag.collection.updated': 'Collection updated',
  'rag.collection.deleted': 'Collection removed',
  'rag.model.download.started': 'Embedder downloading',
  'rag.model.download.completed': 'Embedder ready',
  'rag.model.download.failed': 'Embedder download failed',
  'rag.ingest.started': 'Ingest started',
  'rag.ingest.completed': 'Ingest completed',
  'rag.ingest.failed': 'Ingest failed',
  'rag.query.completed': 'Retrieval ran',
  'rag.query.failed': 'Retrieval failed',
  'rag.rerank.completed': 'Reranked'
}

export function eventTypeLabel(type: EventType): string {
  return TYPE_LABELS[type] ?? type
}

/**
 * Compact subtitle for an event row — pulls the most useful payload field for
 * its category. Never returns raw payload JSON; cap at the supplied char limit
 * so a long error preview doesn't overflow the row. Returns null when the
 * event carries no useful subtitle (lets the renderer skip the dim line).
 */
export function eventSubtitle(event: EventRecord, maxChars = 120): string | null {
  const p = event.payload as Record<string, unknown>
  let s: string | null = null
  switch (event.type) {
    case 'tool.call.started':
    case 'tool.call.approved':
    case 'tool.call.denied':
    case 'tool.call.completed':
    case 'tool.call.failed': {
      const name = typeof p.name === 'string' ? p.name : (p.toolId as string | undefined)
      s = name ?? null
      break
    }
    case 'model.request.started':
    case 'model.request.completed':
    case 'model.request.failed': {
      const provider = typeof p.provider === 'string' ? p.provider : undefined
      const model = typeof p.model === 'string' ? p.model : undefined
      const purpose = typeof p.purpose === 'string' ? p.purpose : undefined
      const parts = [provider, model].filter((x): x is string => !!x)
      const head = parts.length > 0 ? parts.join(' · ') : null
      s = head && purpose && purpose !== 'main' ? `${head} (${purpose})` : head
      break
    }
    case 'agent.stage.started':
    case 'agent.stage.completed':
    case 'agent.stage.failed': {
      const role = typeof p.role === 'string' ? p.role : undefined
      const model = typeof p.model === 'string' ? p.model : undefined
      s = role && model ? `${role} · ${model}` : role ?? null
      break
    }
    case 'workspace.changed': {
      const action = typeof p.action === 'string' ? p.action : ''
      const to = typeof p.to === 'string' ? p.to : undefined
      const from = typeof p.from === 'string' ? p.from : undefined
      s = action === 'clear' ? `cleared (was ${from ?? 'unset'})` : (to ?? from ?? null)
      break
    }
    case 'worktree.created':
    case 'worktree.removed': {
      const path = typeof p.path === 'string' ? p.path : undefined
      const branch = typeof p.branch === 'string' ? p.branch : undefined
      const ok = p.ok === true
      const head = branch ? `${branch} → ${path ?? '?'}` : (path ?? null)
      s = head ? (ok ? head : `${head} (failed)`) : null
      break
    }
    case 'automation.started':
    case 'automation.completed':
    case 'automation.failed': {
      const label = typeof p.label === 'string' ? p.label : undefined
      const model = typeof p.model === 'string' ? p.model : undefined
      s = label && model ? `${label} · ${model}` : label ?? model ?? null
      break
    }
    case 'settings.updated': {
      const changedKeys = Array.isArray(p.changedKeys) ? (p.changedKeys as string[]) : []
      s = changedKeys.length > 0 ? changedKeys.join(', ') : null
      break
    }
    case 'project.created':
    case 'project.archived':
    case 'project.pinned':
    case 'project.deleted': {
      const name = typeof p.name === 'string' ? p.name : undefined
      const projectId = typeof p.projectId === 'string' ? p.projectId : undefined
      s = name ?? projectId ?? null
      break
    }
    case 'rag.collection.created':
    case 'rag.collection.updated':
    case 'rag.collection.deleted': {
      const name = typeof p.name === 'string' ? p.name : undefined
      const embedderId = typeof p.embedderId === 'string' ? p.embedderId : undefined
      s = name && embedderId ? `${name} · ${embedderId}` : (name ?? null)
      break
    }
    case 'rag.model.download.started':
    case 'rag.model.download.completed':
    case 'rag.model.download.failed': {
      const name = typeof p.name === 'string' ? p.name : undefined
      const embedderId = typeof p.embedderId === 'string' ? p.embedderId : undefined
      s = name ?? embedderId ?? null
      break
    }
    case 'rag.ingest.started':
    case 'rag.ingest.completed':
    case 'rag.ingest.failed': {
      const displayName =
        typeof p.displayName === 'string' ? p.displayName : undefined
      const chunkCount = typeof p.chunkCount === 'number' ? p.chunkCount : undefined
      s =
        displayName && chunkCount !== undefined
          ? `${displayName} (${chunkCount} chunks)`
          : displayName ?? null
      break
    }
    case 'rag.query.completed':
    case 'rag.query.failed':
    case 'rag.rerank.completed': {
      const preview =
        typeof p.queryPreview === 'string' ? p.queryPreview : undefined
      const fusedCount =
        typeof p.fusedCount === 'number' ? p.fusedCount : undefined
      s =
        preview && fusedCount !== undefined
          ? `${preview} → ${fusedCount}`
          : preview ?? null
      break
    }
    case 'chat.cancelled':
    case 'chat.error':
    case 'security.decision':
    case 'permission.policy.created':
    case 'permission.policy.updated':
    case 'permission.policy.deleted':
      s = null
      break
  }
  return s ? truncate(s, maxChars) : null
}

function truncate(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s
  return s.slice(0, Math.max(0, maxChars - 1)) + '…'
}

// ──────────────────── severity → CSS / glyph ────────────────────

export interface SeverityStyle {
  /** Tailwind class chunk for the dot/pill. Uses the harness's --colour vars. */
  dotClass: string
  /** ARIA + tooltip label. */
  label: string
}

export function severityStyle(severity: EventSeverity): SeverityStyle {
  switch (severity) {
    case 'error':
      return { dotClass: 'bg-red-500', label: 'Error' }
    case 'warning':
      return { dotClass: 'bg-amber-500', label: 'Warning' }
    case 'info':
    default:
      return {
        dotClass: 'bg-[var(--text-muted)]',
        label: 'Info'
      }
  }
}

// ──────────────────── time formatting ────────────────────

/**
 * Format a timestamp as the local time-of-day (HH:MM:SS). Wrapped so tests
 * can pin a deterministic locale; in production we want the user's locale.
 * Returns "—" for invalid input so the row still lays out cleanly.
 */
export function formatEventTime(ms: number, locale: string = 'en-US'): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—'
  try {
    const d = new Date(ms)
    return d.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
  } catch {
    return '—'
  }
}

// ──────────────────── grouping ────────────────────

export interface CorrelationGroup {
  correlationId: string | null
  /** Earliest createdAt across the group. */
  startedAt: number
  /** Latest createdAt across the group. */
  endedAt: number
  events: EventRecord[]
}

/**
 * Group events by correlationId for the timeline view. Events without a
 * correlationId become their own one-element groups so the renderer renders
 * the full feed without dropping unlinked rows.
 *
 * Groups are returned in start-time order (ascending or descending matching
 * the caller's preferred order). Within a group, events stay in the order
 * they were passed in — callers should pass them already sorted by createdAt.
 */
export function groupEventsByCorrelation(
  events: readonly EventRecord[],
  order: 'asc' | 'desc' = 'desc'
): CorrelationGroup[] {
  const byKey: Map<string, EventRecord[]> = new Map()
  // Events without a correlationId get unique synthetic keys so they don't
  // collide with each other but also don't try to join real runs.
  let anon = 0
  for (const e of events) {
    const key = e.correlationId ?? `__anon_${anon++}`
    const bucket = byKey.get(key)
    if (bucket) bucket.push(e)
    else byKey.set(key, [e])
  }
  const groups: CorrelationGroup[] = []
  for (const [key, bucket] of byKey) {
    const times = bucket.map((e) => e.createdAt)
    groups.push({
      correlationId: key.startsWith('__anon_') ? null : key,
      startedAt: Math.min(...times),
      endedAt: Math.max(...times),
      events: bucket
    })
  }
  groups.sort((a, b) =>
    order === 'asc' ? a.startedAt - b.startedAt : b.startedAt - a.startedAt
  )
  return groups
}
