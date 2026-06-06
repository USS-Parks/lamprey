import { useEffect, useState } from 'react'
import thinkingIconUrl from '@assets/Lamprey Thinking Icon.png'

interface ReasoningBlockProps {
  content: string
  isThinking?: boolean
}

export function ReasoningBlock({ content, isThinking = false }: ReasoningBlockProps) {
  // Auto-expand while the model is actively thinking; collapse once the
  // reasoning block closes so the final answer is the focus.
  const [expanded, setExpanded] = useState(isThinking)
  const [userOverride, setUserOverride] = useState(false)

  useEffect(() => {
    if (userOverride) return
    setExpanded(isThinking)
  }, [isThinking, userOverride])

  if (!content && !isThinking) return null

  const handleToggle = () => {
    setUserOverride(true)
    setExpanded((v) => !v)
  }

  return (
    <div className="mb-2 overflow-hidden rounded-2xl border border-[var(--panel-border)] bg-[var(--bg-primary)] shadow-sm">
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
      >
        <span className="flex items-center gap-2">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {expanded ? <path d="M6 9l6 6 6-6" /> : <path d="M9 6l6 6-6 6" />}
          </svg>
          <img
            src={thinkingIconUrl}
            alt=""
            aria-hidden
            className={`icon-asset h-10 w-10 object-contain ${isThinking ? 'animate-pulse' : ''}`}
          />
          <span className="uppercase tracking-wider">Reasoning</span>
          {isThinking && (
            <span className="rounded-full bg-[var(--accent-dim)] px-2 py-0.5 text-[11px] text-[var(--accent)]">
              thinking…
            </span>
          )}
        </span>
        <span className="text-[12px] text-[var(--text-muted)]">
          {content.length} {content.length === 1 ? 'char' : 'chars'}
        </span>
      </button>
      {expanded && (
        <pre className="max-h-[260px] overflow-auto border-t border-[var(--panel-border)] px-3 py-2 font-mono text-[13px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap">
          {content}
        </pre>
      )}
    </div>
  )
}
