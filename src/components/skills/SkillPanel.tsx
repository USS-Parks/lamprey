import { useState } from 'react'
import { useSkillsStore } from '@/stores/skills-store'
import { SkillEditor, type SkillEditorTarget } from './SkillEditor'

type EditorState =
  | { mode: 'closed' }
  | { mode: 'new' }
  | { mode: 'edit'; target: SkillEditorTarget }

export function SkillPanel() {
  const { skills, activeSkillIds, toggleSkill, deleteSkill } = useSkillsStore()
  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' })

  const handleCreate = () => setEditor({ mode: 'new' })

  const handleEdit = (id: string) => {
    const skill = skills.find((s) => s.id === id)
    if (!skill) return
    setEditor({
      mode: 'edit',
      target: {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        content: skill.content
      }
    })
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete skill "${name}"? The .md file will be removed.`)) return
    await deleteSkill(id)
  }

  return (
    <>
      <div className="border-t border-[var(--panel-border)] px-2 py-2">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-[12px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
            Skills
          </span>
          <button
            onClick={handleCreate}
            title="Create skill"
            className="rounded px-1.5 py-0.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--accent)]"
          >
            +
          </button>
        </div>

        {skills.length === 0 ? (
          <p className="px-2 py-3 text-[12px] leading-relaxed text-[var(--text-muted)]">
            Drop .md files into the skills/ folder or click + to create one.
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {skills.map((skill) => {
              const active = activeSkillIds.includes(skill.id)
              return (
                <div
                  key={skill.id}
                  className={`group flex items-center gap-2 rounded border-l-2 px-2 py-1 text-xs transition-colors ${
                    active
                      ? 'border-[var(--accent)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                      : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggleSkill(skill.id)}
                    className="h-3 w-3 cursor-pointer accent-[var(--accent)]"
                  />
                  <button
                    onClick={() => toggleSkill(skill.id)}
                    title={skill.description || skill.name}
                    className="min-w-0 flex-1 truncate text-left"
                  >
                    {skill.name}
                  </button>
                  <button
                    onClick={() => handleEdit(skill.id)}
                    title="Edit skill"
                    className="hidden rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--accent)] group-hover:block"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(skill.id, skill.name)}
                    title="Delete skill"
                    className="hidden rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--error)] group-hover:block"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    </svg>
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {editor.mode === 'new' && <SkillEditor onClose={() => setEditor({ mode: 'closed' })} />}
      {editor.mode === 'edit' && (
        <SkillEditor initialSkill={editor.target} onClose={() => setEditor({ mode: 'closed' })} />
      )}
    </>
  )
}
