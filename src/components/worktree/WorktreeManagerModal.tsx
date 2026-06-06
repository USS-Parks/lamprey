import { useCallback, useEffect, useState } from 'react'
import { useUiStore } from '@/stores/ui-store'
import { useChatStore } from '@/stores/chat-store'
import { toast } from '@/stores/toast-store'

interface Worktree {
  path: string
  branch: string | null
  head: string | null
}

export function WorktreeManagerModal() {
  const visible = useUiStore((s) => s.worktreeModalOpen)
  const close = useUiStore((s) => s.closeWorktreeModal)
  const [list, setList] = useState<Worktree[]>([])
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newBranch, setNewBranch] = useState('')
  const [newPath, setNewPath] = useState('')
  const createConversation = useChatStore((s) => s.createConversation)

  const refresh = useCallback(async () => {
    setError(null)
    if (!window.api?.worktree) {
      setError('Worktree API unavailable.')
      return
    }
    const res = await window.api.worktree.list({})
    if (!res.success) {
      setError(res.error ?? 'list failed')
      return
    }
    setList(res.data as Worktree[])
  }, [])

  useEffect(() => {
    if (visible) void refresh()
  }, [visible, refresh])

  if (!visible) return null

  const handleCreate = async () => {
    if (!newBranch.trim() || !newPath.trim()) {
      setError('branch and path are required')
      return
    }
    setCreating(true)
    const res = await window.api?.worktree?.create({
      branch: newBranch.trim(),
      path: newPath.trim()
    })
    setCreating(false)
    if (!res?.success) {
      setError(res?.error ?? 'create failed')
      return
    }
    const data = res.data as { path: string; branch: string }
    toast.success(`Worktree created at ${data.path}`)
    setNewBranch('')
    setNewPath('')
    void refresh()
    // Optionally seed a new thread tagged with this worktree.
    if (confirm(`Create a new thread for worktree '${data.branch}'?`)) {
      // createConversation in the store doesn't currently take kind; using
      // direct IPC so the metadata is recorded.
      const conv = await window.api.conversation.create('deepseek-chat', {
        kind: 'worktree',
        worktreePath: data.path
      })
      if (conv.success) {
        await useChatStore.getState().loadConversations()
        await createConversation()
      }
    }
  }

  const handleRemove = async (p: string) => {
    if (!confirm(`Remove worktree at ${p}?`)) return
    const res = await window.api?.worktree?.remove({ path: p })
    if (!res?.success) {
      toast.error(res?.error ?? 'remove failed')
      return
    }
    toast.success('Worktree removed')
    void refresh()
  }

  return (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-lg border border-[var(--panel-border)] bg-[var(--bg-primary)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-4 py-3">
          <h2 className="text-[14px] font-medium text-[var(--text-primary)]">Worktrees</h2>
          <button
            onClick={close}
            className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="border-b border-[var(--panel-border)] p-4">
          <h3 className="mb-2 text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
            New worktree
          </h3>
          <div className="flex flex-col gap-2 text-[13px]">
            <input
              type="text"
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
              placeholder="branch name (e.g. feature-x)"
              className="w-full rounded border border-[var(--panel-border)] bg-[var(--bg-secondary)] px-2 py-1 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
            <input
              type="text"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder="path (relative resolves next to repo, or absolute)"
              className="w-full rounded border border-[var(--panel-border)] bg-[var(--bg-secondary)] px-2 py-1 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={handleCreate}
                disabled={creating}
                className="rounded border border-[var(--panel-border)] bg-[var(--bg-secondary)] px-3 py-1 text-[12px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)] disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create worktree'}
              </button>
            </div>
            {error && <p className="text-[12px] text-[var(--error)]">{error}</p>}
          </div>
        </div>

        <div className="max-h-[40vh] overflow-y-auto p-4">
          <h3 className="mb-2 text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
            Existing ({list.length})
          </h3>
          {list.length === 0 && (
            <p className="text-[12px] text-[var(--text-muted)]">None.</p>
          )}
          {list.map((wt, i) => (
            <div
              key={wt.path}
              className="mb-2 flex items-center justify-between gap-2 rounded border border-[var(--panel-border)] bg-[var(--bg-secondary)] px-3 py-2 text-[12px]"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[12px] text-[var(--text-primary)]" title={wt.path}>
                  {wt.path}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
                  {wt.branch ? `branch: ${wt.branch}` : '(detached)'}
                  {wt.head && ` · ${wt.head.slice(0, 8)}`}
                </div>
              </div>
              {i > 0 && (
                <button
                  onClick={() => void handleRemove(wt.path)}
                  className="shrink-0 rounded px-2 py-1 text-[11px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--error)]"
                >
                  remove
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
