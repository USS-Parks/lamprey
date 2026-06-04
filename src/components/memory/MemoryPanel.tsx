import { useEffect, useMemo, useRef, useState } from 'react'
import { useMemoryStore } from '@/stores/memory-store'
import { toast } from '@/stores/toast-store'
import type { MemoryFile, MemoryType } from '@/lib/types'
import { MemoryLinkGraph } from './MemoryLinkGraph'
import { MemoryEditor } from './MemoryEditor'
import { MEMORY_TYPE_LABELS, MemoryTypeBadge } from './MemoryTypeBadge'

type TabKey = 'all' | MemoryType

const TABS: TabKey[] = ['all', 'user', 'feedback', 'project', 'reference']
const TAB_LABEL: Record<TabKey, string> = { all: 'All', ...MEMORY_TYPE_LABELS }

interface EditorState {
  open: boolean
  initial?: MemoryFile | null
  draft?: { name?: string; type?: MemoryType; body?: string }
}

export function MemoryPanel() {
  const entries = useMemoryStore((s) => s.entries)
  const counts = useMemoryStore((s) => s.countsByType)
  const exportMemories = useMemoryStore((s) => s.exportMemories)
  const importMemories = useMemoryStore((s) => s.importMemories)
  const clearAll = useMemoryStore((s) => s.clearAll)
  const duplicateEntry = useMemoryStore((s) => s.duplicateEntry)

  const [activeTab, setActiveTab] = useState<TabKey>('all')
  const [menuOpen, setMenuOpen] = useState(false)
  const [consolidating, setConsolidating] = useState(false)
  const [editor, setEditor] = useState<EditorState>({ open: false })
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Live `memory:changed` subscription so external edits and other
  // panel writes refresh the view without forcing a parent reload.
  useEffect(() => {
    const api = (window as any).api
    const unsubscribe = api?.memory?.onChanged?.(() => {
      useMemoryStore.getState().receiveChanged([])
    })
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [])

  const tabCounts = counts()
  const filtered = useMemo(() => {
    const list = activeTab === 'all' ? entries : entries.filter((e) => e.type === activeTab)
    return [...list].sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type)
      const left = (a.description || a.name).toLowerCase()
      const right = (b.description || b.name).toLowerCase()
      return left.localeCompare(right)
    })
  }, [entries, activeTab])

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

  const handleConsolidate = async () => {
    if (activeTab === 'all' || consolidating) return
    setConsolidating(true)
    try {
      const typedEntries = entries.filter((entry) => entry.type === activeTab)
      const result = await window.api.workflows.run({
        name: 'consolidate-memory',
        args: { type: activeTab, entries: typedEntries }
      })
      if (!result.success) {
        toast.error(`Consolidation failed: ${result.error}`)
        return
      }
      toast.success(`Consolidating ${TAB_LABEL[activeTab].toLowerCase()} memory`)
    } catch (err) {
      toast.error(`Consolidation failed: ${(err as Error).message}`)
    } finally {
      setConsolidating(false)
    }
  }

  const openNew = (type?: MemoryType) => {
    setEditor({ open: true, draft: { type: type ?? (activeTab === 'all' ? 'feedback' : activeTab) } })
  }

  const openEdit = (entry: MemoryFile) => {
    setEditor({ open: true, initial: entry })
  }

  if (editor.open) {
    return (
      <div className="border-t border-[var(--border)] px-2 py-2">
        <MemoryEditor
          initial={editor.initial}
          initialDraft={editor.draft}
          onClose={() => setEditor({ open: false })}
        />
      </div>
    )
  }

  return (
    <div className="border-t border-[var(--border)] px-2 py-2">
      <div className="flex items-center justify-between px-2 py-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
            Memory
          </span>
          {tabCounts.all > 0 && (
            <span className="rounded bg-[var(--bg-tertiary)] px-1 text-[12px] text-[var(--text-secondary)]">
              {tabCounts.all}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {activeTab !== 'all' && (
            <button
              type="button"
              onClick={handleConsolidate}
              disabled={consolidating || (tabCounts[activeTab] ?? 0) < 2}
              title="Consolidate this memory type"
              className="rounded px-1.5 py-0.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Consolidate
            </button>
          )}
          <button
            onClick={() => openNew()}
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
                    onClick={() => {
                      setMenuOpen(false)
                      fileInputRef.current?.click()
                    }}
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

      <div className="mt-1 flex items-center gap-1 overflow-x-auto px-1 pb-1">
        {TABS.map((tab) => {
          const c = tabCounts[tab] ?? 0
          const isActive = activeTab === tab
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider transition-colors ${
                isActive
                  ? 'bg-[var(--accent)] text-[var(--bg-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <span>{TAB_LABEL[tab]}</span>
              <span
                className={`rounded ${
                  isActive ? 'bg-black/20' : 'bg-[var(--bg-tertiary)]'
                } px-1 text-[10px]`}
              >
                {c}
              </span>
            </button>
          )
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="px-2 py-3 text-[12px] leading-relaxed text-[var(--text-muted)]">
          {activeTab === 'all'
            ? 'Tell me something to remember.'
            : `No ${TAB_LABEL[activeTab].toLowerCase()} memories yet.`}
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {filtered.map((entry) => (
            <li key={entry.name}>
              <MemoryRow
                entry={entry}
                onOpen={() => openEdit(entry)}
                onDuplicate={async () => {
                  const dup = await duplicateEntry(entry.name)
                  if (dup) openEdit(dup)
                }}
                onDelete={async () => {
                  if (!confirm(`Delete "${entry.name}"?`)) return
                  await useMemoryStore.getState().deleteEntry(entry.name)
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <MemoryLinkGraph
        onPick={(target) =>
          setEditor({
            open: true,
            draft: {
              name: target,
              type: 'reference',
              body: ''
            }
          })
        }
      />
    </div>
  )
}

interface MemoryRowProps {
  entry: MemoryFile
  onOpen: () => void
  onDuplicate: () => void | Promise<void>
  onDelete: () => void | Promise<void>
}

function MemoryRow({ entry, onOpen, onDuplicate, onDelete }: MemoryRowProps) {
  return (
    <div className="group flex items-start gap-2 rounded border-l-2 border-transparent px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]">
      <MemoryTypeBadge type={entry.type} compact />
      <button
        type="button"
        onClick={onOpen}
        title={entry.description || entry.body}
        className="line-clamp-2 min-w-0 flex-1 text-left leading-snug"
      >
        <span className="block truncate font-medium text-[var(--text-primary)]">
          {entry.description || entry.name}
        </span>
        <span className="block truncate font-mono text-[10px] text-[var(--text-muted)]">
          {entry.name}
        </span>
      </button>
      <button
        type="button"
        onClick={onDuplicate}
        title="Duplicate"
        className="hidden rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--accent)] group-hover:block"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
      <button
        type="button"
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
