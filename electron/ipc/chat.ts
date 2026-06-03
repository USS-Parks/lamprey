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
import * as convStore from '../services/conversation-store'
import * as memStore from '../services/memory-store'
import { buildSystemPrompt } from '../services/system-prompt-builder'
import { resolveAgentDispatch, runAgentPipeline } from '../services/agent-pipeline'
import { readAgentsMd } from '../services/agents-md-loader'
import { fireHooks } from '../services/hooks-runner'
import { mcpManager } from '../services/mcp-manager'
import { listSkills, getSkillContent } from '../services/skill-loader'
import { toolRegistry } from '../services/tool-registry'
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

// Tool definitions (memory_add + MCP tools) come from toolRegistry.
// Approval gating is owned by permissionsService — both live in services/.

const MAX_TOOL_ROUNDS = 10

function emitPhase(conversationId: string, phase: AgentRunPhase): void {
  emitChatEvent('chat:phase', { conversationId, phase })
}

export function registerChatHandlers(): void {
  ipcMain.handle('chat:send', async (_event, request) => {
    const { content, model, activeSkillIds, agentMode: requestedAgentMode } = request
    let { conversationId } = request

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

      fireHooks('promptSubmit', { conversationId, promptBody: content })

      const allMessages = convStore.getMessages(conversationId)
      const memoryBlock = memStore.buildMemoryBlock()

      const settingsRaw = readSettingsJson()
      const agentic = loadAgenticCodingConfig(settingsRaw)

      // Auto-merge the configured agentic-coding skill ids into the round's
      // active set when mode is on. mergeAgenticSkillIds dedupes against the
      // user's existing picks so toggling the same skill from the panel
      // doesn't double-inject its content.
      const requestSkillIds: string[] = Array.isArray(activeSkillIds) ? activeSkillIds : []
      const effectiveSkillIds = agentic.mode
        ? mergeAgenticSkillIds(requestSkillIds, agentic.skills)
        : requestSkillIds

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
        agentic.mode ? 'coding' : undefined
      )

      // Tools come from the unified registry — natives (memory_add today) plus
      // all currently-connected MCP server tools, with stable descriptors and
      // OpenAI-compatible function schemas.
      const tools: ChatCompletionTool[] = toolRegistry.getOpenAITools()

      // Rebuild the chat history for the API. Tool replies are only valid if
      // the directly preceding assistant message has a matching entry in
      // tool_calls — otherwise the provider 400s with "Messages with role
      // 'tool' must be a response to a preceding message with 'tool_calls'".
      // Legacy DB rows from before the tool_calls column landed have orphan
      // tool replies; we drop those silently so old conversations don't break.
      const apiMessages: ChatCompletionMessageParam[] = [
        { role: 'system' as const, content: systemPrompt }
      ]
      for (const m of allMessages) {
        if (m.role === 'system') continue
        if (m.role === 'tool' && m.toolCallId) {
          const prev = apiMessages[apiMessages.length - 1] as
            | (ChatCompletionMessageParam & { tool_calls?: Array<{ id: string }> })
            | undefined
          const hasMatchingCall =
            prev?.role === 'assistant' &&
            Array.isArray(prev.tool_calls) &&
            prev.tool_calls.some((tc) => tc.id === m.toolCallId)
          if (hasMatchingCall) {
            apiMessages.push({
              role: 'tool' as const,
              content: m.content,
              tool_call_id: m.toolCallId
            })
          }
          continue
        }
        if (m.role === 'assistant') {
          if (m.toolCalls && m.toolCalls.length > 0) {
            apiMessages.push({
              role: 'assistant' as const,
              content: m.content || null,
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.function.name, arguments: tc.function.arguments }
              }))
            } as ChatCompletionMessageParam)
          } else {
            apiMessages.push({ role: 'assistant' as const, content: m.content })
          }
          continue
        }
        apiMessages.push({ role: 'user' as const, content: m.content })
      }

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
          'coding'
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
      return { success: true, data: { conversationId } }
    } catch (err: any) {
      activeAbortControllers.delete(conversationId)
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
      error: 'Maximum tool call rounds reached'
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
        onDone: async (fullContent, toolCalls) => {
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
              }
            }
            const assistantMsg = convStore.saveMessage({
              id: randomUUID(),
              conversationId,
              role: 'assistant',
              content: finalContent,
              model,
              draft
            })
            if (!suppressDoneEvent) {
              emitPhase(conversationId, 'done')
              emitChatEvent('chat:done', { conversationId, message: assistantMsg })
              fireHooks('agentStop', { conversationId })
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
            toolCalls: persistedToolCalls
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
        onError: (error) => {
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
    args
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
  const needsApproval = descriptorNeedsApproval(descriptor)
  const approvalOutcome =
    needsApproval && descriptor
      ? await permissionsService.requestApprovalDetailed({
          callId: tc.id,
          toolId: descriptor.id,
          name: descriptor.name,
          serverId: descriptor.providerId,
          providerKind: descriptor.providerKind,
          risks: descriptor.risks,
          args,
          conversationId,
          correlationId
        })
      : { decision: 'allow' as const, source: 'none' }
  const approvalDecision = approvalOutcome.decision
  const approvalSource = approvalOutcome.source

  if (approvalDecision === 'deny') {
    result = 'Action denied by user.'
    explicitStatus = 'denied'
  } else if (toolName === 'memory_add' && typeof args.content === 'string') {
    const entry = memStore.addMemory(args.content, conversationId)
    emitChatEvent('memory:added', entry)
    result = 'Saved to memory.'
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
