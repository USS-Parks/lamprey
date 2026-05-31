import { useEffect } from 'react'
import { useModelStore } from '@/stores/model-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useAgentStore } from '@/stores/agent-store'
import { toast } from '@/stores/toast-store'
import type { AgentMode, AgentRole, AgentRoster } from '@/lib/types'

const ROLE_LABELS: Record<AgentRole, { title: string; blurb: string }> = {
  planner: {
    title: 'Planner',
    blurb: 'Decomposes the request into a short ordered plan. Best on a strong reasoning model.'
  },
  coder: {
    title: 'Coder',
    blurb: 'Executes the plan and emits diffs. Best on a high-throughput coding model.'
  },
  reviewer: {
    title: 'Reviewer',
    blurb: 'Critiques the Coder output for regressions and dead code. Strong model recommended.'
  },
  coworker: {
    title: 'Co-worker',
    blurb: 'Real-time pair on the active workspace. Optimized for low-latency long-context coding.'
  }
}

export function AgentSettings() {
  const models = useModelStore((s) => s.models)
  const loadModels = useModelStore((s) => s.loadModels)
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const agentMode = useAgentStore((s) => s.mode)
  const roster = useAgentStore((s) => s.roster)
  const setMode = useAgentStore((s) => s.setMode)
  const setRole = useAgentStore((s) => s.setRole)
  const hydrate = useAgentStore((s) => s.hydrate)

  useEffect(() => {
    if (models.length === 0) void loadModels()
  }, [models.length, loadModels])

  useEffect(() => {
    hydrate(settings.agentMode || 'single', settings.agentRoster)
  }, [settings.agentMode, settings.agentRoster, hydrate])

  const persistMode = async (next: AgentMode) => {
    setMode(next)
    await updateSettings({ agentMode: next })
    toast.success(next === 'multi' ? 'Multi-agent mode enabled' : 'Single-model mode enabled')
  }

  const persistRole = async (role: AgentRole, modelId: string) => {
    setRole(role, modelId)
    const next: AgentRoster = { ...roster, [role]: modelId }
    await updateSettings({ agentRoster: next })
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-mono text-sm font-semibold text-[var(--text-primary)]">Agent roster</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
          Lamprey can run as a single chat or as a multi-agent pipeline. In multi-agent mode the Planner,
          Coder, and Reviewer roles each get their own model — pair DeepSeek V4 Pro on planning with V4
          Flash on coding for the canonical setup, or assign Gemma / Qwen3 Coder to any role.
        </p>
      </div>

      <div className="rounded border border-[var(--border)] bg-[var(--bg-primary)] p-3">
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Run mode</div>
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => persistMode('single')}
            className={`flex-1 rounded border px-3 py-2 text-left text-xs transition-colors ${
              agentMode === 'single'
                ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]'
                : 'border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <div className="font-mono font-semibold">Single model</div>
            <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
              One model answers each turn. Tools + MCP fully active.
            </div>
          </button>
          <button
            onClick={() => persistMode('multi')}
            className={`flex-1 rounded border px-3 py-2 text-left text-xs transition-colors ${
              agentMode === 'multi'
                ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]'
                : 'border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <div className="font-mono font-semibold">Multi-agent</div>
            <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
              Planner → Coder → Reviewer pipeline, each on its own model.
            </div>
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {(Object.keys(ROLE_LABELS) as AgentRole[]).map((role) => {
          const meta = ROLE_LABELS[role]
          const value = roster[role] || ''
          return (
            <div
              key={role}
              className="space-y-1 rounded border border-[var(--border)] bg-[var(--bg-primary)] p-3"
            >
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-xs font-semibold text-[var(--text-primary)]">
                  {meta.title}
                </span>
                <span className="font-mono text-[10px] text-[var(--text-muted)]">{value}</span>
              </div>
              <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">{meta.blurb}</p>
              <select
                value={value}
                onChange={(e) => void persistRole(role, e.target.value)}
                className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.provider ? ` · ${m.provider}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )
        })}
      </div>
    </div>
  )
}
