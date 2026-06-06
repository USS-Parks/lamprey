import { useSources } from '@/hooks/useSources'
import { PanelEmptyState } from '@/components/ui/PanelEmptyState'
import { pickAndAttachFiles } from '@/lib/attach-file'

function SourcesGlyph(): React.ReactElement {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M3 12l9 4 9-4" />
      <path d="M3 17l9 4 9-4" />
    </svg>
  )
}

function KindBadge({ kind }: { kind: string }): React.ReactElement {
  const label =
    kind === 'file' ? 'FILE' : kind === 'skill' ? 'SKILL' : kind === 'memory' ? 'MEM' : 'MCP'
  return (
    <span className="shrink-0 rounded border border-[var(--panel-border)] bg-[var(--bg-tertiary)] px-1 font-mono text-[9px] text-[var(--text-muted)]">
      {label}
    </span>
  )
}

export function SourcesPanel(): React.ReactElement {
  const { sources, groups } = useSources()

  if (sources.length === 0) {
    return (
      <PanelEmptyState
        icon={<SourcesGlyph />}
        title="No sources yet"
        body="Attach files, enable a skill, pin a memory, or connect an MCP server to see them here."
        action={
          <button
            type="button"
            onClick={() => void pickAndAttachFiles()}
            className="rounded-md border border-[var(--panel-border)] bg-[var(--bg-tertiary)] px-3 py-1 text-[12px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
          >
            Attach file…
          </button>
        }
      />
    )
  }

  const labels = {
    files: 'Files',
    skills: 'Skills',
    memory: 'Memory',
    mcp: 'MCP servers'
  } as const

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-3">
      {(['files', 'skills', 'memory', 'mcp'] as const).map((groupKey) => {
        const group = groups[groupKey]
        if (group.length === 0) return null
        return (
          <div key={groupKey} className="mb-3">
            <div className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              {labels[groupKey]}{' '}
              <span className="font-mono text-[10px]">({group.length})</span>
            </div>
            <div className="flex flex-col gap-1">
              {group.map((item) => (
                <div
                  key={item.id}
                  className="group flex items-center gap-2 rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1.5 text-[12px] transition-colors hover:border-[var(--accent)]"
                >
                  <KindBadge kind={item.kind} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[var(--text-primary)]">{item.title}</span>
                    {item.subtitle && (
                      <span className="truncate text-[10px] text-[var(--text-muted)]">
                        {item.subtitle}
                      </span>
                    )}
                  </div>
                  {item.onRemove && (
                    <button
                      type="button"
                      onClick={item.onRemove}
                      aria-label={`Remove ${item.title}`}
                      className="rounded p-1 text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--text-primary)] group-hover:opacity-100"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
