import { useChatStore } from '@/stores/chat-store'
import type { Conversation } from '@/lib/types'

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
  const { conversations, activeConversationId, selectConversation, createConversation, deleteConversation } = useChatStore()
  const groups = groupConversations(conversations)

  return (
    <div className="flex h-full w-60 flex-col border-r border-[var(--border)] bg-[var(--bg-secondary)]">
      <div className="flex h-12 items-center justify-between px-3">
        <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
          Conversations
        </span>
        <button
          onClick={() => createConversation()}
          className="rounded px-2 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--accent)]"
        >
          + New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        {groups.length === 0 && (
          <p className="px-2 py-8 text-center text-xs text-[var(--text-muted)]">
            Start your first conversation.
          </p>
        )}
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
                    if (confirm('Delete this conversation?')) {
                      deleteConversation(conv.id)
                    }
                  }}
                  className="hidden rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--error)] group-hover:block"
                >
                  ×
                </button>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
