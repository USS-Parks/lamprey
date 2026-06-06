import { useEffect, useState } from 'react'
import type { ToolCallState } from '@/stores/chat-store'
import type { ToolRisk } from '@/lib/types'
import {
  RISK_LABEL,
  RISK_TONE,
  collapsedSummary,
  formatElapsed,
  previewResult
} from '@/lib/tool-card-helpers'

// Provider letter for the leading badge. Three explicit entries match the
// bundled MCP servers; everything else uses the first letter of the
// serverId for native tools ('I' for 'internal', 'W' for 'workspace', etc.)
// when the providerKind cue doesn't add value.
const SERVER_LETTER: Record<string, string> = {
  gmail: 'M',
  drive: 'D',
  chrome: 'C',
  internal: 'L'
}

interface ToolUseCardProps {
  toolCall: ToolCallState
}

function StatusIndicator({ status }: { status: ToolCallState['status'] }) {
  switch (status) {
    case 'pending':
      return (
        <span
          className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--text-muted)] border-t-[var(--accent)]"
          aria-label="pending"
        />
      )
    case 'running':
      return (
        <span
          className="inline-block h-3 w-3 animate-pulse rounded-full bg-[var(--accent)]"
          aria-label="running"
        />
      )
    case 'success':
      return (
        <span className="text-[var(--success)]" aria-label="success">
          &#10003;
        </span>
      )
    case 'error':
      return (
        <span className="text-[var(--error)]" aria-label="error">
          &#10005;
        </span>
      )
    case 'denied':
      return (
        <span className="text-[var(--text-muted)]" aria-label="denied">
          ⊘
        </span>
      )
    default:
      return null
  }
}

function RiskBadges({ risks }: { risks: ToolRisk[] | undefined }) {
  if (!risks || risks.length === 0) return null
  // Cap visible badges so a `['write','network','destructive']` tool doesn't
  // push the elapsed/status icons off-screen on narrow widths. Order is
  // preserved from the descriptor.
  const visible = risks.slice(0, 3)
  return (
    <span className="flex flex-none items-center gap-1">
      {visible.map((r) => (
        <span
          key={r}
          title={RISK_LABEL[r]}
          className={
            'rounded-full border bg-transparent px-1.5 py-[1px] text-[10px] font-mono uppercase tracking-wider ' +
            (RISK_TONE[r] ?? 'border-[var(--panel-border)] text-[var(--text-muted)]')
          }
        >
          {r}
        </span>
      ))}
    </span>
  )
}

function useLiveElapsed(startedAt: number | undefined, active: boolean): string | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active || !startedAt) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [active, startedAt])
  if (!startedAt) return null
  return formatElapsed(now - startedAt)
}

export function ToolUseCard({ toolCall }: ToolUseCardProps) {
  // Fluidity J6: auto-collapse on success unless the tool is destructive
  // (or the result is an error). Failures + destructive successes mount
  // expanded — those are the cases a reviewer needs to see without a
  // click. User toggles override the auto-rule for the life of the card,
  // ephemerally — collapse intent isn't pushed to a store.
  const [userToggled, setUserToggled] = useState<boolean | null>(null)
  const {
    serverId,
    toolName,
    title,
    risks,
    status,
    args,
    result,
    duration,
    startedAt
  } = toolCall

  const isError = status === 'error'
  const isDenied = status === 'denied'
  const isRunning = status === 'pending' || status === 'running'
  const isDestructive = (risks ?? []).includes('destructive')
  // Auto-expand failures + destructive-success terminal states. Running /
  // pending / denied stay collapsed (denied result is short; running has
  // its live elapsed in the header).
  const autoExpanded = isError || (status === 'success' && isDestructive)
  const expanded = userToggled !== null ? userToggled : autoExpanded

  // Plain-English label first. Fall back to the bare tool name if the
  // descriptor didn't ship a title (unknown / stale entry).
  const displayLabel = title && title.length > 0 ? title : toolName
  const subLabel =
    serverId && serverId !== 'internal' ? serverId : null

  const letter =
    SERVER_LETTER[serverId] ?? (toolName[0] ?? 'T').toUpperCase()

  const liveElapsed = useLiveElapsed(startedAt, isRunning)
  const elapsedLabel = isRunning
    ? liveElapsed ?? '…'
    : typeof duration === 'number'
      ? formatElapsed(duration)
      : null

  const argsSummary = collapsedSummary(args)

  const preview = previewResult(result, { lineCap: 4, charCap: 240 })

  const borderClass = isError
    ? 'border-[var(--error)]/40'
    : isDenied
      ? 'border-[var(--text-muted)]/40'
      : 'border-transparent'

  const argsJson = (() => {
    try {
      return JSON.stringify(args ?? {}, null, 2)
    } catch {
      return String(args ?? '')
    }
  })()

  return (
    <div className="my-2 mx-auto w-full max-w-[80%]">
      <button
        onClick={() => setUserToggled(!expanded)}
        aria-expanded={expanded}
        className={
          'flex w-full items-start gap-2 rounded-lg border bg-[var(--bg-tertiary)] px-3 py-2 text-left transition-colors hover:bg-[var(--bg-secondary)] ' +
          borderClass
        }
      >
        <span className="mt-[2px] flex h-5 w-5 flex-none items-center justify-center rounded bg-[var(--accent-dim)] text-[12px] font-bold text-[var(--accent)]">
          {letter}
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs font-medium text-[var(--text-primary)]">
              {displayLabel}
            </span>
            {subLabel && (
              <span className="truncate text-[11px] font-mono text-[var(--text-muted)]">
                · {subLabel}
              </span>
            )}
          </span>
          <span className="truncate text-[11px] font-mono text-[var(--text-muted)]">
            {argsSummary}
          </span>
        </span>

        <RiskBadges risks={risks} />

        {elapsedLabel && (
          <span className="flex-none text-[11px] font-mono text-[var(--text-muted)]">
            {elapsedLabel}
          </span>
        )}

        <span className="flex-none">
          <StatusIndicator status={status} />
        </span>

        <span
          className="flex-none text-[12px] text-[var(--text-muted)]"
          aria-hidden
        >
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {expanded && (
        <div
          className={
            'mt-1 rounded-b-lg border border-t-0 bg-[var(--bg-primary)] px-3 py-2 ' +
            borderClass
          }
        >
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
            Arguments
          </div>
          <pre className="mb-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[12px] font-mono text-[var(--text-secondary)]">
            {argsJson}
          </pre>

          {(result || isError || isDenied) && (
            <>
              <div className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider">
                <span className="text-[var(--text-muted)]">Result</span>
                {isError && (
                  <span className="rounded-full border border-[var(--error)]/40 px-1.5 py-[1px] text-[10px] text-[var(--error)]">
                    error
                  </span>
                )}
                {isDenied && (
                  <span className="rounded-full border border-[var(--text-muted)]/40 px-1.5 py-[1px] text-[10px] text-[var(--text-muted)]">
                    denied
                  </span>
                )}
              </div>
              <pre
                className={
                  'max-h-64 overflow-auto whitespace-pre-wrap break-words text-[12px] font-mono ' +
                  (isError
                    ? 'text-[var(--error)]'
                    : isDenied
                      ? 'text-[var(--text-muted)] italic'
                      : 'text-[var(--text-secondary)]')
                }
              >
                {result || (isDenied ? 'Denied by user.' : '')}
              </pre>
              {preview.truncated && (
                <div className="mt-1 text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                  showing full result (collapsed preview was truncated)
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
