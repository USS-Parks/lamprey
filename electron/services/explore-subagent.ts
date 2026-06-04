import type {
  ChatCompletionMessageParam,
  ChatCompletionTool
} from 'openai/resources/chat/completions'
import { chatStream } from './providers/registry'
import { toolRegistry } from './tool-registry'
import { recordEvent } from './event-log'

// Explore subagent — Claude-Code-style research isolation. The parent
// conversation calls the `explore` tool with a question; this module spawns
// a tightly-constrained sub-conversation (separate context, separate model
// invocations, no apply_patch / no shell / no MCP) that uses ONLY the
// read-only workspace tools to investigate, and returns a single summary
// string. The parent never sees the subagent's intermediate tool calls or
// scratch context — that's the point.
//
// Why not nest the full chat IPC pipeline:
//   The parent's chat handler streams to the renderer, persists messages to
//   SQLite, attaches RAG context, runs the composer, and audits everything
//   through the event spine. A subagent that did all that would tangle two
//   conversations into the same persistence layer. This module instead runs
//   a minimal model-and-tools loop and emits its own subagent.* events so
//   the Activity Timeline can reconstruct what the subagent did without
//   conflating it with the parent's chat history.

export interface ExploreArgs {
  question: string
  scope?: 'docs' | 'code' | 'both'
  max_steps?: number
}

export interface ExploreResult {
  answer: string
  steps: number
  toolCalls: number
  durationMs: number
  hitMaxSteps: boolean
}

export interface ExploreDeps {
  /** Model id the subagent should use. Defaults to the parent's model.
   *  Settings → "Cheaper subagent" toggle could swap this in later. */
  modelId: string
  /** Active workspace root, threaded into tool execution context. */
  workspacePath?: string
  /** Optional correlation id for the parent run; emitted on subagent events
   *  so timeline can group the subagent with its parent turn. */
  correlationId?: string
  /** Cancellation. The parent's AbortController flows through here so a
   *  cancelled parent turn aborts an in-flight subagent. */
  signal?: AbortSignal
}

const DEFAULT_MAX_STEPS = 10
const HARD_MAX_STEPS = 25
const FINAL_RESPONSE_BYTE_CAP = 64 * 1024
const TOOL_RESULT_BYTE_CAP = 32 * 1024

// Tool names the subagent may call. Locked to read-only workspace probes
// plus rag:query:run-equivalent (we don't expose the IPC name; the tool
// surface is the same as the parent's read_file/grep_workspace/glob_workspace
// + a future rag_query native). Any tool added in the future must be
// EXPLICITLY added here — the default is denial.
const SUBAGENT_TOOL_NAMES: ReadonlySet<string> = new Set([
  'read_file',
  'grep_workspace',
  'glob_workspace',
  'workspace_context'
])

export function buildExploreSystemPrompt(scope: 'docs' | 'code' | 'both'): string {
  const scopeLine =
    scope === 'docs'
      ? 'Scope: attached documents only. Cite by document name and the relevant section heading.'
      : scope === 'code'
        ? 'Scope: workspace code only. Cite by file path and line number.'
        : 'Scope: both attached documents and workspace code. Cite documents by name+heading and code by file:line.'
  return [
    'You are the Explore subagent. The parent conversation gave you a question. Your job is to investigate using the workspace tools and return ONE concise answer with citations — nothing else.',
    '',
    scopeLine,
    '',
    'Available tools (read-only):',
    '- glob_workspace(pattern): discover files matching a glob, sorted by mtime',
    '- grep_workspace(pattern, ...): structured ripgrep search',
    '- read_file(path, offset, limit): paginated file reader',
    '- workspace_context(): one-shot workspace summary (git/package/frameworks)',
    '',
    'Rules:',
    '- No edits, no shell commands, no apply_patch — you have read access only.',
    '- Plan briefly, then start exploring. Glob to scope, grep to locate, read to confirm.',
    '- Quote findings by file:line so the parent can re-verify.',
    '- Return ONE final answer, not a transcript. The parent never sees your intermediate tool calls.',
    '- If the question is genuinely unanswerable from the available material, say so explicitly with what you searched and what was missing.',
    '- Keep the answer under ~500 words; the parent will integrate it into a larger response.'
  ].join('\n')
}

/**
 * Build the OpenAI tool list filtered to the subagent's allowed set. We
 * pull from the live toolRegistry so the descriptors stay in lockstep with
 * the parent's tool surface (no duplicated schemas to drift).
 */
export function buildSubagentTools(): ChatCompletionTool[] {
  return toolRegistry
    .getOpenAITools()
    .filter((t) => {
      // Discriminate the ChatCompletionTool union — the openai SDK 6.x
      // added ChatCompletionCustomTool (no `.function` field). Our registry
      // only emits `type: 'function'`, but TS sees the union.
      if (t.type !== 'function') return false
      return SUBAGENT_TOOL_NAMES.has(t.function.name)
    })
}

/**
 * Truncate a tool result string for inclusion in the subagent's context.
 * Each tool already has its own byte cap (read_file 256 KB, grep_workspace
 * 250 KB, glob_workspace 1000 paths). This is a defense-in-depth cap that
 * keeps a misbehaving tool from blowing the subagent's context window.
 */
function capToolResult(s: string): string {
  if (Buffer.byteLength(s, 'utf8') <= TOOL_RESULT_BYTE_CAP) return s
  return s.slice(0, TOOL_RESULT_BYTE_CAP) + '\n[tool result truncated]'
}

/**
 * Drive the subagent loop. Returns the final assistant text plus stats.
 * Throws on hard failures (model unavailable, abort). On hitting max_steps
 * returns whatever content the last assistant turn produced, marked with
 * `hitMaxSteps: true`.
 */
export async function runExplore(
  args: ExploreArgs,
  deps: ExploreDeps
): Promise<ExploreResult> {
  if (!args || typeof args.question !== 'string' || args.question.trim() === '') {
    throw new Error('explore: question is required')
  }
  const startedAt = Date.now()
  const scope = args.scope ?? 'both'
  const maxSteps = Math.min(
    typeof args.max_steps === 'number' && args.max_steps > 0
      ? Math.floor(args.max_steps)
      : DEFAULT_MAX_STEPS,
    HARD_MAX_STEPS
  )

  const tools = buildSubagentTools()

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: buildExploreSystemPrompt(scope) },
    {
      role: 'user',
      content: `Investigate and answer: ${args.question.trim()}`
    }
  ]

  emitSubagentEvent('subagent.started', deps.correlationId, {
    questionPreview: args.question.slice(0, 200),
    scope,
    maxSteps,
    toolCount: tools.length,
    modelId: deps.modelId
  })

  let totalToolCalls = 0
  let step = 0
  let lastContent = ''

  for (; step < maxSteps; step++) {
    if (deps.signal?.aborted) {
      emitSubagentEvent('subagent.failed', deps.correlationId, {
        reason: 'cancelled',
        step,
        durationMs: Date.now() - startedAt
      })
      throw new Error('explore: cancelled')
    }

    let content = ''
    let toolCalls:
      | Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
      | undefined
    let streamError: string | undefined

    await chatStream(
      messages,
      deps.modelId,
      tools,
      {
        onChunk: () => {
          /* subagent doesn't stream to UI; the parent already does */
        },
        onDone: (fullContent, tcs) => {
          content = fullContent
          if (tcs && tcs.length > 0) {
            toolCalls = tcs.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.function.name, arguments: tc.function.arguments }
            }))
          }
        },
        onError: (msg) => {
          streamError = msg
        }
      },
      deps.signal
    )

    if (streamError) {
      emitSubagentEvent('subagent.failed', deps.correlationId, {
        reason: streamError,
        step,
        durationMs: Date.now() - startedAt
      })
      throw new Error(`explore: model error: ${streamError}`)
    }

    lastContent = content

    if (!toolCalls || toolCalls.length === 0) {
      // Terminal: model returned an answer with no tool calls.
      const finalAnswer = lastContent.slice(0, FINAL_RESPONSE_BYTE_CAP)
      emitSubagentEvent('subagent.completed', deps.correlationId, {
        step: step + 1,
        toolCalls: totalToolCalls,
        durationMs: Date.now() - startedAt,
        answerPreview: finalAnswer.slice(0, 200)
      })
      return {
        answer: finalAnswer,
        steps: step + 1,
        toolCalls: totalToolCalls,
        durationMs: Date.now() - startedAt,
        hitMaxSteps: false
      }
    }

    // Append the assistant turn (with tool_calls) and then a tool message
    // for each call. Even if the model produced no `content`, we still need
    // the assistant message to carry the tool_calls forward.
    messages.push({
      role: 'assistant',
      content: content || null,
      tool_calls: toolCalls
    } as ChatCompletionMessageParam)

    for (const call of toolCalls) {
      totalToolCalls++
      if (!SUBAGENT_TOOL_NAMES.has(call.function.name)) {
        // Defense in depth: tool list is already filtered, but if the model
        // somehow emits a banned name we refuse rather than execute it.
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: `tool "${call.function.name}" is not available to the subagent`
        })
        continue
      }
      let parsedArgs: Record<string, unknown>
      try {
        parsedArgs = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>
      } catch (err) {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: `tool args were not valid JSON: ${(err as Error).message}`
        })
        continue
      }
      try {
        const result = await toolRegistry.executeNative(call.function.name, parsedArgs, {
          workspacePath: deps.workspacePath,
          conversationId: undefined
        })
        // NativeToolHandlerResult is `string | { result, status }` — unwrap.
        const text = typeof result === 'string' ? result : (result.result || '')
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: capToolResult(text)
        })
      } catch (err) {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: `tool failed: ${(err as Error).message}`
        })
      }
    }
  }

  // Loop exhausted without a no-tool-calls terminal turn. Return whatever
  // the last assistant content was, marked hitMaxSteps: true so the caller
  // can surface "narrow the question" guidance.
  const finalAnswer = lastContent.slice(0, FINAL_RESPONSE_BYTE_CAP)
  emitSubagentEvent('subagent.completed', deps.correlationId, {
    step,
    toolCalls: totalToolCalls,
    durationMs: Date.now() - startedAt,
    hitMaxSteps: true,
    answerPreview: finalAnswer.slice(0, 200)
  })
  return {
    answer:
      finalAnswer ||
      `[explore subagent hit max_steps=${maxSteps} without producing a final answer; the question may need narrowing]`,
    steps: step,
    toolCalls: totalToolCalls,
    durationMs: Date.now() - startedAt,
    hitMaxSteps: true
  }
}

function emitSubagentEvent(
  type: 'subagent.started' | 'subagent.completed' | 'subagent.failed',
  correlationId: string | undefined,
  payload: Record<string, unknown>
): void {
  try {
    recordEvent({
      type,
      actorKind: 'agent',
      severity: type === 'subagent.failed' ? 'error' : 'info',
      correlationId,
      entityKind: 'subagent-run',
      payload
    })
  } catch (err) {
    console.error(`[explore] ${type} event failed:`, err)
  }
}
