import { useState, useEffect } from 'react'
import { useSkillsStore } from '@/stores/skills-store'
import { toast } from '@/stores/toast-store'

export interface SkillEditorTarget {
  id: string
  name: string
  description: string
  content: string
}

interface SkillEditorProps {
  initialSkill?: SkillEditorTarget
  onClose: () => void
}

const CHAR_WARN = 4000

export function SkillEditor({ initialSkill, onClose }: SkillEditorProps) {
  const [name, setName] = useState(initialSkill?.name ?? '')
  const [description, setDescription] = useState(initialSkill?.description ?? '')
  const [content, setContent] = useState(initialSkill?.content ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const isEdit = !!initialSkill?.id
  const activeSkillIds = useSkillsStore((s) => s.activeSkillIds)
  const setActiveSkillIds = useSkillsStore((s) => s.setActiveSkillIds)
  const loadSkills = useSkillsStore((s) => s.loadSkills)
  const deleteSkill = useSkillsStore((s) => s.deleteSkill)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const validate = (): string | null => {
    if (!name.trim()) return 'Name is required'
    if (!description.trim()) return 'Description is required'
    if (!content.trim()) return 'Content is required'
    return null
  }

  const persist = async (): Promise<{ id: string } | null> => {
    const v = validate()
    if (v) {
      setError(v)
      return null
    }
    setError(null)
    setBusy(true)
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        content
      }
      if (isEdit && initialSkill) {
        const result = await window.api.skills.update(initialSkill.id, payload)
        if (!result.success) {
          setError(result.error)
          toast.error(`Failed to save skill: ${result.error}`)
          return null
        }
        await loadSkills()
        toast.success(`Skill "${payload.name}" saved`)
        return { id: initialSkill.id }
      }
      const result = await window.api.skills.create(payload)
      if (!result.success) {
        setError(result.error)
        toast.error(`Failed to create skill: ${result.error}`)
        return null
      }
      await loadSkills()
      const created = result.data as { id: string } | null
      if (!created) return null
      toast.success(`Skill "${payload.name}" created`)
      return { id: created.id }
    } finally {
      setBusy(false)
    }
  }

  const handleSave = async () => {
    const res = await persist()
    if (res) onClose()
  }

  const handleSaveAndEnable = async () => {
    const res = await persist()
    if (!res) return
    if (!activeSkillIds.includes(res.id)) {
      setActiveSkillIds([...activeSkillIds, res.id])
    }
    onClose()
  }

  const handleDuplicate = async () => {
    if (!initialSkill) return
    setBusy(true)
    setError(null)
    try {
      const dupName = `${name} (copy)`
      const result = await window.api.skills.create({
        name: dupName,
        description: description,
        content
      })
      if (!result.success) {
        setError(result.error)
        toast.error(`Failed to duplicate skill: ${result.error}`)
        return
      }
      await loadSkills()
      toast.success(`Skill "${dupName}" created`)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!initialSkill) return
    if (!confirm(`Delete skill "${initialSkill.name}"? The .md file will be removed.`)) return
    setBusy(true)
    try {
      await deleteSkill(initialSkill.id)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const preview = `<skill name="${name || 'Untitled'}">\n${content}\n</skill>`
  const charCount = content.length
  const overLimit = charCount > CHAR_WARN

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex h-[85vh] w-[92vw] max-w-6xl flex-col rounded-lg border border-[var(--panel-border)] bg-[var(--bg-secondary)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-5 py-3">
          <div>
            <h2 className="font-mono text-sm font-medium uppercase tracking-wider text-[var(--text-primary)]">
              {isEdit ? 'Edit Skill' : 'New Skill'}
            </h2>
            {isEdit && (
              <div className="mt-0.5 truncate text-[12px] text-[var(--text-muted)]">
                {initialSkill?.id}.md
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-30"
            title="Close (Esc)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="flex w-1/2 flex-col gap-3 overflow-y-auto border-r border-[var(--panel-border)] px-5 py-4">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                Name
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Direct Voice"
                disabled={busy}
                className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                Description
              </span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="One sentence. When to activate this skill."
                rows={2}
                disabled={busy}
                className="resize-none rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            </label>

            <label className="flex min-h-0 flex-1 flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  Content
                </span>
                <span
                  className={`text-[12px] ${overLimit ? 'text-[var(--warning)]' : 'text-[var(--text-muted)]'}`}
                >
                  {charCount} {overLimit ? `(over ${CHAR_WARN} char soft limit)` : 'chars'}
                </span>
              </div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={'Communication rules:\n- State conclusions directly.\n- Lead with the answer, then explain if needed.'}
                disabled={busy}
                spellCheck={false}
                className="flex-1 resize-none rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            </label>

            {error && (
              <div className="rounded border border-[var(--error)] bg-[var(--error)]/10 px-2 py-1.5 text-xs text-[var(--error)]">
                {error}
              </div>
            )}
          </div>

          <div className="flex w-1/2 flex-col overflow-hidden bg-[var(--bg-primary)]">
            <div className="border-b border-[var(--panel-border)] px-5 py-2 text-[12px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
              System prompt preview
            </div>
            <pre className="flex-1 overflow-auto px-5 py-3 font-mono text-xs leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap">
              {preview}
            </pre>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[var(--panel-border)] px-5 py-3">
          <div className="flex gap-2">
            {isEdit && (
              <>
                <button
                  onClick={handleDuplicate}
                  disabled={busy}
                  className="rounded border border-[var(--panel-border)] bg-transparent px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-30"
                >
                  Duplicate
                </button>
                <button
                  onClick={handleDelete}
                  disabled={busy}
                  className="rounded border border-[var(--panel-border)] bg-transparent px-3 py-1.5 text-xs text-[var(--error)] transition-colors hover:bg-[var(--error)]/10 disabled:opacity-30"
                >
                  Delete
                </button>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="rounded border border-[var(--panel-border)] bg-transparent px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-30"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={busy}
              className="rounded border border-[var(--panel-border)] bg-transparent px-3 py-1.5 text-xs text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-tertiary)] disabled:opacity-30"
            >
              {busy ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={handleSaveAndEnable}
              disabled={busy}
              className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-30"
            >
              {busy ? 'Saving...' : 'Save & Enable'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
