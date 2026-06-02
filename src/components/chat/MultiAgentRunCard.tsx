import { useEffect, useMemo, useState } from 'react'
import type { ToolCallState } from '@/stores/chat-store'
import { formatElapsed } from '@/lib/tool-card-helpers'

// Renderer for `multi_agent_run` calls. Single compact card — collapsed view
// shows roles consulted and total elapsed; expanded view shows per-role
// output, error/timeout, elapsed, and an approximate token estimate.
// Inherits the same border + status semantics as ToolUseCard so the chat
// surface stays visually coherent. See electron/services/multi-agent-run-tool.ts
// for the result envelope.

interface SubAgentResult {
  role: string
  output: string | null
  error?: string
  elapsedMs: number
  tokensUsedEstimate?: number
  callId: string
}

interface MultiAgentRunResultShape {
  results: SubAgentResult[]
  totalElapsedMs: number
  synthesisNotes: string
}

interface MultiAgentRunCardProps {
  toolCall: ToolCallState
}

function parseRunResult(result: string | undefined): MultiAgentRunResultShape | null {
  if (!result) return null
  try {
    const parsed = JSON.parse(result) as unknown
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as MultiAgentRunResultShape).results)
    ) {
      return parsed as MultiAgentRunResultShape
    }
  } catch {
    // The backend produces JSON; a parse failure usually means the run
    // errored before it produced a result envelope — fall through to the
    // raw error rendering below.
  }
  return null
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

function previewLine(text: string | null | undefined): string {
  if (!text) return ''
  const stripped = text.replace(/\s+/g, ' ').trim()
  return stripped.length > 90 ? stripped.slice(0, 87) + '…' : stripped
}

export function MultiAgentRunCard({ toolCall }: MultiAgentRunCardProps) {
  const [expanded, setExpanded] = useState(false)
  const { status, args, result, duration, startedAt } = toolCall

  const isError = status === 'error'
  const isDenied = status === 'denied'
  const isRunning = status === 'pending' || status === 'running'

  const liveElapsed = useLiveElapsed(startedAt, isRunning)
  const elapsedLabel = isRunning
    ? liveElapsed ?? '…'
    : typeof duration === 'number'
      ? formatElapsed(duration)
      : null

  const parsed = useMemo(() => parseRunResult(result), [result])
  const requestedRoles = useMemo<string[]>(() => {
    const tasks = (args as Record<string, unknown>)?.tasks
    if (!Array.isArray(tasks)) return []
    const out: string[] = []
    for (const t of tasks) {
      if (t && typeof t === 'object' && typeof (t as { role?: unknown }).role === 'string') {
        out.push(String((t as { role: string }).role))
      }
    }
    return out
  }, [args])
  const observedRoles = parsed?.results.map((r) => r.role) ?? []
  const roles = observedRoles.length > 0 ? observedRoles : requestedRoles

  const summary = roles.length === 0
    ? 'Multi-agent run'
    : roles.length === 1
      ? `Consulted ${roles[0]}`
      : `Consulted ${roles.slice(0, -1).join(', ')} and ${roles[roles.length - 1]}`

  const borderClass = isError
    ? 'border-[var(--error)]/40'
    : isDenied
      ? 'border-[var(--text-muted)]/40'
      : 'border-[var(--border)]'

  return (
    <div className="my-2 mx-auto w-full max-w-[80%]">
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={
          'flex w-full items-start gap-2 rounded-lg border bg-[var(--bg-tertiary)] px-3 py-2 text-left transition-colors hover:bg-[var(--bg-secondary)] ' +
          borderClass
        }
      >
        <span className="mt-[2px] flex h-5 w-5 flex-none items-center justify-center rounded bg-[var(--accent-dim)] text-[12px] font-bold text-[var(--accent)]">
          M
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs font-medium text-[var(--text-primary)]">
              {summary}
            </span>
            <span className="truncate text-[11px] font-mono text-[var(--text-muted)]">
              · multi-agent
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-1 text-[11px] font-mono text-[var(--text-muted)]">
            {roles.map((r, i) => (
              <span
                key={`${r}-${i}`}
                className="rounded-full border border-[var(--border)] px-1.5 py-[1px] text-[10px] uppercase tracking-wider"
              >
                {r}
              </span>
            ))}
          </span>
        </span>
        {elapsedLabel && (
          <span className="flex-none text-[11px] font-mono text-[var(--text-muted)]">
            {elapsedLabel}
          </span>
        )}
        <span className="flex-none">
          {isRunning ? (
            <span
              className="inline-block h-3 w-3 animate-pulse rounded-full bg-[var(--accent)]"
              aria-label="running"
            />
          ) : isError ? (
            <span className="text-[var(--error)]" aria-label="error">
              &#10005;
            </span>
          ) : isDenied ? (
            <span className="text-[var(--text-muted)]" aria-label="denied">
              ⊘
            </span>
          ) : (
            <span className="text-[var(--success)]" aria-label="success">
              &#10003;
            </span>
          )}
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
          {!parsed && (
            <pre
              className={
                'max-h-64 overflow-auto whitespace-pre-wrap break-words text-[12px] font-mono ' +
                (isError ? 'text-[var(--error)]' : 'text-[var(--text-secondary)]')
              }
            >
              {result || (isDenied ? 'Denied by user.' : 'Run did not produce a result envelope.')}
            </pre>
          )}
          {parsed && (
            <>
              <div className="mb-2 text-[11px] font-mono text-[var(--text-muted)]">
                Total elapsed: {formatElapsed(parsed.totalElapsedMs)} · {parsed.results.length}{' '}
                sub-agent(s)
              </div>
              <div className="mb-2 text-[11px] italic text-[var(--text-muted)]">
                {parsed.synthesisNotes}
              </div>
              <div className="flex flex-col gap-2">
                {parsed.results.map((r) => {
                  const erred = !!r.error
                  return (
                    <div
                      key={r.callId}
                      className={
                        'rounded border bg-[var(--bg-tertiary)] px-3 py-2 ' +
                        (erred ? 'border-[var(--error)]/40' : 'border-[var(--border)]')
                      }
                    >
                      <div className="mb-1 flex items-center gap-2 text-[11px] font-mono">
                        <span className="rounded-full border border-[var(--border)] px-1.5 py-[1px] text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
                          {r.role}
                        </span>
                        <span className="text-[var(--text-muted)]">{formatElapsed(r.elapsedMs)}</span>
                        {typeof r.tokensUsedEstimate === 'number' && r.tokensUsedEstimate > 0 && (
                          <span className="text-[var(--text-muted)]">
                            ≈{r.tokensUsedEstimate}t
                          </span>
                        )}
                        {erred && (
                          <span className="rounded-full border border-[var(--error)]/40 px-1.5 py-[1px] text-[10px] text-[var(--error)]">
                            {r.error}
                          </span>
                        )}
                      </div>
                      {!erred && r.output && (
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-[12px] font-mono text-[var(--text-secondary)]">
                          {r.output}
                        </pre>
                      )}
                      {!erred && !r.output && (
                        <div className="text-[11px] italic text-[var(--text-muted)]">
                          (empty output)
                        </div>
                      )}
                      {erred && (
                        <div className="text-[11px] text-[var(--text-muted)]">
                          {previewLine(r.output ?? '')}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
