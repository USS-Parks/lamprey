import type { PersistedStageMetric } from './stage-metrics-store'

// RT7 — pure exporter for the reasoning-trace audit trail. Two output
// formats:
//   - Markdown: one `## Turn N` heading per turn, then `### stage` subsections
//     with model / tokens / duration meta + fenced reasoning + fenced body.
//     Suitable for opening in any Markdown viewer; pasteable into a PR
//     description or an audit doc.
//   - CSV: one row per (turn, stage) for spreadsheet ingestion. Excerpts
//     are capped at 200 chars and re-escaped per RFC 4180 so commas, quotes,
//     and embedded newlines don't corrupt the row layout.
//
// Both functions are pure (no I/O); the IPC layer is responsible for the
// save-dialog + filesystem write.

// Local type for the input messages — duplicates the conversation-store
// `getMessages` return shape so the exporter compiles without importing the
// real type (it's not exported from the store module).
export interface TurnInput {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  model?: string
  timestamp: number
  reasoning?: string
  toolCalls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

// PersistedStageMetric is imported above; the type structure is already what
// `listStageMetrics` returns from RT2.
export type StageMetricInput = PersistedStageMetric

export interface ExportInput {
  conversationId: string
  conversationTitle?: string | null
  generatedAt: number
  turns: TurnInput[]
  /** Map keyed by message id → its stage metric rows. */
  stageMetrics: Record<string, StageMetricInput[]>
}

const CSV_EXCERPT_MAX = 200

function csvEscape(value: unknown): string {
  if (value == null) return ''
  const s = String(value)
  if (/[,"\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function excerpt(text: string | null | undefined): string {
  if (!text) return ''
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= CSV_EXCERPT_MAX) return flat
  return flat.slice(0, CSV_EXCERPT_MAX - 1) + '…'
}

function formatTs(ms: number): string {
  try {
    return new Date(ms).toISOString()
  } catch {
    return String(ms)
  }
}

/**
 * Build a Markdown report covering every turn + stage metric for the
 * conversation. Stable, deterministic output (no `Date.now()` calls; the
 * `generatedAt` field is provided by the caller).
 */
export function toMarkdown(input: ExportInput): string {
  const lines: string[] = []
  lines.push('# Lamprey Reasoning Trace')
  lines.push('')
  lines.push(`- Conversation: \`${input.conversationId}\``)
  if (input.conversationTitle) {
    lines.push(`- Title: ${input.conversationTitle}`)
  }
  lines.push(`- Generated: ${formatTs(input.generatedAt)}`)
  lines.push(`- Turns: ${input.turns.length}`)
  lines.push('')

  input.turns.forEach((turn, i) => {
    lines.push(`## Turn ${i + 1}`)
    lines.push('')
    lines.push(`- Role: \`${turn.role}\``)
    if (turn.model) lines.push(`- Model: \`${turn.model}\``)
    lines.push(`- Timestamp: ${formatTs(turn.timestamp)}`)

    const metrics = input.stageMetrics[turn.id] ?? []
    if (metrics.length > 0) {
      lines.push('')
      for (const m of metrics) {
        lines.push(`### Stage: ${m.stage}`)
        if (m.model) lines.push(`- **Model:** ${m.model}`)
        if (m.promptTokens != null || m.completionTokens != null) {
          lines.push(
            `- **Tokens:** ${m.promptTokens ?? '–'} in / ${m.completionTokens ?? '–'} out`
          )
        }
        if (m.durationMs != null) {
          lines.push(`- **Duration:** ${m.durationMs}ms`)
        }
        lines.push('')
      }
    }

    if (turn.reasoning && turn.reasoning.trim().length > 0) {
      lines.push('#### Reasoning')
      lines.push('```')
      lines.push(turn.reasoning)
      lines.push('```')
      lines.push('')
    }

    if (turn.content && turn.content.trim().length > 0) {
      lines.push('#### Content')
      lines.push('```')
      lines.push(turn.content)
      lines.push('```')
      lines.push('')
    }
  })

  // Trailing newline keeps shells + diff tools happy.
  return lines.join('\n') + '\n'
}

/**
 * Build a CSV file with one row per (turn × stage). Turns with no stage
 * metrics still emit a single synthetic row so the export is exhaustive.
 * Header columns: turn_index, stage, role, model, prompt_tokens,
 * completion_tokens, duration_ms, timestamp, content_excerpt,
 * reasoning_excerpt.
 */
export function toCsv(input: ExportInput): string {
  const header = [
    'turn_index',
    'stage',
    'role',
    'model',
    'prompt_tokens',
    'completion_tokens',
    'duration_ms',
    'timestamp',
    'content_excerpt',
    'reasoning_excerpt'
  ]
  const rows: string[] = [header.join(',')]

  input.turns.forEach((turn, i) => {
    const metrics = input.stageMetrics[turn.id] ?? []
    if (metrics.length === 0) {
      rows.push(
        [
          String(i),
          '',
          turn.role,
          turn.model ?? '',
          '',
          '',
          '',
          formatTs(turn.timestamp),
          excerpt(turn.content),
          excerpt(turn.reasoning)
        ]
          .map(csvEscape)
          .join(',')
      )
      return
    }
    for (const m of metrics) {
      rows.push(
        [
          String(i),
          m.stage,
          turn.role,
          m.model ?? turn.model ?? '',
          m.promptTokens != null ? String(m.promptTokens) : '',
          m.completionTokens != null ? String(m.completionTokens) : '',
          m.durationMs != null ? String(m.durationMs) : '',
          formatTs(turn.timestamp),
          excerpt(turn.content),
          excerpt(turn.reasoning)
        ]
          .map(csvEscape)
          .join(',')
      )
    }
  })

  return rows.join('\n') + '\n'
}

