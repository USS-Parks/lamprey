import { ipcMain, BrowserWindow, app } from 'electron'
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

function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows()
  return windows[0] || null
}

function send(channel: string, data: unknown): void {
  getMainWindow()?.webContents.send(channel, data)
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
      const agentsMd = readAgentsMd()
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

      await runChatRound(
        conversationId,
        model,
        apiMessages,
        tools.length > 0 ? tools : undefined,
        abortController.signal,
        0,
        modelParams
      )

      activeAbortControllers.delete(conversationId)
      return { success: true, data: { conversationId } }
    } catch (err: any) {
      activeAbortControllers.delete(conversationId)
      send('chat:error', { conversationId, error: err.message })
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
  signal: AbortSignal,
  round: number,
  params?: ModelParams
): Promise<void> {
  if (round >= MAX_TOOL_ROUNDS) {
    send('chat:error', {
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
          send('chat:chunk', { conversationId, content: chunk })
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
            send('chat:done', { conversationId, message: assistantMsg })
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

            send('chat:tool-call', {
              callId: tc.id,
              serverId: toolName.includes('__') ? toolName.split('__')[0] : 'internal',
              toolName: toolName.includes('__') ? toolName.split('__').slice(1).join('__') : toolName,
              args
            })

            let result: string
            const startTime = Date.now()

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
            const needsApproval =
              !!descriptor &&
              (descriptor.requiresApproval || shouldGateOnRisks(descriptor.risks))
            const approvalDecision: 'allow' | 'deny' = needsApproval && descriptor
              ? await permissionsService.requestApproval({
                  callId: tc.id,
                  toolId: descriptor.id,
                  name: descriptor.name,
                  serverId: descriptor.providerId,
                  providerKind: descriptor.providerKind,
                  risks: descriptor.risks,
                  args,
                  conversationId
                })
              : 'allow'

            if (approvalDecision === 'deny') {
              result = 'Action denied by user.'
            } else if (toolName === 'memory_add' && typeof args.content === 'string') {
              const entry = memStore.addMemory(args.content, conversationId)
              send('memory:added', entry)
              result = 'Saved to memory.'
            } else if (toolRegistry.hasHandler(toolName)) {
              // Native tools with handlers (shell_command + future apply_patch,
              // view_image, etc) dispatch through the registry.
              try {
                result = await toolRegistry.executeNative(toolName, args, { conversationId })
              } catch (err: any) {
                result = `Error: ${err.message}`
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
            let auditStatus: 'done' | 'error' | 'denied'
            if (result === 'Action denied by user.') {
              auditStatus = 'denied'
            } else if (result.startsWith('Error:') || result.startsWith('Unknown tool:')) {
              auditStatus = 'error'
            } else {
              auditStatus = 'done'
            }
            toolRegistry.recordCallEnd(tc.id, {
              status: auditStatus,
              result: auditStatus === 'error' ? undefined : result,
              error: auditStatus === 'error' ? result : undefined,
              finishedAt
            })
            send('chat:tool-call-result', { callId: tc.id, result, duration })

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
            await runChatRound(conversationId, model, messages, tools, signal, round + 1, params)
            resolve()
          } catch (err) {
            reject(err)
          }
        },
        onError: (error) => {
          send('chat:error', { conversationId, error })
          reject(new Error(error))
        }
      },
      signal,
      params
    )
  })
}

