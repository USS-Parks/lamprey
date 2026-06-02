import { ipcMain, app } from 'electron'
import { randomUUID } from 'crypto'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { chatOnce, chatStream, resolveModel } from '../services/providers/registry'
import * as convStore from '../services/conversation-store'
import * as memStore from '../services/memory-store'
import { buildSystemPrompt } from '../services/system-prompt-builder'
import { readAgentsMd } from '../services/agents-md-loader'
import { fireHooks } from '../services/hooks-runner'
import { mcpManager } from '../services/mcp-manager'
import { listSkills, getSkillContent } from '../services/skill-loader'
import { toolRegistry } from '../services/tool-registry'
import { permissionsService, shouldGateOnRisks } from '../services/permissions-store'
import { inferPhaseFromDescriptor, type AgentRunPhase } from '../services/agent-run-phase'
import { getActiveWorkspace } from '../services/workspace-state'
import { classifyToolResult } from '../services/tool-result-status'
import { dispatchNativeTool } from '../services/native-dispatch'
import { emitChatEvent } from '../services/chat-events'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'

interface ModelParams {
  temperature?: number
  topP?: number
  maxTokens?: number | null
}

function loadModelConfig(model: string): { params: ModelParams; systemPromptOverride?: string } {
  try {
    const path = join(app.getPath('userData'), 'settings.json')
    if (!existsSync(path)) return { params: {} }
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
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
  } catch {
    return { params: {} }
  }
}

const activeAbortControllers = new Map<string, AbortController>()

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

      let skillContents: { name: string; content: string }[] = []
      if (activeSkillIds && activeSkillIds.length > 0) {
        const skills = listSkills()
        skillContents = activeSkillIds
          .map((id: string) => {
            const skill = skills.find((s) => s.id === id)
            if (!skill) return null
            const content = getSkillContent(id)
            return content ? { name: skill.name, content } : null
          })
          .filter(Boolean) as { name: string; content: string }[]
      }

      const { params: modelParams, systemPromptOverride } = loadModelConfig(model)
      const activeWorkspace = getActiveWorkspace()
      const agentsMd = readAgentsMd(activeWorkspace)
      const systemPrompt = buildSystemPrompt(
        skillContents,
        memoryBlock,
        systemPromptOverride,
        agentsMd,
        model
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
      activeAbortControllers.set(conversationId, abortController)

      // Single-model only. The previous multi-agent pipeline was removed
      // because the user explicitly does not want concurrent multi-model output.
      void requestedAgentMode

      // Workspace pinned at the start of the round so the in-flight tool
      // loop sees one consistent cwd even if the user retargets the folder
      // chip mid-stream.
      const workspacePath = activeWorkspace

      await runChatRound(
        conversationId,
        model,
        apiMessages,
        tools.length > 0 ? tools : undefined,
        workspacePath,
        abortController.signal,
        0,
        modelParams
      )

      activeAbortControllers.delete(conversationId)
      return { success: true, data: { conversationId } }
    } catch (err: any) {
      activeAbortControllers.delete(conversationId)
      emitPhase(conversationId, 'error')
      emitChatEvent('chat:error', { conversationId, error: err.message })
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('chat:cancel', async (_event, conversationId) => {
    const controller = activeAbortControllers.get(conversationId)
    if (controller) {
      controller.abort()
      activeAbortControllers.delete(conversationId)
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

async function runChatRound(
  conversationId: string,
  model: string,
  messages: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[] | undefined,
  workspacePath: string,
  signal: AbortSignal,
  round: number,
  params?: ModelParams
): Promise<void> {
  if (round >= MAX_TOOL_ROUNDS) {
    emitPhase(conversationId, 'error')
    emitChatEvent('chat:error', {
      conversationId,
      error: 'Maximum tool call rounds reached'
    })
    return
  }

  const descriptor = resolveModel(model)
  const effectiveTools = descriptor.supportsTools ? tools : undefined

  return new Promise<void>((resolve, reject) => {
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
            const assistantMsg = convStore.saveMessage({
              id: randomUUID(),
              conversationId,
              role: 'assistant',
              content: fullContent,
              model
            })
            emitPhase(conversationId, 'done')
            emitChatEvent('chat:done', { conversationId, message: assistantMsg })
            fireHooks('agentStop', { conversationId })
            resolve()
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

          for (const tc of toolCalls) {
            const toolName = tc.function.name
            let args: Record<string, unknown> = {}
            try {
              args = JSON.parse(tc.function.arguments)
            } catch {
              args = {}
            }

            const startTime = Date.now()

            // Resolve the descriptor early so the UI event carries the
            // plain-English title + risk metadata. Falls back gracefully for
            // tools that haven't registered a descriptor (shouldn't happen in
            // normal flow but defensive).
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

            let result: string
            // Set by native handlers that return a structured envelope —
            // takes precedence over the heuristic classifier so handlers
            // can signal outcomes the result text can't represent.
            let explicitStatus: 'done' | 'error' | 'denied' | undefined

            // Audit-buffer entry — tool-calls-store persists this to SQLite.
            toolRegistry.recordCallStart({
              id: tc.id,
              toolId: toolName,
              name: toolName,
              conversationId,
              args,
              startedAt: startTime,
              status: 'running'
            })

            // Single generic approval gate. Two triggers route through the
            // permissionsService:
            //   1. descriptor.requiresApproval — hard gate set by the tool.
            //   2. descriptor.risks intersects GATING_RISKS — soft gate so
            //      every network / destructive / secret tool prompts at least
            //      once. The user can pick "Always" in the modal, or grant a
            //      risk-scope via request_permissions, to silence subsequent
            //      prompts for that risk in this conversation or globally.
            //   Pure 'read'/'write' (memory_add, update_plan, view_image,
            //   web_find, time_lookup) do NOT trigger this gate.
            const descriptor = toolRegistry.getById(toolName)
            if (descriptor) {
              emitPhase(conversationId, inferPhaseFromDescriptor(descriptor))
            }
            const needsApproval =
              !!descriptor &&
              (descriptor.requiresApproval || shouldGateOnRisks(descriptor.risks))
            const approvalOutcome = needsApproval && descriptor
              ? await permissionsService.requestApprovalDetailed({
                  callId: tc.id,
                  toolId: descriptor.id,
                  name: descriptor.name,
                  serverId: descriptor.providerId,
                  providerKind: descriptor.providerKind,
                  risks: descriptor.risks,
                  args,
                  conversationId
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
                  workspacePath
                })
              )
              result = dispatched.result
              explicitStatus = dispatched.status
              // update_plan side effect: the result body is the JSON-encoded
              // plan snapshot; broadcast it so the PlanChecklist refreshes
              // without a polling round-trip. Only when the call actually
              // succeeded — a failed update_plan never has a snapshot to
              // forward.
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
            // Explicit status from a structured handler return wins; falls
            // back to the legacy classifier for plain-string returns (mostly
            // MCP tools and the still-unmigrated handler paths).
            const auditStatus = explicitStatus ?? classifyToolResult(result)
            toolRegistry.recordCallEnd(tc.id, {
              status: auditStatus,
              result: auditStatus === 'error' ? undefined : result,
              error: auditStatus === 'error' ? result : undefined,
              finishedAt,
              approvalSource
            })
            emitChatEvent('chat:tool-call-result', {
              callId: tc.id,
              conversationId,
              result,
              duration,
              // Maps audit status to the renderer enum: 'done' → 'success',
              // 'error' / 'denied' pass through. The chat-store turns this into
              // the badge + outline color on ToolUseCard.
              status: auditStatus === 'done' ? 'success' : auditStatus
            })

            convStore.saveMessage({
              id: randomUUID(),
              conversationId,
              role: 'tool',
              content: result,
              toolCallId: tc.id
            })

            messages.push({
              role: 'tool',
              content: result,
              tool_call_id: tc.id
            } as any)
          }

          try {
            await runChatRound(conversationId, model, messages, tools, workspacePath, signal, round + 1, params)
            resolve()
          } catch (err) {
            reject(err)
          }
        },
        onError: (error) => {
          emitPhase(conversationId, 'error')
          emitChatEvent('chat:error', { conversationId, error })
          reject(new Error(error))
        }
      },
      signal,
      params
    )
  })
}

