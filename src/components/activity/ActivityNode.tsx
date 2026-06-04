import type { ReactElement } from 'react'
import type { ActivityKind, ActivityNodeModel, ActivityStatus } from '@/stores/activity-store'

const KIND_LABEL: Record<ActivityKind, string> = {
  conversation: 'Chat',
  workflow: 'Flow',
  agent: 'Agent',
  cron: 'Cron',
  loop: 'Loop',
  hook: 'Hook'
}

const STATUS_CLASS: Record<ActivityStatus, string> = {
  running: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  idle: 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]',
  done: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  error: 'bg-red-500/15 text-red-700 dark:text-red-300',
  aborted: 'bg-gray-500/15 text-gray-700 dark:text-gray-300',
  disabled: 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
}

function formatElapsed(startedAt?: number | null, finishedAt?: number | null): string {
  if (!startedAt) return ''
  const ms = Math.max(0, (finishedAt ?? Date.now()) - startedAt)
  if (ms < 1000) return '<1s'
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

function Icon({ kind }: { kind: ActivityKind }): ReactElement {
  if (kind === 'workflow') {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M6 6h12M6 12h8M6 18h12" />
        <circle cx="4" cy="6" r="1.3" fill="currentColor" stroke="none" />
        <circle cx="4" cy="12" r="1.3" fill="currentColor" stroke="none" />
        <circle cx="4" cy="18" r="1.3" fill="currentColor" stroke="none" />
      </svg>
    )
  }
  if (kind === 'agent') {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <rect x="5" y="7" width="14" height="11" rx="2" />
        <path d="M9 7V4h6v3M9 12h.01M15 12h.01M10 16h4" />
      </svg>
    )
  }
  if (kind === 'cron' || kind === 'loop') {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v5l3 2" />
      </svg>
    )
  }
  if (kind === 'hook') {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M8 5v7a4 4 0 1 0 8 0V5" />
        <path d="M8 5H5M16 5h3" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M5 6h14v9H8l-3 3V6Z" />
    </svg>
  )
}

interface ActivityNodeProps {
  node: ActivityNodeModel
  depth?: number
  pinnedIds: string[]
  onTogglePin: (id: string) => void
  onAbort?: (node: ActivityNodeModel) => void
}

export function ActivityNode({
  node,
  depth = 0,
  pinnedIds,
  onTogglePin,
  onAbort
}: ActivityNodeProps): ReactElement {
  const elapsed = formatElapsed(node.startedAt, node.finishedAt)
  const childNodes = node.children ?? []
  const pinned = pinnedIds.includes(node.id)

  return (
    <div data-activity-node={node.id}>
      <div
        className="group flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[var(--bg-primary)] text-[var(--text-muted)]">
          <Icon kind={node.kind} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium text-[var(--text-primary)]">{node.title}</span>
            <span className="shrink-0 rounded px-1 py-0.5 font-mono text-[9px] uppercase text-[var(--text-muted)]">
              {KIND_LABEL[node.kind]}
            </span>
          </div>
          {(node.subtitle || elapsed || node.tokenEstimate) && (
            <div className="truncate font-mono text-[10px] text-[var(--text-muted)]">
              {node.subtitle}
              {elapsed && `${node.subtitle ? ' · ' : ''}${elapsed}`}
              {node.tokenEstimate ? ` · ~${node.tokenEstimate.toLocaleString()} tok` : ''}
            </div>
          )}
        </div>
        <span className={`shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase ${STATUS_CLASS[node.status]}`}>
          {node.status}
        </span>
        {node.canAbort && (
          <button
            type="button"
            onClick={() => onAbort?.(node)}
            title="Stop"
            aria-label={`Stop ${node.title}`}
            className="hidden h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-red-500/10 hover:text-red-500 group-hover:flex"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden>
              <rect x="7" y="7" width="10" height="10" rx="1" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={() => onTogglePin(node.id)}
          title={pinned ? 'Unpin from watching tray' : 'Pin to watching tray'}
          aria-label={pinned ? `Unpin ${node.title}` : `Pin ${node.title}`}
          className={`hidden h-6 w-6 shrink-0 items-center justify-center rounded transition-colors group-hover:flex ${
            pinned
              ? 'text-[var(--accent)]'
              : 'text-[var(--text-muted)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]'
          }`}
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="M12 4l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8L12 4Z" />
          </svg>
        </button>
      </div>
      {childNodes.length > 0 && (
        <div className="mt-0.5">
          {childNodes.map((child) => (
            <ActivityNode
              key={child.id}
              node={child}
              depth={depth + 1}
              pinnedIds={pinnedIds}
              onTogglePin={onTogglePin}
              onAbort={onAbort}
            />
          ))}
        </div>
      )}
    </div>
  )
}
