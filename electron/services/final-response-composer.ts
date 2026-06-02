import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { buildComposerSystemPrompt } from './system-prompt-builder'
import type { LampreyToolCall } from './tool-registry'
import type { PlanSnapshot } from './plan-goal-store'

export type ComposerSkipReason = 'no-tool-rounds' | 'composer-failed'

export const COMPOSER_DRAFT_CAP = 8192
export const COMPOSER_TOOL_RESULT_CAP = 4096

export interface RunSummaryMessage {
  role: string
  content?: unknown
}

export interface RunSummaryToolCall {
  id: string
  toolId: string
  name: string
  status: 'PASS' | 'FAIL' | 'SKIPPED'
  statusDetail?: string
  resultPreview?: string
  error?: string
}

export interface RunSummary {
  userGoal: string
  plan?: {
    steps: Array<{ text: string; status: string }>
    totals?: Record<string, number>
  }
  toolCalls: RunSummaryToolCall[]
  draftReply: string
}

export interface ComposerRunnerInput {
  summary: RunSummary
  model: string
  signal?: AbortSignal
  runner: (
    messages: ChatCompletionMessageParam[],
    model: string,
    signal?: AbortSignal
  ) => Promise<string>
}

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: unknown }).text ?? '')
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (content == null) return ''
  return String(content)
}

export function truncateForComposer(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 24)) + '\n[truncated for composer]'
}

function auditStatus(call: LampreyToolCall): RunSummaryToolCall['status'] {
  if (call.status === 'done') return 'PASS'
  if (call.status === 'denied') return 'SKIPPED'
  return 'FAIL'
}

function auditStatusDetail(call: LampreyToolCall): string | undefined {
  if (call.status === 'denied') return 'denied'
  if (call.status === 'error') return 'error'
  return undefined
}

export function shouldComposeFinalResponse(round: number): boolean {
  return round > 0
}

export function summarizeRun(
  messages: RunSummaryMessage[],
  planSnapshot: PlanSnapshot | null | undefined,
  toolCalls: LampreyToolCall[],
  draftReply: string
): RunSummary {
  const userGoal =
    [...messages]
      .reverse()
      .find((m) => m.role === 'user')
      ?.content ?? ''

  const plan =
    planSnapshot && planSnapshot.steps.length > 0
      ? {
          steps: planSnapshot.steps.map((step) => ({
            text: step.text,
            status: step.status
          })),
          totals: planSnapshot.totals
        }
      : undefined

  return {
    userGoal: truncateForComposer(stringifyContent(userGoal), 4096),
    plan,
    toolCalls: toolCalls
      .slice()
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((call) => ({
        id: call.id,
        toolId: call.toolId,
        name: call.name,
        status: auditStatus(call),
        statusDetail: auditStatusDetail(call),
        resultPreview: call.result
          ? truncateForComposer(call.result, COMPOSER_TOOL_RESULT_CAP)
          : undefined,
        error: call.error
          ? truncateForComposer(call.error, COMPOSER_TOOL_RESULT_CAP)
          : undefined
      })),
    draftReply: truncateForComposer(draftReply, COMPOSER_DRAFT_CAP)
  }
}

export function buildComposerPrompt(summary: RunSummary): { system: string; user: string } {
  return {
    system: buildComposerSystemPrompt(),
    user: [
      '<run_summary>',
      `User goal:\n${summary.userGoal || '(not available)'}`,
      '',
      'Plan snapshot:',
      summary.plan ? JSON.stringify(summary.plan, null, 2) : '(no plan recorded)',
      '',
      'Tool audit summary:',
      summary.toolCalls.length > 0
        ? summary.toolCalls
            .map((call) => {
              const detail = call.statusDetail ? ` (${call.statusDetail})` : ''
              const body = call.error ?? call.resultPreview ?? ''
              return `- ${call.status}${detail}: ${call.name} [${call.id}]${body ? `\n  ${body}` : ''}`
            })
            .join('\n')
        : '(no tool calls recorded)',
      '',
      'Model draft reply:',
      summary.draftReply || '(empty draft)',
      '</run_summary>'
    ].join('\n')
  }
}

export async function composeFinalResponse({
  summary,
  model,
  signal,
  runner
}: ComposerRunnerInput): Promise<string> {
  const prompt = buildComposerPrompt(summary)
  const reply = await runner(
    [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user }
    ],
    model,
    signal
  )
  return reply.trim()
}
