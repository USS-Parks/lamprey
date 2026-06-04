import { useState, useRef, useEffect } from 'react'
import { useMemoryStore } from '@/stores/memory-store'
import { toast } from '@/stores/toast-store'
import type { MemoryEntry } from '@/lib/types'
import { MemoryLinkGraph } from './MemoryLinkGraph'

const UNDO_MS = 3000

export function MemoryPanel() {
  const { memories, addMemory, updateMemory, deleteMemory, restoreMemory, clearAll, exportMemories, importMemories } =
    useMemoryStore()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [undo, setUndo] = useState<{ entry: MemoryEntry; expiresAt: number } | null>(null)
  const undoTimerRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current)
    }
  }, [])

  const startAdd = () => {
    setAdding(true)
    setDraft('')
  }

  const commitAdd = async () => {
    const text = draft.trim()
    if (text) {
      await addMemory(text)
    }
    setAdding(false)
    setDraft('')
  }

  const cancelAdd = () => {
    setAdding(false)
    setDraft('')
  }

  const handleDelete = async (id: number) => {
    const removed = await deleteMemory(id)
    if (!removed) return
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current)
    setUndo({ entry: removed, expiresAt: Date.now() + UNDO_MS })
    undoTimerRef.current = window.setTimeout(() => setUndo(null), UNDO_MS)
  }

  const handleUndo = async () => {
    if (!undo) return
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current)
    const entry = undo.entry
    setUndo(null)
    await restoreMemory(entry)
  }

  const handleExport = async () => {
    setMenuOpen(false)
    const json = await exportMemories()
    if (!json) return
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lamprey-memory-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportClick = () => {
    setMenuOpen(false)
    fileInputRef.current?.click()
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      await importMemories(text)
    } catch (err) {
      toast.error(`Import failed: ${(err as Error).message}`)
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleClearAll = async () => {
    setMenuOpen(false)
    if (!confirm('Clear all memory entries? This cannot be undone.')) return
    await clearAll()
  }

  return (
    <div className="border-t border-[var(--border)] px-2 py-2">
      <div className="flex items-center justify-between px-2 py-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
            Memory
          </span>
          {memories.length > 0 && (
            <span className="rounded bg-[var(--bg-tertiary)] px-1 text-[12px] text-[var(--text-secondary)]">
              {memories.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={startAdd}
            title="Add memory entry"
            className="rounded px-1.5 py-0.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--accent)]"
          >
            +
          </button>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              title="Memory actions"
              className="rounded px-1.5 py-0.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            >
              ...
            </button>
            {menuOpen && (
              <>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="fixed inset-0 z-10 cursor-default bg-transparent"
                  aria-label="Close menu"
                />
                <div className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded border border-[var(--border)] bg-[var(--bg-tertiary)] shadow-lg">
                  <button
                    onClick={handleExport}
                    className="block w-full px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
                  >
                    Export JSON
                  </button>
                  <button
                    onClick={handleImportClick}
                    className="block w-full px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
                  >
                    Import JSON
                  </button>
                  <button
                    onClick={handleClearAll}
                    className="block w-full border-t border-[var(--border)] px-3 py-1.5 text-left text-xs text-[var(--error)] hover:bg-[var(--bg-primary)]"
                  >
                    Clear all
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleImportFile}
      />

      {memories.length === 0 && !adding ? (
        <p className="px-2 py-3 text-[12px] leading-relaxed text-[var(--text-muted)]">
          Tell me something to remember.
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {memories.map((entry, idx) => (
            <MemoryRow
              key={entry.id}
              entry={entry}
              index={idx + 1}
              isEditing={editingId === entry.id}
              onStartEdit={() => setEditingId(entry.id)}
              onFinishEdit={async (value) => {
                if (value.trim() && value.trim() !== entry.content) {
                  await updateMemory(entry.id, value)
                }
                setEditingId(null)
              }}
              onDelete={() => handleDelete(entry.id)}
            />
          ))}
        </div>
      )}

      {adding && (
        <div className="mt-1 px-1">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                commitAdd()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancelAdd()
              }
            }}
            onBlur={commitAdd}
            rows={2}
            placeholder="Something to remember..."
            className="w-full resize-none rounded border border-[var(--accent)] bg-[var(--bg-primary)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none"
          />
        </div>
      )}

      {undo && (
        <div className="mx-1 mt-2 flex items-center justify-between rounded border border-[var(--border)] bg-[var(--bg-tertiary)] px-2 py-1.5 text-[12px] text-[var(--text-secondary)]">
          <span>Memory deleted</span>
          <button
            onClick={handleUndo}
            className="rounded px-2 py-0.5 text-[var(--accent)] hover:bg-[var(--bg-primary)]"
          >
            Undo
          </button>
        </div>
      )}

      {/* D2: surface broken [[link]] markers as "to-write" pips. Pre-D3
          the click handler stays no-op; D3 wires it to MemoryEditor so
          a click pre-fills the new-entry form with the missing target. */}
      <MemoryLinkGraph
        onPick={(target) => {
          setAdding(true)
          setDraft(`[[${target}]] — `)
        }}
      />
    </div>
  )
}

interface MemoryRowProps {
  entry: MemoryEntry
  index: number
  isEditing: boolean
  onStartEdit: () => void
  onFinishEdit: (value: string) => void
  onDelete: () => void
}

function MemoryRow({ entry, index, isEditing, onStartEdit, onFinishEdit, onDelete }: MemoryRowProps) {
  const [value, setValue] = useState(entry.content)

  useEffect(() => {
    setValue(entry.content)
  }, [entry.content, isEditing])

  if (isEditing) {
    return (
      <div className="flex gap-2 rounded border-l-2 border-[var(--accent)] bg-[var(--bg-tertiary)] px-2 py-1">
        <span className="pt-1 text-[12px] text-[var(--text-muted)]">{index}.</span>
        <textarea
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onFinishEdit(value)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onFinishEdit(entry.content)
            }
          }}
          onBlur={() => onFinishEdit(value)}
          rows={Math.min(6, Math.max(2, value.split('\n').length))}
          className="flex-1 resize-none rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
      </div>
    )
  }

  return (
    <div className="group flex items-start gap-2 rounded border-l-2 border-transparent px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]">
      <span className="pt-0.5 text-[12px] text-[var(--text-muted)]">{index}.</span>
      <button
        onClick={onStartEdit}
        title={entry.content}
        className="line-clamp-2 min-w-0 flex-1 text-left leading-snug"
      >
        {entry.content}
      </button>
      <button
        onClick={onStartEdit}
        title="Edit"
        className="hidden rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--accent)] group-hover:block"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>
      <button
        onClick={onDelete}
        title="Delete"
        className="hidden rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--error)] group-hover:block"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        </svg>
      </button>
    </div>
  )
}
