import type { ReactElement } from 'react'
import type { ActivityNodeModel } from '@/stores/activity-store'

interface ActivityTrayProps {
  nodes: ActivityNodeModel[]
  onUnpin: (id: string) => void
}

export function ActivityTray({ nodes, onUnpin }: ActivityTrayProps): ReactElement | null {
  if (nodes.length === 0) return null
  return (
    <div className="mx-3 mt-2 rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)]/70 p-2" data-testid="activity-tray">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
          Watching
        </span>
        <span className="font-mono text-[10px] text-[var(--text-muted)]">{nodes.length}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            onClick={() => onUnpin(node.id)}
            title={`Unpin ${node.title}`}
            className="max-w-full rounded border border-[var(--panel-border)] bg-[var(--bg-secondary)] px-1.5 py-1 text-left transition-colors hover:bg-[var(--bg-tertiary)]"
          >
            <span className="block max-w-[10rem] truncate text-[11px] text-[var(--text-primary)]">
              {node.title}
            </span>
            <span className="block font-mono text-[9px] uppercase text-[var(--text-muted)]">
              {node.kind} · {node.status}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
