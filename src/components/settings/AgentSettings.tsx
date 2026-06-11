import { useEffect } from 'react'
import { useModelStore } from '@/stores/model-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useAgentStore } from '@/stores/agent-store'
import type { AgentRole, AgentRoster } from '@/lib/types'

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
  const roster = useAgentStore((s) => s.roster)
  const setRole = useAgentStore((s) => s.setRole)
  const hydrate = useAgentStore((s) => s.hydrate)

  useEffect(() => {
    if (models.length === 0) void loadModels()
  }, [models.length, loadModels])

  useEffect(() => {
    // UB-6 — roster-only hydration; mode died with the pipeline.
    hydrate(settings.agentRoster)
  }, [settings.agentRoster, hydrate])

  const persistRole = async (role: AgentRole, modelId: string) => {
    setRole(role, modelId)
    const next: AgentRoster = { ...roster, [role]: modelId }
    await updateSettings({ agentRoster: next })
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-mono text-sm font-semibold text-[var(--text-primary)]">Agent roster</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">
          Assign a model to each of Lamprey's roles. The Co-worker powers the side chat; the
          remaining slots are legacy and slated for removal.
        </p>
      </div>

      <div className="space-y-2">
        {(Object.keys(ROLE_LABELS) as AgentRole[]).map((role) => {
          const meta = ROLE_LABELS[role]
          const value = roster[role] || ''
          return (
            <div
              key={role}
              className="space-y-1 rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-3"
            >
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-xs font-semibold text-[var(--text-primary)]">
                  {meta.title}
                </span>
                <span className="font-mono text-[12px] text-[var(--text-muted)]">{value}</span>
              </div>
              <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">{meta.blurb}</p>
              <select
                value={value}
                onChange={(e) => void persistRole(role, e.target.value)}
                className="mt-1 w-full rounded border border-[var(--panel-border)] bg-[var(--bg-secondary)] px-2 py-1 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
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
