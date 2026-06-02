import { useToastStore, type ToastType } from '@/stores/toast-store'

const accentByType: Record<ToastType, string> = {
  success: 'border-[var(--success)] text-[var(--success)]',
  warning: 'border-[var(--warning)] text-[var(--warning)]',
  error: 'border-[var(--error)] text-[var(--error)]',
  info: 'border-[var(--accent)] text-[var(--accent)]'
}

const iconByType: Record<ToastType, string> = {
  success: 'OK',
  warning: '!',
  error: 'X',
  info: 'i'
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          aria-live="polite"
          className={`pointer-events-auto flex items-start gap-2 rounded-lg border-l-2 bg-[var(--bg-secondary)] px-3 py-2 text-xs shadow-lg ${accentByType[t.type]}`}
        >
          <span aria-hidden className={`mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border text-[12px] font-bold ${accentByType[t.type]}`}>
            {iconByType[t.type]}
          </span>
          <span className="min-w-0 flex-1 break-words leading-snug text-[var(--text-primary)]">
            {t.message}
          </span>
          <button
            onClick={() => dismiss(t.id)}
            title="Dismiss"
            className="rounded p-0.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
