import { useEffect, useState } from 'react'
import { useChatStore, type ToolCallState } from '@/stores/chat-store'
import { parseReasoning } from '@/lib/reasoning'

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}m ${r}s`
}

function StatusDot({ status }: { status: ToolCallState['status'] }) {
  switch (status) {
    case 'pending':
      return <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-[var(--text-muted)] border-t-[var(--accent)]" />
    case 'running':
      return <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--accent)]" />
    case 'success':
      return <span className="text-[var(--success)] leading-none">✓</span>
    case 'error':
      return <span className="text-[var(--error)] leading-none">✕</span>
    default:
      return <span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--text-muted)]" />
  }
}

function summarizeArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args)
  if (keys.length === 0) return ''
  const first = keys[0]
  const v = args[first]
  const preview = typeof v === 'string' ? v : JSON.stringify(v)
  const trimmed = preview.length > 48 ? preview.slice(0, 48) + '…' : preview
  return `${first}: ${trimmed}`
}

export function ActivityFeed() {
  const isStreaming = useChatStore((s) => s.isStreaming)
  const streamingContent = useChatStore((s) => s.streamingContent)
  const streamingReasoning = useChatStore((s) => s.streamingReasoning)
  const streamStartedAt = useChatStore((s) => s.streamStartedAt)
  const toolCalls = useChatStore((s) => s.toolCalls)
  const activeModel = useChatStore((s) => s.activeModel)

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isStreaming) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isStreaming])

  // Prefer the live reasoning channel; fall back to legacy inline <think>
  // parsing for any reasoner that streams thinking inside the body.
  const isReasoner = activeModel === 'deepseek-reasoner'
  const parsed = streamingReasoning
    ? { reasoning: streamingReasoning, body: streamingContent, isThinking: !streamingContent }
    : isReasoner
      ? parseReasoning(streamingContent)
      : { reasoning: null as string | null, body: streamingContent, isThinking: false }

  const elapsed = streamStartedAt ? formatElapsed(now - streamStartedAt) : null
  const reasoningChars = parsed.reasoning?.length ?? 0
  const bodyChars = parsed.body.length

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto pb-4 pl-4 pr-[28px] pt-4">
      {isStreaming && (
        <div className="rounded-lg border border-[var(--panel-border)] bg-[var(--bg-primary)] px-3 py-2">
          <div className="flex items-center justify-between text-[12px] text-[var(--text-muted)]">
            <span className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
              <span className="font-mono">
                {parsed.isThinking || (reasoningChars > 0 && bodyChars === 0)
                  ? 'thinking…'
                  : 'streaming…'}
              </span>
            </span>
            {elapsed && <span className="font-mono">{elapsed}</span>}
          </div>
          <div className="mt-1 flex items-center gap-3 text-[11px] text-[var(--text-secondary)]">
            {reasoningChars > 0 && <span>~{Math.round(reasoningChars / 4)} reasoning</span>}
            {bodyChars > 0 && <span>~{Math.round(bodyChars / 4)} reply</span>}
            {reasoningChars === 0 && bodyChars === 0 && <span>awaiting first token…</span>}
          </div>
        </div>
      )}

      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        Tool calls
      </div>

      {toolCalls.length === 0 ? (
        <p className="rounded border border-dashed border-[var(--panel-border)] px-3 py-3 text-center text-[12px] text-[var(--text-muted)]">
          No tools invoked yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {toolCalls.map((tc) => {
            const argSummary = summarizeArgs(tc.args)
            return (
              <li
                key={tc.callId}
                className="rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)] px-3 py-2"
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5">
                    <StatusDot status={tc.status} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-mono text-[12px] text-[var(--text-primary)]">
                        {tc.serverId}:{tc.toolName}
                      </span>
                      {tc.duration != null && (
                        <span className="font-mono text-[10px] text-[var(--text-muted)]">
                          {tc.duration}ms
                        </span>
                      )}
                    </div>
                    {argSummary && (
                      <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--text-muted)]">
                        {argSummary}
                      </div>
                    )}
                    {tc.status === 'error' && tc.result && (
                      <div className="mt-1 truncate text-[11px] text-[var(--error)]">
                        {tc.result}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
