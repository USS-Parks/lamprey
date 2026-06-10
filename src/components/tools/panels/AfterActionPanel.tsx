import { useEffect, useMemo, useState } from 'react'
import { useChatStore } from '@/stores/chat-store'
import type {
  AfterActionCauseSeverity,
  AfterActionProofReceiptItem,
  AfterActionReport,
  AfterActionTimelineItem,
  AfterActionToolItem
} from '@/lib/types'

interface HarnessRecItem {
  id: string
  kind: string
  title: string
  description: string
  severity: 'info' | 'warning' | 'error'
  evidence: Array<{ type: string; id: string }>
  suggestion: string
}

interface IpcEnvelope<T> {
  success: boolean
  data?: T
  error?: string
}

// SP-8 — mirror of RouterDecisionTelemetryEntry (electron/services/
// router-telemetry.ts). Session-scoped ring buffer; only populated when
// agentMode is 'auto'.
interface RouterDecisionItem {
  promptHash: string
  promptLength: number
  route: 'single' | 'multi'
  matchedRule: string
  reason: string
  timestamp: number
  conversationId?: string
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  })
}

function formatDuration(ms?: number): string {
  if (typeof ms !== 'number') return ''
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
  const minutes = Math.floor(seconds / 60)
  const rem = Math.round(seconds % 60)
  return `${minutes}m ${rem}s`
}

function SeverityDot({ severity }: { severity: AfterActionCauseSeverity | string }) {
  const tone =
    severity === 'error'
      ? 'bg-[var(--error)]'
      : severity === 'warning'
        ? 'bg-[var(--warning)]'
        : 'bg-[var(--accent)]'
  return <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${tone}`} />
}

function CountPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1">
      <div className="font-mono text-[15px] text-[var(--text-primary)]">{value}</div>
      <div className="truncate text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </div>
    </div>
  )
}

function ContractRow({
  contract
}: {
  contract: { id: string; goal: string; verificationCommands: string[] }
}) {
  return (
    <li className="border-b border-[var(--panel-border)] px-3 py-2 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-primary)]">
          {contract.goal}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-[var(--warning)]">active</span>
      </div>
      <div className="mt-1 truncate font-mono text-[10px] text-[var(--text-muted)]">
        {contract.verificationCommands.length > 0
          ? contract.verificationCommands.join(' - ')
          : contract.id}
      </div>
    </li>
  )
}

function ReceiptRow({ receipt }: { receipt: AfterActionProofReceiptItem }) {
  const tone =
    receipt.status === 'failed'
      ? 'text-[var(--error)]'
      : receipt.status === 'skipped'
        ? 'text-[var(--warning)]'
        : 'text-[var(--success)]'
  const metrics = Object.keys(receipt.metrics ?? {}).length > 0
    ? JSON.stringify(receipt.metrics)
    : ''
  return (
    <li className="border-b border-[var(--panel-border)] px-3 py-2 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text-primary)]">
          {receipt.kind} receipt {receipt.id}
        </span>
        <span className={`shrink-0 font-mono text-[10px] ${tone}`}>{receipt.status}</span>
      </div>
      <div className="mt-1 truncate text-[11px] text-[var(--text-secondary)]">
        {receipt.command}
      </div>
      <div className="mt-0.5 flex gap-2 overflow-hidden font-mono text-[10px] text-[var(--text-muted)]">
        {receipt.exitCode !== undefined && <span>exit {receipt.exitCode}</span>}
        <span>{formatDuration(receipt.durationMs)}</span>
        {metrics && <span className="truncate">{metrics}</span>}
      </div>
    </li>
  )
}

function TimelineRow({ item }: { item: AfterActionTimelineItem }) {
  return (
    <li className="flex gap-2 border-b border-[var(--panel-border)] px-3 py-2 last:border-b-0">
      <SeverityDot severity={item.severity} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-[var(--text-muted)]">
            {formatTime(item.at)}
          </span>
          <span className="truncate font-mono text-[10px] text-[var(--text-secondary)]">
            {item.type}
          </span>
        </div>
        <div className="mt-0.5 break-words text-[12px] leading-snug text-[var(--text-secondary)]">
          {item.summary}
        </div>
      </div>
    </li>
  )
}

function ToolRow({ tool }: { tool: AfterActionToolItem }) {
  const statusTone =
    tool.status === 'error'
      ? 'text-[var(--error)]'
      : tool.status === 'denied'
        ? 'text-[var(--warning)]'
        : 'text-[var(--success)]'
  return (
    <li className="border-b border-[var(--panel-border)] px-3 py-2 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="truncate text-[12px] font-medium text-[var(--text-primary)]">
          {tool.name}
        </span>
        <span className={`ml-auto shrink-0 font-mono text-[10px] ${statusTone}`}>
          {tool.status}
        </span>
        {tool.durationMs !== undefined && (
          <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">
            {formatDuration(tool.durationMs)}
          </span>
        )}
      </div>
      <div className="mt-1 truncate font-mono text-[10px] text-[var(--text-muted)]">
        {tool.argsPreview || '{}'}
      </div>
      {(tool.errorPreview || tool.resultPreview) && (
        <div
          className={`mt-1 line-clamp-2 text-[11px] leading-snug ${
            tool.errorPreview ? 'text-[var(--error)]' : 'text-[var(--text-secondary)]'
          }`}
        >
          {tool.errorPreview || tool.resultPreview}
        </div>
      )}
    </li>
  )
}

export function AfterActionPanel(): React.ReactElement {
  const conversationId = useChatStore((s) => s.activeConversationId)
  const [report, setReport] = useState<AfterActionReport | null>(null)
  const [recs, setRecs] = useState<HarnessRecItem[]>([])
  const [routerDecisions, setRouterDecisions] = useState<RouterDecisionItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    if (!conversationId) {
      setReport(null)
      setRecs([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = (await window.api.afterAction.get(
        conversationId
      )) as IpcEnvelope<AfterActionReport>
      if (result.success && result.data) {
        setReport(result.data)
      } else {
        setReport(null)
        setError(result.error ?? 'Could not build after-action report')
      }

      // Load harness recommendations alongside (M12).
      try {
        const recsResult = (await window.api.harnessRecs.list(
          conversationId
        )) as IpcEnvelope<HarnessRecItem[]>
        if (recsResult.success && recsResult.data) {
          setRecs(recsResult.data)
        }
      } catch { /* best-effort */ }

      // SP-8 — recent auto-router decisions for this conversation (D6).
      try {
        const routerResult = (await window.api.afterAction.routerTelemetry(
          conversationId
        )) as IpcEnvelope<RouterDecisionItem[]>
        if (routerResult.success && routerResult.data) {
          setRouterDecisions(routerResult.data)
        }
      } catch { /* best-effort */ }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [conversationId])

  const counts = report?.counts
  const countRows = useMemo(
    () =>
      counts
        ? [
            ['Messages', counts.messages],
            ['Prompts', counts.userPrompts],
            ['Assistant', counts.assistantTurns],
            ['Empty', counts.emptyAssistantTurns],
            ['Tool turns', counts.toolRequestTurns],
            ['Tool errors', counts.toolErrors],
            ['Chat errors', counts.chatErrors],
            ['Events', counts.events]
          ] as Array<[string, number]>
        : [],
    [counts]
  )

  if (!conversationId) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] text-[var(--text-muted)]">
        Open a conversation to view its after-action report.
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[var(--panel-border)] px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-secondary)]">
          {report?.title ?? 'After-action report'}
        </span>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)] disabled:opacity-50"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        {error && (
          <div className="rounded-md border border-[var(--error)]/40 bg-[var(--bg-primary)] px-3 py-2 text-[12px] text-[var(--error)]">
            {error}
          </div>
        )}

        {!report && !error && (
          <div className="flex flex-1 items-center justify-center text-[12px] text-[var(--text-muted)]">
            {loading ? 'Building report...' : 'No report available.'}
          </div>
        )}

        {report && (
          <>
            <section>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                Signals
              </div>
              <ul className="overflow-hidden rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)]">
                {report.causes.map((cause) => (
                  <li
                    key={`${cause.title}-${cause.detail}`}
                    className="flex gap-2 border-b border-[var(--panel-border)] px-3 py-2 last:border-b-0"
                  >
                    <SeverityDot severity={cause.severity} />
                    <div className="min-w-0">
                      <div className="text-[12px] font-medium text-[var(--text-primary)]">
                        {cause.title}
                      </div>
                      <div className="mt-0.5 text-[12px] leading-snug text-[var(--text-secondary)]">
                        {cause.detail}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                Counts
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {countRows.map(([label, value]) => (
                  <CountPill key={label} label={label} value={value} />
                ))}
              </div>
            </section>

            <section>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                Proof
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <CountPill label="Passed" value={report.proof.gatePassed} />
                <CountPill label="Failed" value={report.proof.gateFailed} />
                <CountPill label="Waived" value={report.proof.gateWaived} />
              </div>
              {report.proof.latestFailureReason && (
                <div className="mt-1.5 rounded-md border border-[var(--warning)]/35 bg-[var(--bg-primary)] px-3 py-2 text-[12px] leading-snug text-[var(--text-secondary)]">
                  {report.proof.latestFailureReason}
                </div>
              )}
              {report.proof.activeContracts.length > 0 && (
                <ul className="mt-1.5 overflow-hidden rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)]">
                  {report.proof.activeContracts.map((contract) => (
                    <ContractRow key={contract.id} contract={contract} />
                  ))}
                </ul>
              )}
              {report.proof.receipts.length > 0 && (
                <ul className="mt-1.5 overflow-hidden rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)]">
                  {report.proof.receipts.slice(0, 12).map((receipt) => (
                    <ReceiptRow key={receipt.id} receipt={receipt} />
                  ))}
                </ul>
              )}
              {(report.proof.failedCommands.length > 0 ||
                report.proof.skippedCommands.length > 0) && (
                <div className="mt-1.5 rounded-md border border-[var(--warning)]/35 bg-[var(--bg-primary)] px-3 py-2 text-[12px] leading-snug text-[var(--text-secondary)]">
                  {report.proof.failedCommands.length > 0 && (
                    <div>Failed: {report.proof.failedCommands.join(', ')}</div>
                  )}
                  {report.proof.skippedCommands.length > 0 && (
                    <div>Skipped: {report.proof.skippedCommands.join(', ')}</div>
                  )}
                </div>
              )}
              {report.proof.reviewerCheckedModes.length > 0 && (
                <ul className="mt-1.5 overflow-hidden rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)]">
                  {report.proof.reviewerCheckedModes.map((line, idx) => (
                    <li
                      key={`${idx}-${line}`}
                      className="border-b border-[var(--panel-border)] px-3 py-1.5 text-[11px] leading-snug text-[var(--text-secondary)] last:border-b-0"
                    >
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {routerDecisions.length > 0 && (
              <section>
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  Routing
                </div>
                <ul className="overflow-hidden rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)]">
                  {routerDecisions.slice(-12).map((d) => (
                    <li
                      key={`${d.promptHash}-${d.timestamp}`}
                      className="border-b border-[var(--panel-border)] px-3 py-2 last:border-b-0"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-[var(--text-muted)]">
                          {formatTime(d.timestamp)}
                        </span>
                        <span
                          className={`shrink-0 rounded px-1 font-mono text-[10px] ${
                            d.route === 'multi'
                              ? 'bg-purple-500/15 text-purple-400'
                              : 'bg-[var(--bg-tertiary)]/60 text-[var(--text-secondary)]'
                          }`}
                        >
                          {d.route}
                        </span>
                        <span className="truncate font-mono text-[10px] text-[var(--text-muted)]">
                          {d.matchedRule}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[12px] leading-snug text-[var(--text-secondary)]">
                        {d.reason}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {recs.length > 0 && (
              <section>
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  Recommendations
                </div>
                <ul className="overflow-hidden rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)]">
                  {recs.map((rec) => (
                    <li
                      key={rec.id}
                      className="flex gap-2 border-b border-[var(--panel-border)] px-3 py-2 last:border-b-0"
                    >
                      <SeverityDot severity={rec.severity} />
                      <div className="min-w-0">
                        <div className="text-[12px] font-medium text-[var(--text-primary)]">
                          {rec.title}
                        </div>
                        <div className="mt-0.5 text-[12px] leading-snug text-[var(--text-secondary)]">
                          {rec.description}
                        </div>
                        <div className="mt-1 text-[11px] leading-snug text-[var(--accent)]">
                          {rec.suggestion}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {(report.latestUserPrompt || report.latestAssistantText) && (
              <section>
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  Last visible context
                </div>
                <div className="space-y-1.5">
                  {report.latestUserPrompt && (
                    <div className="rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)] px-3 py-2">
                      <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                        User
                      </div>
                      <div className="mt-1 text-[12px] leading-snug text-[var(--text-secondary)]">
                        {report.latestUserPrompt}
                      </div>
                    </div>
                  )}
                  {report.latestAssistantText && (
                    <div className="rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)] px-3 py-2">
                      <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                        Assistant
                      </div>
                      <div className="mt-1 text-[12px] leading-snug text-[var(--text-secondary)]">
                        {report.latestAssistantText}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {report.recentTools.length > 0 && (
              <section>
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  Recent tools
                </div>
                <ul className="overflow-hidden rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)]">
                  {report.recentTools.slice(0, 16).map((tool) => (
                    <ToolRow key={tool.id} tool={tool} />
                  ))}
                </ul>
              </section>
            )}

            {report.timeline.length > 0 && (
              <section>
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  Timeline
                </div>
                <ul className="overflow-hidden rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)]">
                  {report.timeline.slice(-40).map((item) => (
                    <TimelineRow key={item.id} item={item} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
