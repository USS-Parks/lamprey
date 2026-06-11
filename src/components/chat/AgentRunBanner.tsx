import { useChatStore } from '@/stores/chat-store'
import { useSettingsStore } from '@/stores/settings-store'
import type { AgentRunPhase } from '@/lib/types'

// 2026-06-10 user direction — the multi-agent stage banner that used to
// render here (planner → coder → reviewer dots above the input pill) is
// DELETED, not gated: that dispatch path is retired and its toggle is gone
// from Settings. What remains is the single-mode run-phase pill — the
// era-style one-line status ("Reading your message", "Editing", …).

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
  const runPhase = useChatStore((s) => s.runPhase)
  const codingMode = useSettingsStore((s) => s.settings.agenticCodingMode)

  // Show the run-phase pill while a run is active. The store nulls runPhase
  // on terminal phases, so this unmounts itself when the model finishes.
  if (runPhase && runPhase !== 'done' && runPhase !== 'error') {
    return <RunPhasePill phase={runPhase} codingMode={codingMode} />
  }

  return null
}
