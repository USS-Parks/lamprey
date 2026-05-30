import { useEffect, useMemo, useRef } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { useUiStore } from '@/stores/ui-store'
import { SkillPanel } from '@/components/skills/SkillPanel'
import { MemoryPanel } from '@/components/memory/MemoryPanel'
import { toast } from '@/stores/toast-store'
import type { Conversation } from '@/lib/types'
import newChatIconUrl from '@assets/Lamprey New Chat Icon.png'
import searchIconUrl from '@assets/Lamprey Searching Icon.png'

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

function groupConversations(conversations: Conversation[]) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterday = today - 86400000
  const thisWeek = today - 7 * 86400000

  const groups: { label: string; items: Conversation[] }[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'This Week', items: [] },
    { label: 'Older', items: [] }
  ]

  for (const conv of conversations) {
    if (conv.updatedAt >= today) groups[0].items.push(conv)
    else if (conv.updatedAt >= yesterday) groups[1].items.push(conv)
    else if (conv.updatedAt >= thisWeek) groups[2].items.push(conv)
    else groups[3].items.push(conv)
  }

  return groups.filter((g) => g.items.length > 0)
}

export function Sidebar() {
  const {
    conversations,
    activeConversationId,
    selectConversation,
    createConversation,
    deleteConversation
  } = useChatStore()
  const searchQuery = useUiStore((s) => s.searchQuery)
  const setSearchQuery = useUiStore((s) => s.setSearchQuery)
  const searchFocusToken = useUiStore((s) => s.searchFocusToken)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (searchFocusToken === 0) return
    searchRef.current?.focus()
    searchRef.current?.select()
  }, [searchFocusToken])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter((c) => c.title?.toLowerCase().includes(q))
  }, [conversations, searchQuery])

  const groups = groupConversations(filtered)

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Delete "${title || 'this conversation'}"?`)) return
    await deleteConversation(id)
    toast.success('Conversation deleted')
  }

  return (
    <div className="flex h-full w-60 flex-col border-r border-[var(--border)] bg-[var(--bg-secondary)]">
      <div className="px-3 pb-2 pt-3">
        <button
          onClick={() => createConversation()}
          title="New conversation (Ctrl+N)"
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--accent)] bg-[var(--accent-dim)] px-3 py-2 text-xs font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
        >
          <span className="flex items-center gap-2">
            <img src={newChatIconUrl} alt="" aria-hidden className="h-4 w-4 object-contain" />
            New Conversation
          </span>
          <span className="font-mono text-[10px] opacity-70">Ctrl+N</span>
        </button>
      </div>

      <div className="px-2 pb-2">
        <div className="relative">
          <img
            src={searchIconUrl}
            alt=""
            aria-hidden
            className="pointer-events-none absolute left-1.5 top-1/2 h-4 w-4 -translate-y-1/2 object-contain opacity-60"
          />
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                setSearchQuery('')
                searchRef.current?.blur()
              }
            }}
            placeholder="Search… (Ctrl+K)"
            className="w-full rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 pl-7 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="px-2">
          {conversations.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-[var(--text-muted)]">
              Start your first conversation.
            </p>
          ) : groups.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-[var(--text-muted)]">
              No matches for "{searchQuery}".
            </p>
          ) : null}
          {groups.map((group) => (
            <div key={group.label} className="mb-3">
              <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                {group.label}
              </div>
              {group.items.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => selectConversation(conv.id)}
                  className={`group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                    activeConversationId === conv.id
                      ? 'border-l-2 border-[var(--accent)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                      : 'border-l-2 border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{conv.title}</div>
                    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                      <span className="rounded bg-[var(--bg-primary)] px-1">
                        {conv.model === 'deepseek-reasoner' ? 'R1' : 'V3'}
                      </span>
                      <span>{formatRelativeTime(conv.updatedAt)}</span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(conv.id, conv.title)
                    }}
                    title="Delete conversation"
                    className="hidden rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--error)] group-hover:block"
                  >
                    ×
                  </button>
                </button>
              ))}
            </div>
          ))}
        </div>
        <SkillPanel />
        <MemoryPanel />
      </div>
    </div>
  )
}
