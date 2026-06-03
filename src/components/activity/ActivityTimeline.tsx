import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  eventSubtitle,
  eventTypeLabel,
  formatEventTime,
  severityStyle
} from '@/lib/event-presentation'
import type {
  EventListFilter,
  EventRecord,
  EventTimelineFilter
} from '@/lib/types'

// Minimal, read-only Activity Timeline. Reads the event spine via
// window.api.events. NO writes — the renderer cannot record events; producers
// live in the main process. See electron/services/event-log.ts for the
// rationale.
//
// Scope modes (mirrors EventTimelineFilter):
//   - recent       → events:list with no scope filter (newest 100)
//   - conversation → events:timeline { conversationId }
//   - project      → events:timeline { projectId }
//   - workspace    → events:timeline { workspacePath }
//   - correlation  → events:timeline { correlationId } — reconstructs one run

type ScopeMode = 'recent' | 'conversation' | 'project' | 'workspace' | 'correlation'

const SCOPE_LABELS: Record<ScopeMode, string> = {
  recent: 'Recent activity',
  conversation: 'By conversation',
  project: 'By project',
  workspace: 'By workspace',
  correlation: 'By chat-run ID'
}

const SCOPE_HINTS: Record<ScopeMode, string> = {
  recent: 'Newest 100 events from every category.',
  conversation: 'Enter a conversation id — everything that happened on that thread.',
  project: 'Enter a project id — created, archived, pinned, deleted.',
  workspace: 'Enter an absolute workspace path — workspace + worktree changes.',
  correlation:
    'Enter a chat-run correlation id — model + tool + agent + approval events from one turn.'
}

export function ActivityTimeline() {
  const [mode, setMode] = useState<ScopeMode>('recent')
  const [scopeValue, setScopeValue] = useState('')
  const [events, setEvents] = useState<EventRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The fetch closure has to handle two API shapes — `list` for the unbounded
  // recent view, `timeline` for any scope. Keep them separate so a missing
  // scope value in `correlation` mode doesn't accidentally pull the whole log.
  const fetchEvents = useCallback(async () => {
    if (!window.api?.events) {
      setError('event spine not available')
      return
    }
    setLoading(true)
    setError(null)
    try {
      if (mode === 'recent') {
        const filter: EventListFilter = { limit: 100, order: 'desc' }
        const res = await window.api.events.list(filter)
        if (res?.success) {
          setEvents(res.data as EventRecord[])
        } else {
          setError(res?.error ?? 'list failed')
          setEvents([])
        }
        return
      }
      if (!scopeValue.trim()) {
        setEvents([])
        return
      }
      const filter: EventTimelineFilter = { limit: 500 }
      if (mode === 'conversation') filter.conversationId = scopeValue.trim()
      else if (mode === 'project') filter.projectId = scopeValue.trim()
      else if (mode === 'workspace') filter.workspacePath = scopeValue.trim()
      else if (mode === 'correlation') filter.correlationId = scopeValue.trim()
      const res = await window.api.events.timeline(filter)
      if (res?.success) {
        setEvents(res.data as EventRecord[])
      } else {
        setError(res?.error ?? 'timeline failed')
        setEvents([])
      }
    } finally {
      setLoading(false)
    }
  }, [mode, scopeValue])

  // Auto-refresh in 'recent' mode whenever the user lands on the tab. Other
  // scopes wait for an explicit "Show" press so we don't fan out timeline
  // queries on every keystroke.
  useEffect(() => {
    if (mode === 'recent') void fetchEvents()
  }, [mode, fetchEvents])

  const rows = useMemo(() => events.slice(0, 500), [events])

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[14px] font-medium text-[var(--text-primary)]">
          Activity Timeline
        </h2>
        <p className="mt-1 text-[12px] text-[var(--text-muted)]">
          Read-only view of the local event spine. The renderer cannot write
          here — every row was produced by a main-process service.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-1">
          {(Object.keys(SCOPE_LABELS) as ScopeMode[]).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m)
                setScopeValue('')
                setEvents([])
              }}
              className={`rounded border px-2 py-1 font-mono text-[11px] transition-colors ${
                mode === m
                  ? 'border-[var(--text-primary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                  : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {SCOPE_LABELS[m]}
            </button>
          ))}
        </div>

        <p className="text-[11px] text-[var(--text-muted)]">{SCOPE_HINTS[mode]}</p>

        {mode !== 'recent' && (
          <div className="flex gap-2">
            <input
              type="text"
              value={scopeValue}
              onChange={(e) => setScopeValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void fetchEvents()
              }}
              placeholder={
                mode === 'workspace' ? '/absolute/path' : 'paste an id…'
              }
              className="flex-1 rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 font-mono text-[12px] text-[var(--text-primary)] placeholder-[var(--text-muted)]"
            />
            <button
              onClick={() => void fetchEvents()}
              disabled={!scopeValue.trim() || loading}
              className="rounded border border-[var(--border)] px-3 py-1 font-mono text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
            >
              {loading ? 'Loading…' : 'Show'}
            </button>
          </div>
        )}
        {mode === 'recent' && (
          <button
            onClick={() => void fetchEvents()}
            disabled={loading}
            className="rounded border border-[var(--border)] px-3 py-1 font-mono text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 font-mono text-[11px] text-red-300">
          {error}
        </div>
      )}

      <div className="space-y-1">
        {rows.length === 0 && !loading && !error && (
          <p className="font-mono text-[11px] text-[var(--text-muted)]">
            No events yet for this scope.
          </p>
        )}
        {rows.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </div>
    </div>
  )
}

function EventRow({ event }: { event: EventRecord }) {
  const style = severityStyle(event.severity)
  const subtitle = eventSubtitle(event)
  return (
    <div className="flex gap-2 rounded border border-[var(--border)]/50 bg-[var(--bg-primary)]/50 px-2 py-1">
      <span
        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${style.dotClass}`}
        aria-label={style.label}
        title={style.label}
      />
      <div className="flex-1 overflow-hidden">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-mono text-[12px] text-[var(--text-primary)]">
            {eventTypeLabel(event.type)}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">
            {formatEventTime(event.createdAt)}
          </span>
        </div>
        {subtitle && (
          <div className="truncate font-mono text-[11px] text-[var(--text-secondary)]">
            {subtitle}
          </div>
        )}
        {event.correlationId && (
          <div className="truncate font-mono text-[10px] text-[var(--text-muted)]">
            run {event.correlationId.slice(0, 8)}
            {event.toolCallId && ` · tool ${event.toolCallId.slice(0, 8)}`}
          </div>
        )}
      </div>
    </div>
  )
}
