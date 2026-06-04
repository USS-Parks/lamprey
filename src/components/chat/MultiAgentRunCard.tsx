import { useMemo } from 'react'
import type { ToolCallState } from '@/stores/chat-store'
import { AgentRunInlineGroup, type InlineAgentRow } from './AgentRunInlineGroup'

// Renderer for `multi_agent_run` tool calls. Post-J7, this is a thin
// adapter that parses the run result envelope into InlineAgentRow shape
// and hands off to AgentRunInlineGroup for the nested-chevron rendering.
// See electron/services/multi-agent-run-tool.ts for the envelope shape.

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

export function MultiAgentRunCard({ toolCall }: MultiAgentRunCardProps) {
  const { status, args, result, duration } = toolCall

  const isRunning = status === 'pending' || status === 'running'

  const parsed = useMemo(() => parseRunResult(result), [result])

  // Requested roles from the tool args — used as the row skeleton while
  // the run is still in flight (no result envelope yet).
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

  const rows: InlineAgentRow[] = parsed
    ? parsed.results.map((r) => ({
        id: r.callId,
        role: r.role,
        status: r.error ? 'error' : 'done',
        elapsedMs: r.elapsedMs,
        tokensEstimate: r.tokensUsedEstimate,
        output: r.output ?? undefined,
        error: r.error
      }))
    : requestedRoles.map((role) => ({
        id: `pending-${role}`,
        role,
        status: isRunning ? 'running' : 'pending'
      }))

  return (
    <AgentRunInlineGroup
      headerLabel="Multi-agent run"
      totalElapsedMs={parsed?.totalElapsedMs ?? duration}
      synthesisNotes={parsed?.synthesisNotes}
      rows={rows}
      isRunning={isRunning}
    />
  )
}
