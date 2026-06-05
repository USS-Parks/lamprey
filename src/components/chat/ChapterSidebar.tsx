import { useEffect } from 'react'
import { useChaptersStore } from '@/stores/chapters-store'

// Track 2 / E2 — floating chapter TOC. Mounted by ChatView; visible on
// the left edge of the chat column whenever the active conversation
// has at least one chapter. Click a row to scroll the message list to
// the chapter divider; hover for the summary.

interface ChapterSidebarProps {
  conversationId: string | null
}

function scrollToChapter(chapterId: string): void {
  // The divider rendered by MessageList carries data-chapter-id; use
  // scrollIntoView with smooth behaviour so the jump feels intentional.
  const el = document.querySelector(`[data-chapter-id="${chapterId}"]`)
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

export function ChapterSidebar({ conversationId }: ChapterSidebarProps) {
  const chapters = useChaptersStore((s) => s.chapters)
  const storeConvId = useChaptersStore((s) => s.conversationId)
  const loadForConversation = useChaptersStore((s) => s.loadForConversation)
  const applyMarked = useChaptersStore((s) => s.applyMarked)

  useEffect(() => {
    if (conversationId && storeConvId !== conversationId) {
      void loadForConversation(conversationId)
    }
  }, [conversationId, storeConvId, loadForConversation])

  useEffect(() => {
    if (!window.api?.session?.onChapterMarked) return
    return window.api.session.onChapterMarked((e) => {
      applyMarked(e as { conversationId: string; chapter: typeof chapters[number] })
    })
  }, [applyMarked, chapters])

  if (!conversationId) return null
  if (chapters.length === 0) return null

  return (
    <aside
      aria-label="Session chapters"
      className="pointer-events-auto absolute left-3 top-3 z-10 w-[200px] rounded-md border border-[var(--border)] bg-[var(--bg-primary)]/95 p-2 text-[12px] shadow-md backdrop-blur"
    >
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
          Chapters
        </span>
        <span className="text-[10px] text-[var(--text-muted)]">{chapters.length}</span>
      </div>
      <div className="max-h-[260px] overflow-y-auto">
        {chapters.map((c) => (
          <button
            key={c.id}
            onClick={() => scrollToChapter(c.id)}
            title={c.summary ?? undefined}
            className="block w-full rounded px-1 py-0.5 text-left text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
          >
            <span className="block truncate">{c.title}</span>
          </button>
        ))}
      </div>
    </aside>
  )
}
