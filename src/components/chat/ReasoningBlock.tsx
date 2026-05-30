import { useState } from 'react'
import thinkingIconUrl from '@assets/Lamprey Thinking Icon.png'

interface ReasoningBlockProps {
  content: string
  isThinking?: boolean
}

export function ReasoningBlock({ content, isThinking = false }: ReasoningBlockProps) {
  const [expanded, setExpanded] = useState(false)

  if (!content && !isThinking) return null

  return (
    <div className="mb-2 overflow-hidden rounded border border-[var(--border)] bg-[var(--bg-primary)]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
      >
        <span className="flex items-center gap-2">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {expanded ? <path d="M6 9l6 6 6-6" /> : <path d="M9 6l6 6-6 6" />}
          </svg>
          <img
            src={thinkingIconUrl}
            alt=""
            aria-hidden
            className={`h-4 w-4 object-contain ${isThinking ? 'animate-pulse' : ''}`}
          />
          <span className="uppercase tracking-wider">Reasoning</span>
          {isThinking && (
            <span className="rounded bg-[var(--accent-dim)] px-1.5 py-0.5 text-[9px] text-[var(--accent)]">
              thinking…
            </span>
          )}
        </span>
        <span className="text-[10px] text-[var(--text-muted)]">
          {content.length} {content.length === 1 ? 'char' : 'chars'}
        </span>
      </button>
      {expanded && (
        <pre className="max-h-[260px] overflow-auto border-t border-[var(--border)] px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap">
          {content}
        </pre>
      )}
    </div>
  )
}
