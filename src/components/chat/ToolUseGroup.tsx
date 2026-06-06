import { useState } from 'react'
import type { ToolCallState } from '@/stores/chat-store'
import {
  groupTotalDurationMs,
  type GroupedToolCallItem
} from '@/lib/tool-call-grouping'
import { formatElapsed } from '@/lib/tool-card-helpers'
import { ToolUseCard } from './ToolUseCard'

// Provider letter for the leading badge — mirrors ToolUseCard's table so
// a group reads visually the same as the cards it folds. Keep these two
// in sync.
const SERVER_LETTER: Record<string, string> = {
  gmail: 'M',
  drive: 'D',
  chrome: 'C',
  internal: 'L'
}

interface ToolUseGroupProps {
  group: Extract<GroupedToolCallItem, { kind: 'group' }>
}

/**
 * Codex / Claude Code parity: a planner exploration burst that fires 6
 * consecutive `shell_command` reads collapses into a single foldable
 * "Shell command · 6 calls · 1.5s" header instead of stacking 6 cards.
 *
 * Collapsed (default): single header row with the count + total elapsed.
 * Expanded: each call renders as its normal ToolUseCard inside the group.
 */
export function ToolUseGroup({ group }: ToolUseGroupProps) {
  const [expanded, setExpanded] = useState(false)

  const total = groupTotalDurationMs(group.items)
  const elapsedLabel = formatElapsed(total)
  const letter =
    SERVER_LETTER[group.serverId] ??
    (group.toolName[0] ?? 'T').toUpperCase()
  const count = group.items.length
  const subLabel =
    group.serverId && group.serverId !== 'internal' ? group.serverId : null

  return (
    <div className="my-2 mx-auto w-full max-w-[80%]">
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 rounded-lg border border-[var(--panel-border)] bg-[var(--bg-tertiary)] px-3 py-2 text-left transition-colors hover:bg-[var(--bg-secondary)]"
      >
        <span className="flex h-5 w-5 flex-none items-center justify-center rounded bg-[var(--accent-dim)] text-[12px] font-bold text-[var(--accent)]">
          {letter}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-xs font-medium text-[var(--text-primary)]">
            {group.title}
          </span>
          {subLabel && (
            <span className="truncate text-[11px] font-mono text-[var(--text-muted)]">
              · {subLabel}
            </span>
          )}
          <span className="truncate text-[11px] font-mono text-[var(--text-muted)]">
            · {count} call{count === 1 ? '' : 's'}
          </span>
        </span>
        <span className="flex-none text-[11px] font-mono text-[var(--text-muted)]">
          {elapsedLabel}
        </span>
        <span className="flex-none text-[var(--success)]" aria-label="all succeeded">
          &#10003;
        </span>
        <span className="flex-none text-[12px] text-[var(--text-muted)]" aria-hidden>
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {expanded && (
        <div className="mt-1 flex flex-col gap-0 border-l border-[var(--panel-border)] pl-2">
          {group.items.map((tc: ToolCallState) => (
            <ToolUseCard key={tc.callId} toolCall={tc} />
          ))}
        </div>
      )}
    </div>
  )
}
