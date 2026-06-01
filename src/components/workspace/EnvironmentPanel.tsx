import { useRef, useState } from 'react'
import { useUiStore } from '@/stores/ui-store'
import { useAgentStore } from '@/stores/agent-store'
import { useEnvironment } from '@/hooks/useEnvironment'
import { useSources } from '@/hooks/useSources'
import { toast } from '@/stores/toast-store'
import { WorkModePopover } from './WorkModePopover'
import { BranchPickerPopover } from './BranchPickerPopover'

function ChevronDownGlyph(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function ChangesGlyph(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  )
}

function MonitorGlyph(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  )
}

function BranchGlyph(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )
}

function CommitGlyph(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <line x1="2" y1="12" x2="8" y2="12" />
      <line x1="16" y1="12" x2="22" y2="12" />
    </svg>
  )
}

interface PanelRowProps {
  leading: React.ReactNode
  label: string
  trailing?: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  title?: string
  buttonRef?: React.Ref<HTMLButtonElement>
}

function PanelRow({
  leading,
  label,
  trailing,
  onClick,
  disabled,
  title,
  buttonRef
}: PanelRowProps): React.ReactElement {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => {
        if (disabled) return
        onClick?.()
      }}
      disabled={disabled}
      title={title}
      className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] transition-colors ${
        disabled
          ? 'cursor-not-allowed text-[var(--text-muted)] opacity-60'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{leading}</span>
      <span className="flex-1 truncate">{label}</span>
      {trailing && <span className="shrink-0">{trailing}</span>}
    </button>
  )
}

export function EnvironmentPanel(): React.ReactElement {
  const setActiveTool = useUiStore((s) => s.setActiveTool)
  const agentMode = useAgentStore((s) => s.mode)
  const { snapshot, refresh } = useEnvironment()
  const { sources, groups } = useSources()

  const workModeRef = useRef<HTMLButtonElement>(null)
  const branchRef = useRef<HTMLButtonElement>(null)
  const [workModeOpen, setWorkModeOpen] = useState(false)
  const [branchOpen, setBranchOpen] = useState(false)
  const [committing, setCommitting] = useState(false)

  const handleCommitOrPush = async () => {
    if (committing || !window.api?.review) return
    if (snapshot.hasChanges) {
      const msg = window.prompt('Commit message:')
      if (!msg?.trim()) return
      setCommitting(true)
      const res = await window.api.review.commit({ message: msg.trim(), stageAll: true })
      setCommitting(false)
      if (!res.success) {
        toast.error(res.error ?? 'Commit failed')
        return
      }
      toast.success('Committed')
      void refresh()
    } else if (snapshot.ahead > 0) {
      setCommitting(true)
      const res = await window.api.review.push()
      setCommitting(false)
      if (!res.success) {
        toast.error(res.error ?? 'Push failed')
        return
      }
      toast.success('Pushed')
      void refresh()
    }
  }

  const commitDisabled = !snapshot.hasChanges && snapshot.ahead === 0
  const commitLabel = snapshot.hasChanges
    ? 'Commit'
    : snapshot.ahead > 0
    ? `Push (${snapshot.ahead} ahead)`
    : 'Commit or push'
  const workModeLabel = agentMode === 'multi' ? 'Pipeline' : 'Local'

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-2">
      <PanelRow
        leading={<ChangesGlyph />}
        label="Changes"
        trailing={
          <span className="font-mono text-[11px]">
            <span className="text-green-500">+{snapshot.additions}</span>{' '}
            <span className="text-red-500">-{snapshot.deletions}</span>
          </span>
        }
        onClick={() => setActiveTool('review')}
      />
      <PanelRow
        buttonRef={workModeRef}
        leading={<MonitorGlyph />}
        label={workModeLabel}
        trailing={<ChevronDownGlyph />}
        onClick={() => setWorkModeOpen((v) => !v)}
      />
      <PanelRow
        buttonRef={branchRef}
        leading={<BranchGlyph />}
        label={snapshot.branch ?? 'detached HEAD'}
        trailing={<ChevronDownGlyph />}
        onClick={() => setBranchOpen((v) => !v)}
        title={
          snapshot.ahead || snapshot.behind
            ? `↑${snapshot.ahead} ↓${snapshot.behind}`
            : undefined
        }
      />
      <PanelRow
        leading={<CommitGlyph />}
        label={commitLabel}
        onClick={() => void handleCommitOrPush()}
        disabled={commitDisabled || committing}
      />

      <div className="my-2 border-t border-[var(--border)]" aria-hidden />

      <div className="px-3 pb-1 pt-1 text-[12px] font-medium text-[var(--text-secondary)]">
        Sources
      </div>
      {sources.length === 0 ? (
        <div className="px-3 pb-2 text-[12px] text-[var(--text-muted)]">No sources yet</div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {(['files', 'skills', 'memory', 'mcp'] as const).map((groupKey) => {
            const group = groups[groupKey]
            if (group.length === 0) return null
            const labels = {
              files: 'Files',
              skills: 'Skills',
              memory: 'Memory',
              mcp: 'MCP servers'
            }
            return (
              <div key={groupKey}>
                <div className="px-3 pb-0.5 pt-2 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  {labels[groupKey]}
                </div>
                {group.map((item) => (
                  <div
                    key={item.id}
                    className="group flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                  >
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    {item.subtitle && (
                      <span className="shrink-0 truncate font-mono text-[10px] text-[var(--text-muted)]">
                        {item.subtitle}
                      </span>
                    )}
                    {item.onRemove && (
                      <button
                        type="button"
                        onClick={item.onRemove}
                        aria-label={`Remove ${item.title}`}
                        className="rounded p-0.5 text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--text-primary)] group-hover:opacity-100"
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
            )
          })}
        </div>
      )}

      <WorkModePopover
        open={workModeOpen}
        onClose={() => setWorkModeOpen(false)}
        anchorRef={workModeRef}
      />
      <BranchPickerPopover
        open={branchOpen}
        onClose={() => setBranchOpen(false)}
        anchorRef={branchRef}
        onChanged={() => void refresh()}
      />
    </div>
  )
}
