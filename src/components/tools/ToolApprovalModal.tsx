import { useEffect, useState } from 'react'
import type {
  ApprovalDecision,
  ApprovalScope,
  ToolApprovalRequest,
  ToolRisk
} from '@/lib/types'

interface ToolApprovalModalProps {
  request: ToolApprovalRequest
  onResolved: () => void
  /** Fluidity J5: fired only on allow so App.tsx can mark the (server, tool)
   *  pair as approved-once → subsequent requests route to the inline chip. */
  onAllowed?: (request: ToolApprovalRequest) => void
}

const TIMEOUT_SECONDS = 30

const RISK_LABEL: Record<ToolRisk, string> = {
  read: 'Read',
  write: 'Write',
  network: 'Network',
  destructive: 'Destructive',
  secret: 'Secret access'
}

const RISK_COLOR: Record<ToolRisk, string> = {
  read: 'text-[var(--text-muted)] border-[var(--panel-border)]',
  write: 'text-amber-300 border-amber-500/30',
  network: 'text-sky-300 border-sky-500/30',
  destructive: 'text-red-300 border-red-500/40',
  secret: 'text-fuchsia-300 border-fuchsia-500/40'
}

export function ToolApprovalModal({ request, onResolved, onAllowed }: ToolApprovalModalProps) {
  const [countdown, setCountdown] = useState(TIMEOUT_SECONDS)
  const [scope, setScope] = useState<ApprovalScope>('once')

  useEffect(() => {
    if (countdown <= 0) {
      // Auto-deny — main process also has a 30s deny timeout, this is the
      // visible counterpart so users see *why* the modal closed.
      respond('deny', 'once')
      return
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown])

  const respond = (decision: ApprovalDecision, chosenScope: ApprovalScope) => {
    window.api?.tools.respondToApproval({
      callId: request.callId,
      decision,
      scope: chosenScope
    })
    if (decision === 'allow') onAllowed?.(request)
    onResolved()
  }

  const providerLabel =
    request.providerKind === 'mcp'
      ? request.serverId.charAt(0).toUpperCase() + request.serverId.slice(1)
      : request.providerKind === 'plugin'
      ? `Plugin: ${request.serverId}`
      : 'Lamprey'

  const displayName = request.name.includes('__')
    ? request.name.split('__').slice(1).join('__')
    : request.name

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-lg border border-[var(--panel-border)] bg-[var(--bg-secondary)] p-6 shadow-2xl">
        <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">
          Allow this action?
        </h2>

        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-[var(--accent-dim)] text-xs font-bold text-[var(--accent)]">
            {providerLabel.charAt(0)}
          </span>
          <span className="text-sm font-medium text-[var(--text-primary)]">{providerLabel}</span>
          <span className="text-sm text-[var(--text-muted)]">/</span>
          <span className="font-mono text-sm text-[var(--text-secondary)]">{displayName}</span>
        </div>

        {request.risks.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {request.risks.map((risk) => (
              <span
                key={risk}
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${RISK_COLOR[risk]}`}
              >
                {RISK_LABEL[risk]}
              </span>
            ))}
          </div>
        )}

        <div className="mb-4 rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-3">
          <pre className="max-h-48 overflow-auto text-xs font-mono text-[var(--text-secondary)]">
            {JSON.stringify(request.args, null, 2)}
          </pre>
        </div>

        <div className="mb-4 flex items-center justify-between gap-2 text-xs">
          <label className="flex items-center gap-1.5 text-[var(--text-muted)]">
            <span>Decision scope:</span>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as ApprovalScope)}
              className="rounded border border-[var(--panel-border)] bg-[var(--bg-tertiary)] px-2 py-1 text-xs text-[var(--text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              disabled={!request.conversationId && scope === 'conversation'}
            >
              <option value="once">Just this once</option>
              <option value="conversation" disabled={!request.conversationId}>
                This conversation
              </option>
              <option value="workspace">This workspace</option>
              <option value="always">Always (every workspace)</option>
            </select>
          </label>
          <span className="text-[var(--text-muted)]">Auto-deny in {countdown}s</span>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => respond('deny', scope)}
            className="flex-1 rounded-lg border border-[var(--panel-border)] bg-[var(--bg-tertiary)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)]"
          >
            Deny
          </button>
          <button
            onClick={() => respond('allow', scope)}
            className="flex-1 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:brightness-110"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  )
}
