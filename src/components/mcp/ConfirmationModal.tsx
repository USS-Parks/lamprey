import { useEffect, useState } from 'react'
import type { McpConfirmationEvent } from '@/lib/types'

interface ConfirmationModalProps {
  event: McpConfirmationEvent
  onDismiss: () => void
}

const TIMEOUT_SECONDS = 30

export function ConfirmationModal({ event, onDismiss }: ConfirmationModalProps) {
  const [countdown, setCountdown] = useState(TIMEOUT_SECONDS)

  useEffect(() => {
    if (countdown <= 0) {
      window.api?.mcp.approveToolCall(event.callId, false)
      onDismiss()
      return
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown, event.callId, onDismiss])

  const handleAllow = () => {
    window.api?.mcp.approveToolCall(event.callId, true)
    onDismiss()
  }

  const handleDeny = () => {
    window.api?.mcp.approveToolCall(event.callId, false)
    onDismiss()
  }

  const serverLabel = event.serverId.charAt(0).toUpperCase() + event.serverId.slice(1)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-6 shadow-2xl">
        <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">
          Allow this action?
        </h2>

        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-[var(--accent-dim)] text-xs font-bold text-[var(--accent)]">
            {serverLabel.charAt(0)}
          </span>
          <span className="text-sm font-medium text-[var(--text-primary)]">{serverLabel}</span>
          <span className="text-sm text-[var(--text-muted)]">/</span>
          <span className="font-mono text-sm text-[var(--text-secondary)]">{event.toolName}</span>
        </div>

        <div className="mb-4 rounded border border-[var(--border)] bg-[var(--bg-primary)] p-3">
          <pre className="overflow-x-auto text-xs font-mono text-[var(--text-secondary)]">
            {JSON.stringify(event.args, null, 2)}
          </pre>
        </div>

        <div className="mb-4 text-center text-xs text-[var(--text-muted)]">
          Auto-deny in {countdown}s
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleDeny}
            className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)]"
          >
            Deny
          </button>
          <button
            onClick={handleAllow}
            className="flex-1 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:brightness-110"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  )
}
