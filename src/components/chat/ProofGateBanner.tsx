import { useMemo, useState } from 'react'
import { toast } from '@/stores/toast-store'
import { useUiStore } from '@/stores/ui-store'
import type { ParsedProofGateNotice } from './proof-gate-notice'

/**
 * WC-5 — Proof gate banner state, derived from the persisted
 * `messages.proof_status` column (WC-4) rather than parsed prose.
 *
 * 'untrusted' → render the warning + Waive button.
 * 'blocked'   → render the warning, no waive (strict-mode reserved).
 * 'waived'    → render a muted "waived" chip.
 * 'trusted' / undefined → caller should not render this banner.
 */
export type ProofBannerState = 'untrusted' | 'blocked' | 'waived'

interface ProofGateBannerProps {
  notice: ParsedProofGateNotice
  /** WC-5 — explicit state derived from the message's `proofStatus`.
   *  When undefined the banner falls back to the legacy "notice text
   *  present = untrusted" inference so pre-WC-4 rows still render. */
  state?: ProofBannerState
  /** WC-5 — message id, used to flip `messages.proof_status` to
   *  `'waived'` after a successful waiver. Optional so the banner still
   *  renders when called from contexts that don't yet thread it. */
  messageId?: string
}

export function ProofGateBanner({ notice, state, messageId }: ProofGateBannerProps) {
  const setActiveTool = useUiStore((s) => s.setActiveTool)
  const [waiverOpen, setWaiverOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  // Hide locally after a successful waiver so the UI doesn't have to wait
  // for the next message refetch. The persisted state is also updated via
  // the messages:setProofStatus IPC so the next load reflects the change.
  const [waivedLocally, setWaivedLocally] = useState(false)

  const effectiveState: ProofBannerState = state ?? 'untrusted'

  // useMemo must run unconditionally — keep this above the early return
  // for the "waived" path so React's rules-of-hooks invariant holds.
  const receiptLabel = useMemo(() => {
    const pieces: string[] = []
    if (notice.failedReceiptIds.length > 0) pieces.push(`${notice.failedReceiptIds.length} failed`)
    if (notice.skippedReceiptIds.length > 0) pieces.push(`${notice.skippedReceiptIds.length} skipped`)
    return pieces.join(', ')
  }, [notice.failedReceiptIds.length, notice.skippedReceiptIds.length])

  if (waivedLocally || effectiveState === 'waived') {
    return (
      <div className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[var(--panel-border)] bg-[var(--bg-tertiary)]/50 px-2 py-1 text-[11px] text-[var(--text-muted)]">
        <span aria-hidden>✓</span>
        <span>Proof gate waived</span>
      </div>
    )
  }

  const submitWaiver = async () => {
    const trimmed = reason.trim()
    if (!notice.contractId || !trimmed || saving) return
    setSaving(true)
    try {
      const result = await window.api?.contracts?.waive?.({
        id: notice.contractId,
        reason: trimmed,
        waivedBy: 'user'
      })
      if (result?.success) {
        // WC-5 — flip the message's persisted proof_status to 'waived' so
        // the banner does not return on refetch / reload.
        if (messageId) {
          await window.api?.messages?.setProofStatus?.({
            messageId,
            status: 'waived'
          })
        }
        toast.success('Proof gate waived')
        setWaivedLocally(true)
        setWaiverOpen(false)
        setReason('')
      } else {
        toast.error(result?.error ?? 'Could not waive proof gate')
      }
    } finally {
      setSaving(false)
    }
  }

  const headerLabel =
    effectiveState === 'blocked' ? 'Blocked completion' : 'Untrusted completion'

  return (
    <div className="mt-3 rounded-md border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-3 py-2 text-[12px] text-[var(--text-secondary)]">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-[var(--text-primary)]">{headerLabel}</div>
          <div className="mt-0.5 leading-snug">{notice.reason}</div>
          {(notice.contractId || receiptLabel) && (
            <div className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">
              {[notice.contractId ? `contract ${notice.contractId}` : null, receiptLabel]
                .filter(Boolean)
                .join(' · ')}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setActiveTool('afterAction')}
          className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
        >
          After action
        </button>
        {notice.contractId && (
          <button
            type="button"
            onClick={() => setWaiverOpen((v) => !v)}
            className="rounded border border-[var(--warning)]/50 bg-[var(--bg-primary)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:border-[var(--warning)] hover:text-[var(--text-primary)]"
          >
            Waive
          </button>
        )}
      </div>
      {waiverOpen && notice.contractId && (
        <div className="mt-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Why this is acceptable without fresh proof"
            className="w-full resize-none rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--warning)]"
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setWaiverOpen(false)}
              className="rounded px-2 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitWaiver()}
              disabled={!reason.trim() || saving}
              className="rounded bg-[var(--warning)] px-2 py-1 text-[11px] font-medium text-[var(--bg-primary)] disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save waiver'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
