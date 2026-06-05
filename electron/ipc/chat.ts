import { ipcMain, app } from 'electron'
import { randomUUID } from 'crypto'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import {
  chatOnce,
  chatStream,
  resolveModel,
  type ModelRequestAudit
} from '../services/providers/registry'
import { boundedJsonPreview, recordEvent } from '../services/event-log'
import { validateChatSendRequest } from './chat-validation'
import * as convStore from '../services/conversation-store'
import {
  isPlanModeActive,
  setPlanModeActive,
  type StoredDocument
} from '../services/conversation-store'
import * as memStore from '../services/memory-store'
import { createChapter } from '../services/chapters-store'
import {
  compressOldestMessages,
  getEffectiveMessages
} from '../services/context-compressor'
import {
  buildTaskNotificationsBlock,
  drainAsyncEventsForPrompt
} from '../services/async-event-bridge'
import { buildSystemPrompt } from '../services/system-prompt-builder'
import { resolveAgentDispatch, runAgentPipeline } from '../services/agent-pipeline'
import { readAgentsMd } from '../services/agents-md-loader'
import { fireHooks } from '../services/hooks-runner'
import { mcpManager } from '../services/mcp-manager'
import { listSkills, getSkillContent } from '../services/skill-loader'
import { buildApiMessagesFromStoredMessages } from '../services/chat-history'
import { toolRegistry, isMutatingDescriptor } from '../services/tool-registry'
import {
  partitionToolCallWindows,
  type ProviderToolCall
} from '../services/tool-call-windowing'
import { permissionsService, descriptorNeedsApproval } from '../services/permissions-store'
import { inferPhaseFromDescriptor, type AgentRunPhase } from '../services/agent-run-phase'
import { getActiveWorkspace } from '../services/workspace-state'
import { classifyToolResult } from '../services/tool-result-status'
import { dispatchNativeTool } from '../services/native-dispatch'
import { emitChatEvent } from '../services/chat-events'
import {
  composeFinalResponse,
  shouldComposeFinalResponse,
  summarizeRun
} from '../services/final-response-composer'
import { getPlanSnapshot } from '../services/plan-goal-store'
import { getAskUserRuntime } from '../services/ask-user-runtime'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'

interface ModelParams {
  temperature?: number
  topP?: number
  maxTokens?: number | null
}

type AgenticComposerMode = 'auto' | 'always' | 'never'

interface AgenticCodingConfig {
  mode: boolean
  skills: string[]
  composer: AgenticComposerMode
}

function readSettingsJson(): Record<string, unknown> | null {
  try {
    const path = join(app.getPath('userData'), 'settings.json')
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function loadModelConfig(
  raw: Record<string, unknown> | null,
  model: string
): { params: ModelParams; systemPromptOverride?: string } {
  if (!raw) return { params: {} }
  const cfg = (raw.modelConfig as Record<string, Record<string, unknown>> | undefined)?.[model]
  if (!cfg) return { params: {} }
  return {
    params: {
      temperature: typeof cfg.temperature === 'number' ? cfg.temperature : undefined,
      topP: typeof cfg.topP === 'number' ? cfg.topP : undefined,
      maxTokens:
        typeof cfg.maxTokens === 'number'
          ? cfg.maxTokens
          : cfg.maxTokens === null
          ? null
          : undefined
    },
    systemPromptOverride:
      typeof cfg.systemPromptOverride === 'string' ? cfg.systemPromptOverride : undefined
  }
}

const DEFAULT_AGENTIC_SKILLS = ['codex-plan', 'codex-context', 'codex-verify'] as const

function loadAgenticCodingConfig(raw: Record<string, unknown> | null): AgenticCodingConfig {
  const off: AgenticCodingConfig = {
    mode: false,
    skills: [...DEFAULT_AGENTIC_SKILLS],
    composer: 'auto'
  }
  if (!raw) return off
  const mode = raw.agenticCodingMode === true
  const rawSkills = Array.isArray(raw.agenticCodingSkills)
    ? (raw.agenticCodingSkills as unknown[]).filter((s): s is string => typeof s === 'string')
    : [...DEFAULT_AGENTIC_SKILLS]
  const composerRaw = raw.agenticCodingComposer
  const composer: AgenticComposerMode =
    composerRaw === 'always' || composerRaw === 'never' ? composerRaw : 'auto'
  return { mode, skills: rawSkills, composer }
}

// Idempotent union: preserves order of `base`, then appends ids from `extra`
// that aren't already present. Used to merge auto-activated agentic skills
// into the request's activeSkillIds without duplicating user-picked entries.
export function mergeAgenticSkillIds(base: string[], extra: string[]): string[] {
  const seen = new Set(base)
  const out = [...base]
  for (const id of extra) {
    if (id && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

// Composer gate honoring agentic coding settings. 'auto' keeps the
// pre-Prompt-14 behavior (compose only when at least one tool round ran);
// 'always' composes on pure-chat turns too; 'never' skips entirely.
export function resolveComposerGate(mode: AgenticComposerMode, round: number): boolean {
  if (mode === 'never') return false
  if (mode === 'always') return true
  return shouldComposeFinalResponse(round)
}

// A chat turn's runtime context. `chat:send` opens the entry, `chat:cancel`
// reads it to find the correlationId for the chat.cancelled event, and the
// catch in chat:send tears it down. The correlationId is generated here and
// threaded through every downstream producer.
interface ActiveRun {
  controller: AbortController
  correlationId: string
  startedAt: number
}
const activeAbortControllers = new Map<string, ActiveRun>()

// Documents the model emits via `create_document` during a single chat:send
// turn. Keyed by correlationId so the buffer is stable across the recursive
// runChatRound calls and isolated between concurrent turns (parallel agent
// pipeline). The final-message branch in runChatRound drains the buffer when
// it persists the assistant row; the catch block in chat:send clears it on
// failure so a partial run does not leak into the next turn.
const pendingDocuments = new Map<string, StoredDocument[]>()

const CREATE_DOCUMENT_MAX_BYTES = 256 * 1024

function pushPendingDocument(correlationId: string | undefined, doc: StoredDocument): void {
  if (!correlationId) return
  const list = pendingDocuments.get(correlationId)
  if (list) {
    list.push(doc)
  } else {
    pendingDocuments.set(correlationId, [doc])
  }
}

function drainPendingDocuments(correlationId: string | undefined): StoredDocument[] | undefined {
  if (!correlationId) return undefined
  const list = pendingDocuments.get(correlationId)
  if (!list || list.length === 0) {
    pendingDocuments.delete(correlationId)
    return undefined
  }
  pendingDocuments.delete(correlationId)
  return list
}

// Tool definitions (memory_add + MCP tools) come from toolRegistry.
// Approval gating is owned by permissionsService — both live in services/.

// Per-stage tool-call iteration ceiling. Each runChatRound recursive call
// increments `round`; we hard-stop when the counter exceeds this. The cap
// is PER-STAGE (multi-agent pipelines reset the counter at each Planner
// / Coder / Reviewer hand-off), not per-turn — so the effective ceiling
// across a pipeline run is ~3× this number.
//
// Was 10 in 0.2.x — that tripped on routine codebase exploration where
// the planner needed 12-20 sequential reads to map a new repo. Codex
// and Claude Code allow 100+ rounds per agent loop; 50 is a generous
// midpoint that lets real work finish without going unbounded.
const MAX_TOOL_ROUNDS = 50

function emitPhase(conversationId: string, phase: AgentRunPhase): void {
  emitChatEvent('chat:phase', { conversationId, phase })
}

export function registerChatHandlers(): void {
  ipcMain.handle('chat:send', async (_event, request) => {
    // Defensive: the renderer is trusted but a malformed payload (hot
    // reload race, programmatic caller, future SDK consumer) must not
    // crash the handler. Validate the shape before doing anything.
    const validation = validateChatSendRequest(request)
    if (!validation.ok) {
      return { success: false, error: validation.error }
    }
    const { content, model, activeSkillIds, requestedAgentMode } = validation.value
    let conversationId = validation.value.conversationId

    // Hoisted so the catch block can reference it when an exception fires
    // before the regular `activeAbortControllers.set` runs. Generated here
    // (rather than after that .set) so the chat.error event always carries a
    // correlationId, even when the user typed into a conversation that
    // failed to materialise.
    const correlationId = randomUUID()

    try {
      if (conversationId === 'new' || !conversationId) {
        const conv = convStore.createConversation(model)
        conversationId = conv.id
      }

      convStore.saveMessage({
        id: randomUUID(),
        conversationId,
        role: 'user',
        content,
        model
      })

      emitPhase(conversationId, 'understanding')

      void fireHooks('promptSubmit', { conversationId, promptBody: content })

      // Track 2 / E5 — auto context compression. Run BEFORE pulling
      // history so the next turn's prompt sees the compressed view.
      // The model's context window comes from the catalogue entry; an
      // unknown model defaults to a conservative 128k cap. The compressor
      // is a pure-SQL operation (no LLM call in v1), so the latency is
      // negligible.
      try {
        const modelInfo = resolveModel(model)
        const ctxWindow = modelInfo.contextWindow ?? 128_000
        const r = compressOldestMessages(conversationId, ctxWindow)
        if (r) {
          emitChatEvent('chat:compressed', {
            conversationId,
            summaryMessageId: r.summaryMessageId,
            compressedCount: r.compressedCount,
            reductionPct: r.reductionPct
          })
        }
      } catch (err) {
        console.error('[chat] context compression failed:', err)
      }

      const allMessages = convStore.getMessages(conversationId)
      // The dispatcher uses the effective view (compressed messages
      // hidden, summary inserted in their place) for the OpenAI API.
      const promptHistory = getEffectiveMessages(conversationId)
      const memoryBlock = memStore.buildMemoryBlock()
      // D2: always-loaded `<memory_index>` block built from MEMORY.md.
      // Returns '' when the project has no entries, in which case
      // buildSystemPrompt drops the block entirely.
      const memoryIndexBlock = memStore.buildMemoryIndexBlock()
      const taskNotificationsBlock = buildTaskNotificationsBlock(
        drainAsyncEventsForPrompt(conversationId)
      )

      const settingsRaw = readSettingsJson()
      const agentic = loadAgenticCodingConfig(settingsRaw)

      // Auto-merge the configured agentic-coding skill ids into the round's
      // active set when mode is on. mergeAgenticSkillIds dedupes against the
      // user's existing picks so toggling the same skill from the panel
      // doesn't double-inject its content.
      // activeSkillIds was already validated + filtered at the handler entry.
      const effectiveSkillIds = agentic.mode
        ? mergeAgenticSkillIds(activeSkillIds, agentic.skills)
        : activeSkillIds

      let skillContents: { name: string; content: string }[] = []
      if (effectiveSkillIds.length > 0) {
        const skills = listSkills()
        skillContents = effectiveSkillIds
          .map((id: string) => {
            const skill = skills.find((s) => s.id === id)
            if (!skill) return null
            const content = getSkillContent(id)
            return content ? { name: skill.name, content } : null
          })
          .filter(Boolean) as { name: string; content: string }[]
      }

      const { params: modelParams, systemPromptOverride } = loadModelConfig(settingsRaw, model)
      const activeWorkspace = getActiveWorkspace()
      const agentsMd = readAgentsMd(activeWorkspace)
      const systemPrompt = buildSystemPrompt(
        skillContents,
        memoryBlock,
        systemPromptOverride,
        agentsMd,
        model,
        // When mode is on, layer the coding role fragment on top of the base
        // contract. When off, leave contractRole undefined so existing turn
        // shapes match pre-Prompt-14.
        agentic.mode ? 'coding' : undefined,
        memoryIndexBlock,
        taskNotificationsBlock
      )

      // Tools come from the unified registry — natives (memory_add today) plus
      // all currently-connected MCP server tools, with stable descriptors and
      // OpenAI-compatible function schemas.
      const tools: ChatCompletionTool[] = toolRegistry.getOpenAITools()

      const apiMessages = buildApiMessagesFromStoredMessages(systemPrompt, promptHistory)

      const abortController = new AbortController()
      // Stash the abort controller + the correlationId generated above so
      // chat:cancel can find them. Every downstream producer takes this id so
      // the whole run is one row-group in the event log. Pre-Prompt-3 events
      // landed without one.
      activeAbortControllers.set(conversationId, {
        controller: abortController,
        correlationId,
        startedAt: Date.now()
      })

      // Workspace pinned at the start of the round so the in-flight tool
      // loop sees one consistent cwd even if the user retargets the folder
      // chip mid-stream.
      const workspacePath = activeWorkspace

      // Prompt 11: agentMode dispatch. The single-mode path below is
      // byte-for-byte unchanged from pre-Prompt-11. Multi mode routes
      // through `runAgentPipeline` with the validated roster. A bad
      // roster falls back to single mode so the user isn't left without
      // a reply. The whole decision tree lives in `resolveAgentDispatch`
      // so the chat:send wiring is testable in isolation.
      const dispatch = resolveAgentDispatch(settingsRaw)
      void requestedAgentMode

      if (dispatch.kind === 'multi') {
        // P11 review-P1: the Coder must execute with ITS OWN model's
        // identity, system-prompt override, and modelConfig params —
        // not the request model's. The outer `systemPrompt` and
        // `modelParams` were derived from `model` (the active model the
        // user selected for the conversation), which is the Coder model
        // ONLY when single-mode would have been used. In multi mode we
        // build a Coder-specific system prompt with contractRole='coding'
        // (always, regardless of `agenticCodingMode` — the pipeline IS
        // the coding-mode wrapper at this layer) and a Coder-specific
        // params block.
        const coderRoster = dispatch.roster
        const { params: coderModelParams, systemPromptOverride: coderSystemOverride } =
          loadModelConfig(settingsRaw, coderRoster.coder)
        const coderSystemPrompt = buildSystemPrompt(
          skillContents,
          memoryBlock,
          coderSystemOverride,
          agentsMd,
          coderRoster.coder,
          'coding',
          memoryIndexBlock,
          taskNotificationsBlock
        )
        const priorWithoutLatestUser = apiMessages.filter(
          (m, idx) => idx !== 0 // drop the system entry; pipeline owns it
        )
        // Drop the most recent user turn from the prior list — pipeline
        // injects its own rewritten user message that carries the plan.
        // The latest user is whatever we just saved; locate by trailing
        // role==='user'.
        const lastUserIdx = priorWithoutLatestUser
          .map((m, i) => (m.role === 'user' ? i : -1))
          .filter((i) => i >= 0)
          .pop()
        const priorTrimmed =
          lastUserIdx === undefined
            ? priorWithoutLatestUser
            : priorWithoutLatestUser.slice(0, lastUserIdx)

        await runAgentPipeline({
          conversationId,
          correlationId,
          roster: coderRoster,
          userContent: content,
          systemPrompt: coderSystemPrompt,
          priorMessages: priorTrimmed,
          tools: tools.length > 0 ? tools : undefined,
          workspacePath,
          signal: abortController.signal,
          subAgentRunner: async (subMessages, modelId, subSignal) => {
            // chatOnce takes (messages, modelId, signal); sub-agents are
            // one-shot reasoning calls — per-model temperature/topP from
            // modelConfig doesn't apply here.
            const text = await chatOnce(subMessages, modelId, subSignal, {
              correlationId,
              conversationId,
              purpose: 'sub-agent'
            })
            return typeof text === 'string' ? text : String(text)
          },
          coderRunner: async ({ messages, model: coderModel, tools: coderTools, signal: coderSignal }) =>
            runChatRound(
              conversationId,
              coderModel,
              messages,
              coderTools,
              workspacePath,
              coderSignal,
              0,
              coderModelParams,
              agentic.composer,
              /* suppressDoneEvent */ true,
              correlationId
            )
        })
      } else {
        if (dispatch.reason) {
          // Surface why the pipeline was bypassed; do NOT block the user's
          // reply. Falling through to single mode keeps the harness
          // useful while the roster is being corrected.
          console.warn(
            '[chat] agentMode=multi but roster invalid; falling back to single mode:',
            dispatch.reason
          )
        }
        await runChatRound(
          conversationId,
          model,
          apiMessages,
          tools.length > 0 ? tools : undefined,
          workspacePath,
          abortController.signal,
          0,
          modelParams,
          agentic.composer,
          /* suppressDoneEvent */ false,
          correlationId
        )
      }

      activeAbortControllers.delete(conversationId)
      drainPendingDocuments(correlationId)
      return { success: true, data: { conversationId } }
    } catch (err: any) {
      activeAbortControllers.delete(conversationId)
      drainPendingDocuments(correlationId)
      emitPhase(conversationId, 'error')
      emitChatEvent('chat:error', { conversationId, error: err.message })
      // Mirror into the event spine so the timeline reader sees the failure
      // alongside any model/tool/agent events that completed before the throw.
      try {
        recordEvent({
          type: 'chat.error',
          actorKind: 'system',
          severity: 'error',
          conversationId,
          correlationId,
          payload: {
            errorPreview: boundedJsonPreview(err?.message),
            errorClass: err?.name
          }
        })
      } catch (e) {
        console.error('[chat] chat.error event failed:', e)
      }
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('chat:cancel', async (_event, conversationId) => {
    const run = activeAbortControllers.get(conversationId)
    if (run) {
      run.controller.abort()
      activeAbortControllers.delete(conversationId)
      drainPendingDocuments(run.correlationId)
      try {
        recordEvent({
          type: 'chat.cancelled',
          actorKind: 'user',
          severity: 'warning',
          conversationId,
          correlationId: run.correlationId,
          payload: {
            cancelledAt: Date.now(),
            elapsedMs: Date.now() - run.startedAt
          }
        })
      } catch (err) {
        console.error('[chat] chat.cancelled event failed:', err)
      }
    }
    return { success: true, data: null }
  })

  ipcMain.handle('chat:generateTitle', async (_event, content: string) => {
    try {
      const raw = await chatOnce(
        [
          {
            role: 'system',
            content:
              'Generate a concise 3–5 word title for a conversation that begins with the user message below. Reply with ONLY the title — no quotes, no punctuation, no trailing period.'
          },
          { role: 'user', content }
        ],
        'deepseek-v4-flash'
      )
      const cleaned = raw.replace(/^["'\s]+|["'\s]+$/g, '').replace(/[.!?]+$/g, '').slice(0, 60)
      return { success: true, data: cleaned || content.slice(0, 40) }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'Title generation failed' }
    }
  })

  // mcp:approveToolCall used to live here because chat.ts owned the pending
  // confirmation promises. It now lives in electron/ipc/permissions.ts and
  // routes through permissionsService.
}

// Prompt 11: agent-pipeline mode needs to capture the Coder's final
// assistant message AND defer the chat:done emit until after the Reviewer
// stage has been queued (so the renderer doesn't clear the pipeline-banner
// in the gap between Coder-done and Reviewer-running). When
// `suppressDoneEvent` is true:
//   * runChatRound persists the assistant message as usual,
//   * BUT it does NOT emit `chat:phase = done` or `chat:done`,
//   * AND it resolves with the persisted message so the caller can emit
//     those events itself at the right moment.
// Single-mode callers pass `false` (the default) and ignore the return
// value; the byte-for-byte behaviour of the pre-Prompt-11 path is
// preserved.
export type RunChatRoundResult = { message: unknown } | null

export async function runChatRound(
  conversationId: string,
  model: string,
  messages: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[] | undefined,
  workspacePath: string,
  signal: AbortSignal,
  round: number,
  params?: ModelParams,
  composerMode: AgenticComposerMode = 'auto',
  suppressDoneEvent: boolean = false,
  correlationId?: string
): Promise<RunChatRoundResult> {
  if (round >= MAX_TOOL_ROUNDS) {
    emitPhase(conversationId, 'error')
    emitChatEvent('chat:error', {
      conversationId,
      // Tool calls completed in rounds 0..MAX_TOOL_ROUNDS-1 ARE persisted —
      // re-prompting with "continue" picks up where the model left off
      // because the history reflects the partial work.
      error: `Tool-call cap reached (${MAX_TOOL_ROUNDS} rounds this stage). Re-prompt with "continue" to keep going — the partial work is saved.`
    })
    return null
  }

  const descriptor = resolveModel(model)
  const effectiveTools = descriptor.supportsTools ? tools : undefined

  const audit: ModelRequestAudit | undefined = correlationId
    ? { correlationId, conversationId, purpose: 'main' }
    : undefined

  return new Promise<RunChatRoundResult>((resolve, reject) => {
    chatStream(
      messages,
      model,
      effectiveTools,
      {
        onChunk: (chunk) => {
          emitChatEvent('chat:chunk', { conversationId, content: chunk })
        },
        onReasoning: (chunk) => {
          emitChatEvent('chat:reasoning', { conversationId, content: chunk })
        },
        onDone: async (fullContent, toolCalls, fullReasoning) => {
          if (!toolCalls || toolCalls.length === 0) {
            let finalContent = fullContent
            let draft: string | undefined
            if (resolveComposerGate(composerMode, round)) {
              emitPhase(conversationId, 'summarizing')
              try {
                const summary = summarizeRun(
                  messages as any,
                  getPlanSnapshot(conversationId),
                  toolRegistry.getCallsForConversation(conversationId, 50),
                  fullContent
                )
                const composed = await composeFinalResponse({
                  summary,
                  model,
                  signal,
                  // chatOnce now takes an optional audit context; the composer
                  // passes it through transparently when callers supply one.
                  runner: (msgs, modelId, sig) =>
                    chatOnce(msgs, modelId, sig, audit && { ...audit, purpose: 'composer' })
                })
                if (composed) {
                  finalContent = composed
                  draft = fullContent
                }
              } catch (err) {
                console.warn('[chat] final response composer failed:', err)
                // The user still gets the original streamed `fullContent`;
                // the un-composed draft is the safe fallback. Record a
                // chat.error event so the Activity Timeline shows that the
                // composer pass didn't land, without disrupting the reply.
                if (correlationId) {
                  try {
                    recordEvent({
                      type: 'chat.error',
                      actorKind: 'system',
                      severity: 'warning',
                      conversationId,
                      correlationId,
                      payload: {
                        source: 'composer',
                        errorPreview: boundedJsonPreview(
                          (err as Error)?.message ?? String(err)
                        )
                      }
                    })
                  } catch (e) {
                    console.error('[chat] composer chat.error event failed:', e)
                  }
                }
              }
            }
            const documents = drainPendingDocuments(correlationId)
            const assistantMsg = convStore.saveMessage({
              id: randomUUID(),
              conversationId,
              role: 'assistant',
              content: finalContent,
              model,
              draft,
              reasoning: fullReasoning,
              documents
            })
            if (!suppressDoneEvent) {
              emitPhase(conversationId, 'done')
              emitChatEvent('chat:done', { conversationId, message: assistantMsg })
              void fireHooks('agentStop', { conversationId })
            }
            resolve({ message: assistantMsg })
            return
          }

          const persistedToolCalls = toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments }
          }))

          convStore.saveMessage({
            id: randomUUID(),
            conversationId,
            role: 'assistant',
            content: fullContent || '',
            model,
            toolCalls: persistedToolCalls,
            reasoning: fullReasoning
          })

          messages.push({
            role: 'assistant',
            content: fullContent || null,
            tool_calls: persistedToolCalls
          } as any)

          // Group the model's tool_calls into execution windows: contiguous
          // spans of parallelizable calls run via Promise.all; non-parallel
          // calls run one at a time. The final tool-role messages are pushed
          // in tool_call array order regardless of completion order so the
          // next API round sees a consistent sequence.
          const resolved: ResolvedToolCall[] = new Array(toolCalls.length)
          const windows = partitionToolCallWindows(toolCalls, (id) =>
            toolRegistry.getById(id)
          )
          for (const win of windows) {
            if (win.kind === 'parallel') {
              const settled = await Promise.all(
                win.indices.map((idx) =>
                  resolveSingleToolCall(
                    toolCalls[idx],
                    conversationId,
                    model,
                    workspacePath,
                    signal,
                    correlationId
                  )
                )
              )
              for (let i = 0; i < win.indices.length; i++) {
                resolved[win.indices[i]] = settled[i]
              }
            } else {
              resolved[win.index] = await resolveSingleToolCall(
                toolCalls[win.index],
                conversationId,
                model,
                workspacePath,
                signal,
                correlationId
              )
            }
          }

          for (const r of resolved) {
            convStore.saveMessage({
              id: randomUUID(),
              conversationId,
              role: 'tool',
              content: r.result,
              toolCallId: r.callId
            })
            messages.push({
              role: 'tool',
              content: r.result,
              tool_call_id: r.callId
            } as any)
          }

          try {
            const next = await runChatRound(
              conversationId,
              model,
              messages,
              tools,
              workspacePath,
              signal,
              round + 1,
              params,
              composerMode,
              suppressDoneEvent,
              correlationId
            )
            resolve(next)
          } catch (err) {
            reject(err)
          }
        },
        onError: (error, partial) => {
          // Permanently fix data loss on stream errors: if the provider
          // streamed body or reasoning before failing, persist it as an
          // assistant message instead of letting it evaporate. Without
          // this, every stream error silently discarded everything the
          // user already saw on screen — including thousands of tokens
          // of chain-of-thought from reasoning models.
          //
          // We emit `chat:done` FIRST with the persisted partial so the
          // renderer transitions the on-screen streaming buffers into a
          // durable message via finishStream (which adds it to the
          // messages array and clears the streaming state). Then we emit
          // `chat:error` so the failure still surfaces as a toast.
          const hasPartial = !!(
            partial && (partial.content || partial.reasoning)
          )
          if (hasPartial) {
            try {
              const documents = drainPendingDocuments(correlationId)
              const errorMarker = `\n\n_[stream interrupted: ${error}]_`
              const assistantMsg = convStore.saveMessage({
                id: randomUUID(),
                conversationId,
                role: 'assistant',
                content: (partial!.content || '') + errorMarker,
                model,
                reasoning: partial!.reasoning,
                documents
              })
              if (!suppressDoneEvent) {
                emitChatEvent('chat:done', {
                  conversationId,
                  message: assistantMsg
                })
              }
            } catch (e) {
              console.error('[chat] failed to persist partial on stream error:', e)
            }
          }

          emitPhase(conversationId, 'error')
          emitChatEvent('chat:error', { conversationId, error })
          // Mirror provider-side stream errors into the spine. `model.request.failed`
          // is already emitted from inside chatStream for the underlying API
          // failure; this `chat.error` row pins the orchestration-layer
          // outcome so the chat-turn timeline reads cleanly even when the
          // provider stream short-circuits before any tool round runs.
          if (correlationId) {
            try {
              recordEvent({
                type: 'chat.error',
                actorKind: 'system',
                severity: 'error',
                conversationId,
                correlationId,
                payload: {
                  errorPreview: boundedJsonPreview(error),
                  source: 'stream'
                }
              })
            } catch (e) {
              console.error('[chat] chat.error event failed:', e)
            }
          }
          reject(new Error(error))
        }
      },
      signal,
      params,
      audit
    )
  })
}

interface ResolvedToolCall {
  callId: string
  result: string
}

async function resolveSingleToolCall(
  tc: ProviderToolCall,
  conversationId: string,
  model: string,
  workspacePath: string,
  signal: AbortSignal,
  correlationId?: string
): Promise<ResolvedToolCall> {
  const toolName = tc.function.name
  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(tc.function.arguments)
  } catch {
    args = {}
  }

  const startTime = Date.now()

  const earlyDescriptor = toolRegistry.getById(toolName)
  emitChatEvent('chat:tool-call', {
    callId: tc.id,
    conversationId,
    serverId: toolName.includes('__') ? toolName.split('__')[0] : 'internal',
    toolName: toolName.includes('__') ? toolName.split('__').slice(1).join('__') : toolName,
    title: earlyDescriptor?.title ?? toolName,
    risks: earlyDescriptor?.risks ?? [],
    providerKind: earlyDescriptor?.providerKind ?? 'native',
    startedAt: startTime,
    args,
    transcriptHidden: earlyDescriptor?.transcriptHidden
  })

  toolRegistry.recordCallStart(
    {
      id: tc.id,
      toolId: toolName,
      name: toolName,
      conversationId,
      args,
      startedAt: startTime,
      status: 'running'
    },
    correlationId
  )

  let result: string
  let explicitStatus: 'done' | 'error' | 'denied' | undefined

  const descriptor = toolRegistry.getById(toolName)
  if (descriptor) {
    emitPhase(conversationId, inferPhaseFromDescriptor(descriptor))
  }

  // Track 2 / C3 — plan-mode gate. Block mutating tools without asking
  // for approval first: there is no point routing through the modal when
  // the mode already says no, and a global 'deny destructive' policy
  // shouldn't get to silently allow what plan-mode forbids. The
  // enter/exit tools opt out of the gate via `mutates: false` on the
  // descriptor, so the model can always flip the mode back off.
  const planModeActive = isPlanModeActive(conversationId)
  const blockedByPlanMode = planModeActive && isMutatingDescriptor(descriptor)

  const needsApproval = !blockedByPlanMode && descriptorNeedsApproval(descriptor)
  // S7 / S12 — shell_command + `dangerously_disable_sandbox: true` escalates
  // the approval flow: per-call risks gain `'sandboxBypass'`, any persisted
  // "always allow" is skipped, and the modal re-pops for every call. Other
  // tools do not honour the flag.
  const isDangerousShellBypass =
    toolName === 'shell_command' && args?.dangerously_disable_sandbox === true
  const callRisks = isDangerousShellBypass && descriptor
    ? [...descriptor.risks, 'sandboxBypass' as const]
    : descriptor?.risks
  const approvalOutcome =
    needsApproval && descriptor
      ? await permissionsService.requestApprovalDetailed({
          callId: tc.id,
          toolId: descriptor.id,
          name: descriptor.name,
          serverId: descriptor.providerId,
          providerKind: descriptor.providerKind,
          risks: callRisks ?? descriptor.risks,
          args,
          conversationId,
          correlationId,
          dangerous: isDangerousShellBypass ? true : undefined
        })
      : { decision: 'allow' as const, source: 'none' }
  const approvalDecision = approvalOutcome.decision
  const approvalSource = blockedByPlanMode ? 'plan-mode' : approvalOutcome.source

  if (blockedByPlanMode) {
    result =
      'Blocked: plan mode is active for this conversation. Read-only tools are still available; call `exit_plan_mode` (or have the user click "Exit plan mode" in the banner) to allow mutating tools.'
    explicitStatus = 'denied'
  } else if (approvalDecision === 'deny') {
    result = 'Action denied by user.'
    explicitStatus = 'denied'
  } else {
    // Track 2 / C2 — preToolUse hooks run after approval but before dispatch.
    // A throwing preToolUse hook BLOCKS the call: its message reaches the
    // model as the synthetic tool result and the audit row records 'denied'
    // with approvalSource left at the approval gate's value (the hook is
    // its own provenance). Hook errors are also surfaced as logs for the
    // UI's recent-runs view.
    const preHook = await fireHooks('preToolUse', {
      conversationId,
      toolName,
      args,
      cwd: workspacePath
    })
    if (preHook.blocked) {
      result = `Blocked by hook: ${preHook.blockReason ?? 'preToolUse refused'}`
      explicitStatus = 'denied'
    } else if (toolName === 'memory_add' && typeof args.content === 'string') {
      const entry = memStore.addMemory(args.content, conversationId)
      emitChatEvent('memory:added', entry)
      result = 'Saved to memory.'
    } else if (toolName === 'create_document') {
      const nameRaw = typeof args.name === 'string' ? args.name.trim() : ''
      const mimeRaw = typeof args.mimeType === 'string' ? args.mimeType.trim() : ''
      const contentRaw = typeof args.content === 'string' ? args.content : ''
      if (!nameRaw || !mimeRaw || !contentRaw) {
        result =
          'Error: create_document requires non-empty `name`, `mimeType`, and `content`.'
        explicitStatus = 'error'
      } else {
        const sizeBytes = Buffer.byteLength(contentRaw, 'utf8')
        if (sizeBytes > CREATE_DOCUMENT_MAX_BYTES) {
          result = `Error: create_document body exceeds ${CREATE_DOCUMENT_MAX_BYTES} bytes (got ${sizeBytes}). Split into multiple documents or shorten.`
          explicitStatus = 'error'
        } else {
          const doc: StoredDocument = {
            id: randomUUID(),
            name: nameRaw.slice(0, 200),
            mimeType: mimeRaw.slice(0, 120),
            content: contentRaw,
            sizeBytes,
            createdAt: Date.now()
          }
          pushPendingDocument(correlationId, doc)
          emitChatEvent('chat:document-created', { conversationId, document: doc })
          result = `Document "${doc.name}" (${doc.sizeBytes} bytes, ${doc.mimeType}) attached to this turn. Do NOT paste the body into your visible reply — the user already sees the card.`
        }
      }
    } else if (toolName === 'enter_plan_mode') {
      // Track 2 / C3 — inline because the handler emits a renderer event.
      // Persisted on the conversation row so it survives a restart.
      setPlanModeActive(conversationId, true)
      emitChatEvent('plan:mode-changed', { conversationId, active: true })
      result =
        'Plan mode is on. Mutating tools (apply_patch, shell_command, destructive MCP) are blocked until exit_plan_mode is called.'
    } else if (toolName === 'exit_plan_mode') {
      setPlanModeActive(conversationId, false)
      emitChatEvent('plan:mode-changed', { conversationId, active: false })
      result = 'Plan mode is off. Mutating tools are allowed again.'
    } else if (toolName === 'mark_chapter') {
      // Track 2 / E1 — anchor the chapter at the assistant turn that
      // produced the call. The anchor message id is not yet persisted at
      // this point in the dispatch loop (the post-tool assistant message
      // gets persisted after this returns), so we anchor on the existing
      // tool-call id — chat-history can map it back to its parent
      // assistant turn. The renderer treats the anchor as the boundary
      // marker; UI cosmetic, no behavioural dependency on exact mapping.
      const titleRaw =
        typeof args.title === 'string' ? args.title.trim() : ''
      const summaryRaw =
        typeof args.summary === 'string' ? args.summary.trim() : ''
      if (!titleRaw) {
        result = 'Error: mark_chapter requires a non-empty `title`.'
        explicitStatus = 'error'
      } else {
        const chapter = createChapter({
          conversationId,
          title: titleRaw.slice(0, 80),
          summary: summaryRaw ? summaryRaw.slice(0, 280) : null,
          anchorMessageId: tc.id
        })
        emitChatEvent('chat:chapter-marked', { conversationId, chapter })
        // Plan §2 invariant 10 — chapters also land on the event spine
        // for the audit timeline.
        try {
          recordEvent({
            type: 'chat.chapter.marked',
            actorKind: 'model',
            conversationId,
            correlationId,
            entityKind: 'chapter',
            entityId: chapter.id,
            payload: {
              title: chapter.title,
              summary: chapter.summary,
              anchorMessageId: chapter.anchorMessageId
            }
          })
        } catch (err) {
          console.error('[chat] chat.chapter.marked spine event failed:', err)
        }
        result = `Chapter marked: "${chapter.title}"`
      }
    } else if (toolName === 'ask_user_question') {
      // Integration / H6 — route through the singleton ask-user-runtime.
      // The handler returns the chosen option label (multi-select returns a
      // comma-separated list); a timeout returns the literal "(timed out)"
      // so the model can detect non-interactive contexts and proceed.
      const question = typeof args.question === 'string' ? args.question.trim() : ''
      const header = typeof args.header === 'string' ? args.header.trim() : ''
      const optionsRaw = Array.isArray(args.options) ? args.options : []
      const options: Array<{ label: string; description?: string; preview?: string }> = []
      for (const o of optionsRaw) {
        if (!o || typeof o !== 'object') continue
        const opt = o as Record<string, unknown>
        const label = typeof opt.label === 'string' ? opt.label.trim() : ''
        if (!label) continue
        const entry: { label: string; description?: string; preview?: string } = { label }
        if (typeof opt.description === 'string') entry.description = opt.description
        if (typeof opt.preview === 'string') entry.preview = opt.preview
        options.push(entry)
      }
      if (!question || !header || options.length < 2 || options.length > 4) {
        result =
          'Error: ask_user_question requires `question`, `header`, and 2-4 `options` with non-empty `label`s.'
        explicitStatus = 'error'
      } else {
        try {
          const runtime = getAskUserRuntime()
          if (!runtime) {
            throw new Error('ask-user runtime not initialised')
          }
          const answer = await runtime.ask({
            question,
            header,
            options,
            multiSelect: !!args.multiSelect,
            timeoutMs:
              typeof args.timeoutMs === 'number' && Number.isFinite(args.timeoutMs)
                ? args.timeoutMs
                : undefined
          })
          if (answer.kind === 'timeout') {
            result = '(timed out — user did not respond)'
          } else if (answer.kind === 'cancelled') {
            result = '(cancelled by user)'
          } else if (answer.kind === 'single') {
            result = answer.notes ? `${answer.label} — ${answer.notes}` : answer.label
          } else {
            const joined = answer.labels.join(', ')
            result = answer.notes ? `${joined} — ${answer.notes}` : joined
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          result = `Error: ${msg}`
          explicitStatus = 'error'
        }
      }
    } else if (toolRegistry.hasHandler(toolName)) {
      const dispatched = await dispatchNativeTool(() =>
        toolRegistry.executeNative(toolName, args, {
          conversationId,
          workspacePath,
          model,
          signal,
          callId: tc.id,
          correlationId
        })
      )
      result = dispatched.result
      explicitStatus = dispatched.status
      if (toolName === 'update_plan' && dispatched.status === 'done') {
        try {
          const snapshot = JSON.parse(result)
          emitChatEvent('plan:updated', { conversationId, snapshot })
        } catch {
          // Snapshot shape drifted — renderer refetches on the next
          // conversation switch.
        }
      }
    } else if (toolName.includes('__')) {
      const [serverId, ...nameParts] = toolName.split('__')
      const mcpToolName = nameParts.join('__')
      try {
        const mcpResult = await mcpManager.callTool(serverId, mcpToolName, args)
        result = typeof mcpResult === 'string' ? mcpResult : JSON.stringify(mcpResult)
      } catch (err: any) {
        result = `Error: ${err.message}`
      }
    } else {
      result = `Unknown tool: ${toolName}`
    }
  }

  // Track 2 / C2 — postToolUse fires after the handler completes (whether
  // it succeeded, failed, or was denied by approval/hook). Hooks here can
  // log every invocation but never block — we are past the dispatch point.
  // Awaited so the synchronous JS sandbox completes before the next call
  // in the same window starts.
  if (result === undefined) result = ''
  await fireHooks('postToolUse', {
    conversationId,
    toolName,
    args,
    result,
    cwd: workspacePath
  })

  const duration = Date.now() - startTime
  const finishedAt = startTime + duration
  const auditStatus = explicitStatus ?? classifyToolResult(result)
  toolRegistry.recordCallEnd(tc.id, {
    status: auditStatus,
    result: auditStatus === 'error' ? undefined : result,
    error: auditStatus === 'error' ? result : undefined,
    finishedAt,
    approvalSource,
    correlationId
  })
  emitChatEvent('chat:tool-call-result', {
    callId: tc.id,
    conversationId,
    result,
    duration,
    status: auditStatus === 'done' ? 'success' : auditStatus
  })

  return { callId: tc.id, result }
}
