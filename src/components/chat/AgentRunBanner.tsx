import { useAgentStore } from '@/stores/agent-store'

const ROLE_ORDER: Array<'planner' | 'coder' | 'reviewer'> = ['planner', 'coder', 'reviewer']

export function AgentRunBanner() {
  const mode = useAgentStore((s) => s.mode)
  const activeRun = useAgentStore((s) => s.activeRun)

  if (mode !== 'multi' || activeRun.length === 0) return null

  return (
    <div className="pointer-events-auto mb-2 flex w-full max-w-3xl items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-[11px]">
      <span className="font-mono uppercase tracking-wider text-[var(--text-muted)]">Pipeline</span>
      <div className="flex flex-1 items-center gap-2">
        {ROLE_ORDER.map((role, idx) => {
          const entry = activeRun.find((e) => e.role === role)
          const state = entry?.state ?? 'pending'
          const dotClass =
            state === 'running'
              ? 'bg-[var(--accent)] animate-pulse'
              : state === 'done'
              ? 'bg-[var(--success)]'
              : state === 'error'
              ? 'bg-[var(--error)]'
              : 'bg-[var(--text-muted)]/40'
          return (
            <div key={role} className="flex items-center gap-1.5">
              <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} aria-hidden />
              <span className="font-mono text-[var(--text-secondary)]">
                {role}
                {entry?.model && (
                  <span className="ml-1 text-[var(--text-muted)]">· {entry.model}</span>
                )}
              </span>
              {idx < ROLE_ORDER.length - 1 && (
                <span className="text-[var(--text-muted)]">→</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
