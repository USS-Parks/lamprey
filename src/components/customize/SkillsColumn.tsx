import { useEffect, useMemo, useState } from 'react'
import type { Skill } from '@/lib/types'
import { toast } from '@/stores/toast-store'
import { useSkillsStore } from '@/stores/skills-store'
import { useCcImportStore } from '@/stores/cc-import-store'
import { NewSkillWizard } from './NewSkillWizard'

interface SkillDraft {
  name: string
  description: string
  content: string
}

function isBundledSkill(skill: Skill): boolean {
  // bundled skills resolve out of `resources/skills/` (dev) or
  // `process.resourcesPath/skills` (prod). userData-rooted paths always
  // contain the platform-specific Lamprey app dir name.
  const fp = skill.filePath.replace(/\\/g, '/')
  return fp.includes('/resources/skills/')
}

function validateDraft(draft: SkillDraft): string[] {
  const errors: string[] = []
  if (!draft.name.trim()) errors.push('name is required')
  if (!draft.description.trim()) errors.push('description is required')
  if (!draft.content.trim()) errors.push('content is required')
  return errors
}

interface EditDrawerProps {
  skill: Skill
  onClose: () => void
}

function EditDrawer({ skill, onClose }: EditDrawerProps) {
  const updateSkill = useSkillsStore((s) => s.updateSkill)
  const [draft, setDraft] = useState<SkillDraft>({
    name: skill.name,
    description: skill.description,
    content: skill.content
  })
  const errors = useMemo(() => validateDraft(draft), [draft])
  const bundled = isBundledSkill(skill)

  const onSave = async () => {
    if (errors.length) {
      toast.error(errors[0])
      return
    }
    await updateSkill(skill.id, draft)
    toast.success(`Skill "${draft.name}" saved`)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-end bg-black/40">
      <div className="flex h-full w-[480px] flex-col border-l border-[var(--border)] bg-[var(--bg-secondary)] shadow-2xl">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border)] px-4">
          <span className="text-[14px] font-semibold text-[var(--text-primary)]">
            Edit skill
          </span>
          {bundled && (
            <span className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              bundled
            </span>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <div className="truncate font-mono text-[10px] text-[var(--text-muted)]" title={skill.filePath}>
            {skill.filePath}
          </div>
          {skill.supportingFiles && skill.supportingFiles.length > 0 && (
            <details className="rounded border border-[var(--border)] bg-[var(--bg-primary)] p-2 text-[11px] text-[var(--text-secondary)]">
              <summary className="cursor-pointer select-none text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                Supporting files ({skill.supportingFiles.length})
              </summary>
              <ul className="mt-1.5 space-y-0.5 pl-3 font-mono text-[10px]">
                {skill.supportingFiles.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                These siblings are listed shallow — the skill body may also reference
                files nested in subdirectories that aren't shown here.
              </p>
            </details>
          )}

          <label className="block text-[11px] text-[var(--text-muted)]">
            Name
            <input
              value={draft.name}
              onChange={(e) => setDraft((s) => ({ ...s, name: e.target.value }))}
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
          </label>

          <label className="block text-[11px] text-[var(--text-muted)]">
            Description
            <input
              value={draft.description}
              onChange={(e) => setDraft((s) => ({ ...s, description: e.target.value }))}
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
          </label>

          <label className="block text-[11px] text-[var(--text-muted)]">
            Content (Markdown)
            <textarea
              value={draft.content}
              onChange={(e) => setDraft((s) => ({ ...s, content: e.target.value }))}
              spellCheck={false}
              className="mt-1 h-72 w-full resize-y rounded border border-[var(--border)] bg-[var(--bg-primary)] p-2 font-mono text-[12px] leading-relaxed text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
          </label>

          <div
            className={
              'rounded border px-2 py-1.5 text-[11px] ' +
              (errors.length
                ? 'border-[var(--error)] bg-[var(--error)]/10 text-[var(--error)]'
                : 'border-[var(--success)] bg-[var(--success)]/10 text-[var(--success)]')
            }
          >
            {errors.length ? `Issues: ${errors.join(', ')}` : 'Ready to save'}
          </div>
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-[var(--border)] px-4 py-3">
          <button
            onClick={onClose}
            className="rounded border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1.5 text-[12px] hover:border-[var(--accent)]"
          >
            Cancel
          </button>
          <div className="flex-1" />
          <button
            onClick={() => void onSave()}
            disabled={errors.length > 0}
            className="rounded border border-[var(--accent)] bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  )
}

interface SkillsColumnProps {
  /** Opens the InstallPluginFlow with the "From Claude Code" tab focused.
   *  CustomizeView owns the modal state, so SkillsColumn just delegates. */
  onOpenImport?: () => void
}

export function SkillsColumn({ onOpenImport }: SkillsColumnProps = {}) {
  const skills = useSkillsStore((s) => s.skills)
  const activeSkillIds = useSkillsStore((s) => s.activeSkillIds)
  const loadSkills = useSkillsStore((s) => s.loadSkills)
  const setSkillsFromEvent = useSkillsStore((s) => s.setSkillsFromEvent)
  const toggleSkill = useSkillsStore((s) => s.toggleSkill)
  const deleteSkill = useSkillsStore((s) => s.deleteSkill)
  const ejectSkill = useCcImportStore((s) => s.ejectSkill)

  const [filter, setFilter] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)

  useEffect(() => {
    void loadSkills()
  }, [loadSkills])

  useEffect(() => {
    if (!window.api?.skills?.onChanged) return
    const dispose = window.api.skills.onChanged((rows) => {
      setSkillsFromEvent(rows as Skill[])
    }) as unknown
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  }, [setSkillsFromEvent])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return skills
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    )
  }, [skills, filter])

  const editing = useMemo(
    () => skills.find((s) => s.id === editingId) ?? null,
    [skills, editingId]
  )

  const onDelete = async (skill: Skill) => {
    if (!confirm(`Delete skill "${skill.name}"?`)) return
    await deleteSkill(skill.id)
  }

  const onEject = async (skill: Skill) => {
    if (!skill.pluginId) return
    // The skill.id is `<pluginId>:<slug>`; derive the slug for the eject call.
    const slug = skill.id.startsWith(`${skill.pluginId}:`)
      ? skill.id.slice(skill.pluginId.length + 1)
      : skill.id
    const ok = confirm(
      `Eject "${skill.name}" from plugin "${skill.pluginId}" into your user skills?\n\nThe plugin copy stays in place; you'll get an editable user-skill copy.`
    )
    if (!ok) return
    await ejectSkill(skill.pluginId, slug)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Filter ${skills.length} skill${skills.length === 1 ? '' : 's'}…`}
          className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
        <button
          onClick={() => setWizardOpen(true)}
          className="rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-[12px] hover:border-[var(--accent)]"
          title="Create a new skill"
        >
          + New
        </button>
        {onOpenImport && (
          <button
            onClick={onOpenImport}
            className="rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-[12px] hover:border-[var(--accent)]"
            title="Import skills from a Claude Code bundle on this machine"
          >
            ↓ Import
          </button>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2">
        {filtered.length === 0 && (
          <div className="px-3 py-6 text-center text-[12px] text-[var(--text-muted)]">
            {skills.length === 0 ? 'No skills installed yet.' : 'No skills match this filter.'}
          </div>
        )}
        {filtered.map((skill) => {
          const enabled = activeSkillIds.includes(skill.id)
          const bundled = isBundledSkill(skill)
          return (
            <div
              key={skill.id}
              className="group mb-1 flex items-start gap-2 rounded border border-transparent p-2 hover:border-[var(--border)] hover:bg-[var(--bg-tertiary)]"
            >
              <button
                onClick={() => toggleSkill(skill.id)}
                aria-pressed={enabled}
                title={enabled ? 'Disable' : 'Enable'}
                className={`mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors ${
                  enabled
                    ? 'border-[var(--accent)] bg-[var(--accent)]'
                    : 'border-[var(--border)] bg-[var(--bg-primary)]'
                }`}
              >
                <span
                  className={`block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    enabled ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                    {skill.name}
                  </span>
                  {skill.pluginId && (
                    <span
                      className="rounded bg-[var(--bg-tertiary)] px-1 py-0 font-mono text-[9px] uppercase tracking-wider text-[var(--accent)]"
                      title={`From plugin: ${skill.pluginId}`}
                    >
                      plugin: {skill.pluginId}
                    </span>
                  )}
                  {bundled && !skill.pluginId && (
                    <span className="rounded bg-[var(--bg-tertiary)] px-1 py-0 font-mono text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
                      bundled
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">
                  {skill.description || 'No description'}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
                {skill.pluginId && (
                  <button
                    onClick={() => void onEject(skill)}
                    className="rounded p-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-[var(--accent)]"
                    title="Eject as user skill (editable copy)"
                    aria-label="Eject as user skill"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M12 19V5" />
                      <polyline points="5 12 12 5 19 12" />
                    </svg>
                  </button>
                )}
                <button
                  onClick={() => setEditingId(skill.id)}
                  className="rounded p-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
                  title="Edit"
                  aria-label="Edit"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button
                  onClick={() => void onDelete(skill)}
                  className="rounded p-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-[var(--error)]"
                  title="Delete"
                  aria-label="Delete"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {editing && <EditDrawer skill={editing} onClose={() => setEditingId(null)} />}
      {wizardOpen && <NewSkillWizard onClose={() => setWizardOpen(false)} />}
    </div>
  )
}
