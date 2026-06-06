import type { InlineNotice } from '@/stores/inline-notices-store'

// Fluidity J9: generic inline transcript row for async-event notices
// (background turn completed, wake-up landed, side-chat reply, etc.).
// MessageList interleaves these with regular message bubbles by
// timestamp so the user reads a single transcript instead of getting
// toasts that steal focus.
//
// Errors keep using the toast container — this surface is for
// informational events the user can glance at without action.

interface TranscriptNoticeProps {
  notice: InlineNotice
  onDismiss?: () => void
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return ''
  }
}

export function TranscriptNotice({ notice, onDismiss }: TranscriptNoticeProps) {
  const time = formatTime(notice.ts)
  const interactive = !!notice.onActivate
  const Wrap = (interactive ? 'button' : 'div') as 'button' | 'div'
  return (
    <Wrap
      type={interactive ? 'button' : undefined}
      onClick={interactive ? notice.onActivate : undefined}
      data-transcript-notice={notice.id}
      className={
        'mx-auto my-2 flex w-full max-w-[80%] items-center gap-2 rounded-md bg-[var(--bg-tertiary)]/60 px-3 py-1.5 text-left text-[12px] transition-colors ' +
        (interactive ? 'hover:bg-[var(--bg-tertiary)]' : '')
      }
    >
      <span className="h-1.5 w-1.5 flex-none rounded-full bg-[var(--accent)]" aria-hidden />
      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        {notice.title}
      </span>
      <span className="truncate text-[var(--text-secondary)]">{notice.message}</span>
      {time && (
        <span className="ml-auto font-mono text-[10px] text-[var(--text-muted)]">{time}</span>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDismiss()
          }}
          className="rounded p-0.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          aria-label="Dismiss notice"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </Wrap>
  )
}
