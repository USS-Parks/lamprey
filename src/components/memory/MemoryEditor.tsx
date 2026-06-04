import { useEffect, useRef, useState } from 'react'
import { useMemoryStore } from '@/stores/memory-store'
import type { MemoryFile, MemoryType } from '@/lib/types'
import { MEMORY_TYPE_LABELS, MemoryTypeBadge } from './MemoryTypeBadge'
import { MemoryLinkPicker } from './MemoryLinkPicker'

interface Props {
  initial?: MemoryFile | null
  initialDraft?: { name?: string; type?: MemoryType; body?: string }
  onClose: () => void
  onDeleted?: () => void
}

const ALL_TYPES: MemoryType[] = ['user', 'feedback', 'project', 'reference']

// D3 — typed memory editor.
//
// One form for both "create" (no initial entry) and "edit". The `name`
// field is locked when editing an existing entry so we don't accidentally
// orphan the file on rename (the backend slug-normalizes the name into
// the filename). Body has live `[[autocomplete]]` from MemoryLinkPicker.
export function MemoryEditor({ initial, initialDraft, onClose, onDeleted }: Props) {
  const write = useMemoryStore((s) => s.writeMemory)
  const deleteEntry = useMemoryStore((s) => s.deleteEntry)

  const editing = Boolean(initial)
  const [name, setName] = useState(initial?.name ?? initialDraft?.name ?? '')
  const [type, setType] = useState<MemoryType>(initial?.type ?? initialDraft?.type ?? 'feedback')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [body, setBody] = useState(initial?.body ?? initialDraft?.body ?? '')
  const [saving, setSaving] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    bodyRef.current?.focus()
  }, [])

  const canSave = name.trim().length > 0 && body.trim().length > 0 && !saving

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    const result = await write({
      name: name.trim(),
      type,
      description: description.trim(),
      body: body.trim()
    })
    setSaving(false)
    if (result) onClose()
  }

  const handleDelete = async () => {
    if (!editing || !initial) return
    if (!confirm(`Delete "${initial.name}"? This removes the file.`)) return
    const ok = await deleteEntry(initial.name)
    if (ok) {
      onDeleted?.()
      onClose()
    }
  }

  return (
    <div className="flex flex-col gap-3 px-1 pb-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-1 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        >
          ← Back
        </button>
        <span className="text-[12px] text-[var(--text-muted)]">
          {editing ? `Edit · ${initial?.name}` : 'New memory'}
        </span>
        {editing && (
          <button
            type="button"
            onClick={handleDelete}
            className="rounded px-2 py-1 text-[12px] text-[var(--error)] hover:bg-[var(--bg-tertiary)]"
          >
            Delete
          </button>
        )}
      </div>

      <div className="grid grid-cols-[80px_1fr] items-center gap-2 px-2">
        <label
          htmlFor="memory-editor-type"
          className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]"
        >
          Type
        </label>
        <div className="flex items-center gap-2">
          <select
            id="memory-editor-type"
            value={type}
            onChange={(e) => setType(e.target.value as MemoryType)}
            className="rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-[12px] text-[var(--text-primary)]"
          >
            {ALL_TYPES.map((t) => (
              <option key={t} value={t}>
                {MEMORY_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <MemoryTypeBadge type={type} />
        </div>

        <label
          htmlFor="memory-editor-name"
          className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]"
        >
          Name
        </label>
        <input
          id="memory-editor-name"
          type="text"
          value={name}
          disabled={editing}
          onChange={(e) => setName(e.target.value)}
          placeholder="feedback_no_coauthor_trailer"
          className="rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-[12px] text-[var(--text-primary)] disabled:opacity-60"
        />

        <label
          htmlFor="memory-editor-desc"
          className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]"
        >
          Description
        </label>
        <input
          id="memory-editor-desc"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="One-line hook shown in MEMORY.md"
          className="rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-[12px] text-[var(--text-primary)]"
        />
      </div>

      <div className="px-2">
        <label className="block text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
          Body
        </label>
        <textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          placeholder="Body — use [[other-memory-name]] to cross-reference."
          className="mt-1 w-full resize-none rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1.5 font-mono text-[12px] leading-relaxed text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
        <MemoryLinkPicker textarea={bodyRef.current} />
      </div>

      <div className="flex items-center justify-end gap-2 px-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded px-3 py-1 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className="rounded bg-[var(--accent)] px-3 py-1 text-[12px] font-medium text-[var(--bg-primary)] disabled:opacity-50"
        >
          {saving ? 'Saving…' : editing ? 'Save' : 'Create'}
        </button>
      </div>
    </div>
  )
}
