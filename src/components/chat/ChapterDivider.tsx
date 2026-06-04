import type { Chapter } from '@/stores/chapters-store'

// Track 2 / E2 — inline chapter boundary rendered between messages.
// The MessageList places one of these directly before the FIRST message
// whose timestamp exceeds the chapter's createdAt — chapters live in the
// gap between turns, not on a specific message. `data-chapter-id` lets
// the ChapterSidebar / QuickJumper scroll to it.

interface ChapterDividerProps {
  chapter: Chapter
}

export function ChapterDivider({ chapter }: ChapterDividerProps) {
  return (
    <div
      data-chapter-id={chapter.id}
      role="separator"
      aria-label={`Chapter: ${chapter.title}`}
      className="my-4 flex items-center gap-3 px-2 text-[12px] uppercase tracking-wider text-[var(--accent)]"
      title={chapter.summary ?? undefined}
    >
      <span className="h-px flex-1 bg-[var(--accent)]/30" />
      <span className="font-medium normal-case">{chapter.title}</span>
      <span className="h-px flex-1 bg-[var(--accent)]/30" />
    </div>
  )
}
