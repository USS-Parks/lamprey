import { useAgentStore } from '@/stores/agent-store'
import { useChatStore } from '@/stores/chat-store'
import { useSettingsStore } from '@/stores/settings-store'
import type { AgentRunPhase } from '@/lib/types'

const ROLE_ORDER: Array<'planner' | 'coder' | 'reviewer'> = ['planner', 'coder', 'reviewer']

// Plain-English mapping shown in the pill. Mirrored from main-side intent —
// the labels are user-facing, not technical names. Keep the wording short
// (fits inside the pill) and present-progressive ("Reading", "Editing") so
// it reads as a live action.
const PHASE_LABEL: Record<AgentRunPhase, string> = {
  understanding: 'Reading your message',
  gathering_context: 'Reading project',
  planning: 'Planning',
  acting: 'Editing',
  verifying: 'Checking result',
  summarizing: 'Wrapping up',
  done: 'Done',
  error: 'Stopped'
}

function RunPhasePill({ phase, codingMode }: { phase: AgentRunPhase; codingMode: boolean }) {
  const label = PHASE_LABEL[phase]
  const isError = phase === 'error'
  const isDone = phase === 'done'
  const dotClass = isError
    ? 'bg-[var(--error)]'
    : isDone
    ? 'bg-[var(--success)]'
    : 'bg-[var(--accent)] animate-pulse'
  return (
    <div
      className="pointer-events-auto mb-2 inline-flex items-center gap-2 rounded-full bg-[var(--bg-tertiary)] px-3 py-1 text-[12px]"
      role="status"
      aria-live="polite"
    >
      <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} aria-hidden />
      <span className="font-mono uppercase tracking-wider text-[var(--text-muted)]">Lamprey</span>
      {codingMode && (
        <>
          <span
            className="font-mono uppercase tracking-wider text-[var(--accent)]"
            title="Agentic coding mode is on"
          >
            Coding
          </span>
          <span className="text-[var(--text-muted)]" aria-hidden>
            ·
          </span>
        </>
      )}
      <span className="text-[var(--text-secondary)]">{label}</span>
    </div>
  )
}

export function AgentRunBanner() {
  const mode = useAgentStore((s) => s.mode)
  const activeRun = useAgentStore((s) => s.activeRun)
  const runPhase = useChatStore((s) => s.runPhase)
  const codingMode = useSettingsStore((s) => s.settings.agenticCodingMode)

  // Multi-agent mode renders the role pipeline (planner / coder /
  // reviewer fan-out). Unreachable until the agent store sets `mode` to
  // 'multi' and `activeRun` receives status events; kept as the rendering
  // surface for that path.
  if (mode === 'multi' && activeRun.length > 0) {
    return (
      <div className="pointer-events-auto mb-2 flex w-full items-center gap-3 rounded-lg bg-[var(--bg-tertiary)] px-3 py-2 text-[13px]">
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

  // Single-agent mode: show the run-phase pill while a run is active. The
  // store nulls runPhase on terminal phases, so this branch unmounts itself
  // when the model finishes.
  if (runPhase && runPhase !== 'done' && runPhase !== 'error') {
    return <RunPhasePill phase={runPhase} codingMode={codingMode} />
  }

  return null
}
