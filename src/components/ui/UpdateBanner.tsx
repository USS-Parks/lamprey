import { useEffect, useState } from 'react'

interface UpdateInfo {
  version: string | null
  releaseNotes: string | null
}

export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!window.api) return
    window.api.update.onAvailable((payload) => {
      setInfo(payload as UpdateInfo)
      setDismissed(false)
    })
    window.api.update.onDownloaded((payload) => {
      setInfo((prev) => prev ?? { version: (payload as { version: string | null }).version, releaseNotes: null })
      setDismissed(false)
    })
  }, [])

  if (!info || dismissed) return null

  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--accent)] bg-[var(--accent-dim)] px-4 py-2 text-xs text-[var(--text-primary)]">
      <span>
        Update available{info.version ? ` (v${info.version})` : ''} — restart to install.
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => window.api.update.restart()}
          className="rounded bg-[var(--accent)] px-2 py-1 text-[11px] font-medium text-white hover:opacity-90"
        >
          Restart
        </button>
        <button
          onClick={() => setDismissed(true)}
          title="Dismiss"
          className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
