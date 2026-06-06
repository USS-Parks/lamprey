import { useState } from 'react'
import type { Message } from '@/lib/types'

// Track 2 / E5 — pill rendered IN PLACE OF a system-role message whose
// content is a `<conversation_summary>...</conversation_summary>` block.
// The MessageList detects the marker and substitutes this component.
// Click to expand: reveals the summary body (the deterministic per-turn
// excerpts the compressor produced).

interface CompressedRegionPillProps {
  message: Message
}

const TAG_OPEN = '<conversation_summary>'
const TAG_CLOSE = '</conversation_summary>'

function extractSummary(content: string): string {
  const start = content.indexOf(TAG_OPEN)
  const end = content.indexOf(TAG_CLOSE)
  if (start === -1 || end === -1 || end <= start) return content
  return content.slice(start + TAG_OPEN.length, end).trim()
}

function countCompressedMessages(content: string): number {
  // The summary's first body line is `Compressed <N> earlier messages...`.
  const m = /Compressed\s+(\d+)\s+earlier messages/i.exec(content)
  if (!m) return 0
  return Number(m[1])
}

export function CompressedRegionPill({ message }: CompressedRegionPillProps) {
  const [expanded, setExpanded] = useState(false)
  const summary = extractSummary(message.content)
  const count = countCompressedMessages(message.content)
  const label = count > 0 ? `${count} earlier messages compressed` : 'Earlier messages compressed'

  return (
    <div
      className="my-3 rounded-md border border-[var(--panel-border)] bg-[var(--bg-secondary)] p-2 text-[12px] text-[var(--text-muted)]"
      data-summary-id={message.id}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 text-left text-[var(--text-primary)] hover:text-[var(--accent)]"
        aria-expanded={expanded}
      >
        <span
          aria-hidden
          className="inline-block h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]"
        />
        <span className="font-medium">{label}</span>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
          {expanded ? 'hide' : 'show'}
        </span>
      </button>
      {expanded && (
        <pre className="m-0 mt-2 whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-[var(--text-muted)]">
          {summary}
        </pre>
      )}
    </div>
  )
}

/**
 * Detect a summary message produced by the context compressor. Used
 * by MessageList to swap a regular MessageBubble for a
 * CompressedRegionPill.
 */
export function isCompressedSummaryMessage(message: Message): boolean {
  return (
    message.role === 'system' &&
    typeof message.content === 'string' &&
    message.content.includes(TAG_OPEN)
  )
}
