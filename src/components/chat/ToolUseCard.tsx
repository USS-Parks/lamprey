import { useState } from 'react'
import type { ToolCallState } from '@/stores/chat-store'

const SERVER_ICONS: Record<string, string> = {
  gmail: 'M',
  drive: 'D',
  chrome: 'C',
}

interface ToolUseCardProps {
  toolCall: ToolCallState
}

export function ToolUseCard({ toolCall }: ToolUseCardProps) {
  const [expanded, setExpanded] = useState(false)
  const { serverId, toolName, status, args, result, duration } = toolCall

  const icon = SERVER_ICONS[serverId] ?? serverId.charAt(0).toUpperCase()

  const statusIndicator = (() => {
    switch (status) {
      case 'pending':
        return <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--text-muted)] border-t-[var(--accent)]" />
      case 'running':
        return <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-[var(--accent)]" />
      case 'success':
        return <span className="text-[var(--success)]">&#10003;</span>
      case 'error':
        return <span className="text-[var(--error)]">&#10005;</span>
      default:
        return null
    }
  })()

  const summaryText = (() => {
    const serverLabel = serverId.charAt(0).toUpperCase() + serverId.slice(1)
    if (status === 'success' && duration != null) {
      return `Used ${serverLabel}: ${toolName} (${duration}ms)`
    }
    if (status === 'error') {
      return `Failed ${serverLabel}: ${toolName}`
    }
    if (status === 'running') {
      return `Running ${serverLabel}: ${toolName}...`
    }
    return `Calling ${serverLabel}: ${toolName}...`
  })()

  const truncatedResult = result && result.length > 200 ? result.slice(0, 200) + '...' : result

  return (
    <div className="my-2 mx-auto max-w-[80%]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-left transition-colors hover:bg-[var(--bg-secondary)]"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded bg-[var(--accent-dim)] text-[12px] font-bold text-[var(--accent)]">
          {icon}
        </span>
        <span className="flex-1 text-xs text-[var(--text-secondary)]">{summaryText}</span>
        {statusIndicator}
        <span className="text-[12px] text-[var(--text-muted)]">{expanded ? '^' : 'v'}</span>
      </button>

      {expanded && (
        <div className="mt-1 rounded-b-lg border border-t-0 border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2">
          <div className="mb-1 text-[12px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
            Arguments
          </div>
          <pre className="mb-2 overflow-x-auto text-[13px] font-mono text-[var(--text-secondary)]">
            {JSON.stringify(args, null, 2)}
          </pre>
          {truncatedResult && (
            <>
              <div className="mb-1 text-[12px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                Result
              </div>
              <pre className="overflow-x-auto text-[13px] font-mono text-[var(--text-secondary)]">
                {truncatedResult}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}
