import { useEffect, useMemo } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import { useSkillsStore } from '@/stores/skills-store'

// UB-7 (Unburdening Phase, 2026-06-10) — the final-response composer option
// block died with the composer (UB-5). Agentic coding mode is exactly two
// things now: the coding contract role + the auto-activated skill set.

const BUNDLED_WORKFLOW_SKILL_IDS = new Set([
  'context',
  'debug',
  'fan-out',
  'frontend-qa',
  'plan',
  'review',
  'verify'
])

export function AgenticCodingSettings() {
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const skills = useSkillsStore((s) => s.skills)
  const loadSkills = useSkillsStore((s) => s.loadSkills)

  useEffect(() => {
    if (skills.length === 0) void loadSkills()
  }, [skills.length, loadSkills])

  // Only the bundled workflow skills are eligible for the auto-activation
  // list — the contract role is "coding" and these are the curated
  // companions. Custom skills stay reachable via the regular skill panel.
  const workflowSkills = useMemo(
    () => skills.filter((s) => BUNDLED_WORKFLOW_SKILL_IDS.has(s.id)),
    [skills]
  )

  const selected = new Set(settings.agenticCodingSkills)

  const toggleSkill = (id: string) => {
    const next = selected.has(id)
      ? settings.agenticCodingSkills.filter((x) => x !== id)
      : [...settings.agenticCodingSkills, id]
    void updateSettings({ agenticCodingSkills: next })
  }

  return (
    <div className="space-y-5">
      <h3 className="font-mono text-sm font-semibold text-[var(--text-primary)]">
        Agentic coding mode
      </h3>

      <section className="space-y-3">
        <label className="flex cursor-pointer items-start gap-3 rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-3 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)]">
          <input
            type="checkbox"
            checked={settings.agenticCodingMode}
            onChange={(e) => updateSettings({ agenticCodingMode: e.target.checked })}
            className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
          />
          <span className="flex-1">
            <span className="block font-medium text-[var(--text-primary)]">
              Enable agentic coding mode
            </span>
            <span className="mt-1 block text-[13px] leading-relaxed text-[var(--text-muted)]">
              Every chat turn layers the coding contract role on top of the base prompt,
              auto-activates the workflow skills selected below, and runs the final-response composer
              per the mode you pick. Off by default.
            </span>
          </span>
        </label>
      </section>

      <section className="space-y-3">
        <h4 className="font-mono text-[13px] uppercase tracking-wider text-[var(--text-muted)]">
          Auto-activated skills
        </h4>
        <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">
          When mode is on, these workflow skills are merged into every turn&apos;s active set
          (your manually-toggled skills are kept as-is, no duplicates).
        </p>
        {workflowSkills.length === 0 ? (
          <div className="rounded border border-dashed border-[var(--panel-border)] p-3 text-[13px] text-[var(--text-muted)]">
            No bundled workflow skills are installed yet. Drop the bundled{' '}
            <code className="font-mono">plan</code>, <code className="font-mono">context</code>, and{' '}
            <code className="font-mono">verify</code> SKILL.md files into your skills directory.
          </div>
        ) : (
          <div className="space-y-1.5">
            {workflowSkills.map((skill) => (
              <label
                key={skill.id}
                className="flex cursor-pointer items-start gap-3 rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)]"
              >
                <input
                  type="checkbox"
                  checked={selected.has(skill.id)}
                  onChange={() => toggleSkill(skill.id)}
                  className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
                />
                <span className="flex-1">
                  <span className="block font-medium text-[var(--text-primary)]">
                    {skill.name}{' '}
                    <span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                      {skill.id}
                    </span>
                  </span>
                  {skill.description && (
                    <span className="mt-1 block text-[13px] leading-relaxed text-[var(--text-muted)]">
                      {skill.description}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
