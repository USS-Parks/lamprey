// G1 — last-run preview for an automation. Shows when it ran and a
// snippet of the reply. The store keeps `lastResult` capped at 4000
// chars, which is plenty for a quick glance — full history viewer
// belongs to the Integration Phase activity dashboard.

interface Props {
  lastRunAt: number | null
  lastResult: string | null
}

function formatWhen(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleString()
}

export function RunHistoryViewer({ lastRunAt, lastResult }: Props) {
  if (!lastRunAt) {
    return (
      <p className="px-2 py-1 text-[11px] text-[var(--text-muted)]">
        Has not run yet.
      </p>
    )
  }
  return (
    <div className="px-2 py-1 text-[11px] text-[var(--text-secondary)]">
      <span className="text-[var(--text-muted)]">Last run: </span>
      {formatWhen(lastRunAt)}
      {lastResult && (
        <pre className="mt-1 max-h-32 overflow-y-auto rounded border border-[var(--border)] bg-[var(--bg-primary)] p-1.5 text-[10px] leading-snug text-[var(--text-primary)] whitespace-pre-wrap">
          {lastResult}
        </pre>
      )}
    </div>
  )
}
