import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { chatOnce, chatStream, resolveModel } from '../services/providers/registry'
import * as convStore from '../services/conversation-store'
import * as memStore from '../services/memory-store'
import { buildSystemPrompt, buildAgentSystemPrompt } from '../services/system-prompt-builder'
import { mcpManager } from '../services/mcp-manager'
import { listSkills, getSkillContent } from '../services/skill-loader'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
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

function loadAgentRoster(): { mode: 'single' | 'multi'; roster: Record<string, string> } {
  try {
    const path = join(app.getPath('userData'), 'settings.json')
    if (!existsSync(path)) return { mode: 'single', roster: {} }
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    const mode = raw.agentMode === 'multi' ? 'multi' : 'single'
    const roster = (raw.agentRoster as Record<string, string>) || {}
    return { mode, roster }
  } catch {
    return { mode: 'single', roster: {} }
  }
}

const activeAbortControllers = new Map<string, AbortController>()
const pendingConfirmations = new Map<string, (approved: boolean) => void>()

const MEMORY_ADD_TOOL: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'memory_add',
    description: 'Save a fact about the user to persistent memory.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The fact to remember' }
      },
      required: ['content']
    }
  }
}

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
      const systemPrompt = buildSystemPrompt(skillContents, memoryBlock, systemPromptOverride)

      // Build MCP tools list
      const mcpTools: ChatCompletionTool[] = []
      const serverTools = mcpManager.getAllTools()
      for (const st of serverTools) {
        for (const tool of st.tools) {
          mcpTools.push({
            type: 'function',
            function: {
              name: `${st.serverId}__${tool.name}`,
              description: tool.description || '',
              parameters: (tool.inputSchema as any) || { type: 'object', properties: {} }
            }
          })
        }
      }

      const tools: ChatCompletionTool[] = [MEMORY_ADD_TOOL, ...mcpTools]

      const apiMessages: ChatCompletionMessageParam[] = [
        { role: 'system' as const, content: systemPrompt },
        ...allMessages
          .filter((m) => m.role !== 'system')
          .map((m): ChatCompletionMessageParam => {
            if (m.role === 'tool' && m.toolCallId) {
              return { role: 'tool' as const, content: m.content, tool_call_id: m.toolCallId }
            }
            if (m.role === 'assistant') {
              return { role: 'assistant' as const, content: m.content }
            }
            return { role: 'user' as const, content: m.content }
          })
      ]

      const abortController = new AbortController()
      activeAbortControllers.set(conversationId, abortController)

      const { mode: storedMode, roster } = loadAgentRoster()
      const mode: 'single' | 'multi' = requestedAgentMode === 'multi' ? 'multi' : storedMode

      if (mode === 'multi') {
        await runMultiAgent(
          conversationId,
          model,
          systemPrompt,
          allMessages,
          roster,
          abortController.signal
        )
        activeAbortControllers.delete(conversationId)
        return { success: true, data: { conversationId } }
      }

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

  ipcMain.handle('mcp:approveToolCall', async (_event, callId, approved) => {
    const resolve = pendingConfirmations.get(callId)
    if (resolve) {
      resolve(approved)
      pendingConfirmations.delete(callId)
    }
    return { success: true, data: null }
  })
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
            resolve()
            return
          }

          convStore.saveMessage({
            id: randomUUID(),
            conversationId,
            role: 'assistant',
            content: fullContent || '',
            model
          })

          messages.push({
            role: 'assistant',
            content: fullContent || null,
            tool_calls: toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.function.name, arguments: tc.function.arguments }
            }))
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

            if (toolName === 'memory_add' && typeof args.content === 'string') {
              const entry = memStore.addMemory(args.content, conversationId)
              send('memory:added', entry)
              result = 'Saved to memory.'
            } else if (toolName.includes('__')) {
              const [serverId, ...nameParts] = toolName.split('__')
              const mcpToolName = nameParts.join('__')

              const chromeDestructive = ['click', 'fill', 'submit', 'type', 'press', 'select_option']
              if (serverId === 'chrome' && chromeDestructive.includes(mcpToolName)) {
                send('mcp:confirmationRequired', {
                  callId: tc.id,
                  serverId,
                  toolName: mcpToolName,
                  args
                })

                const approved = await new Promise<boolean>((res) => {
                  pendingConfirmations.set(tc.id, res)
                  setTimeout(() => {
                    if (pendingConfirmations.has(tc.id)) {
                      pendingConfirmations.delete(tc.id)
                      res(false)
                    }
                  }, 30000)
                })

                if (!approved) {
                  result = 'Action denied by user.'
                } else {
                  try {
                    const mcpResult = await mcpManager.callTool(serverId, mcpToolName, args)
                    result = typeof mcpResult === 'string' ? mcpResult : JSON.stringify(mcpResult)
                  } catch (err: any) {
                    result = `Error: ${err.message}`
                  }
                }
              } else {
                try {
                  const mcpResult = await mcpManager.callTool(serverId, mcpToolName, args)
                  result = typeof mcpResult === 'string' ? mcpResult : JSON.stringify(mcpResult)
                } catch (err: any) {
                  result = `Error: ${err.message}`
                }
              }
            } else {
              result = `Unknown tool: ${toolName}`
            }

            const duration = Date.now() - startTime
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

// Multi-agent orchestrator: Planner → Coder → Reviewer, then a final
// consolidated message gets persisted as the assistant turn. Each role can
// use a different provider/model from the roster.
async function runMultiAgent(
  conversationId: string,
  fallbackModel: string,
  systemPrompt: string,
  history: Array<{ role: string; content: string }>,
  roster: Record<string, string>,
  signal: AbortSignal
): Promise<void> {
  const userTurn = [...history].reverse().find((m) => m.role === 'user')?.content || ''
  const plannerModel = roster.planner || fallbackModel
  const coderModel = roster.coder || fallbackModel
  const reviewerModel = roster.reviewer || fallbackModel

  send('agent:status', { conversationId, role: 'planner', model: plannerModel, state: 'running' })
  const plannerMessages: ChatCompletionMessageParam[] = [
    { role: 'system', content: buildAgentSystemPrompt('planner', systemPrompt) },
    { role: 'user', content: userTurn }
  ]
  const planText = await chatOnce(plannerMessages, plannerModel)
  send('agent:status', { conversationId, role: 'planner', model: plannerModel, state: 'done', output: planText })
  if (signal.aborted) return

  send('agent:status', { conversationId, role: 'coder', model: coderModel, state: 'running' })
  const coderMessages: ChatCompletionMessageParam[] = [
    { role: 'system', content: buildAgentSystemPrompt('coder', systemPrompt) },
    { role: 'user', content: `User request:\n${userTurn}\n\nPlanner output:\n${planText}` }
  ]
  const coderText = await chatOnce(coderMessages, coderModel)
  send('agent:status', { conversationId, role: 'coder', model: coderModel, state: 'done', output: coderText })
  if (signal.aborted) return

  send('agent:status', { conversationId, role: 'reviewer', model: reviewerModel, state: 'running' })
  const reviewerMessages: ChatCompletionMessageParam[] = [
    { role: 'system', content: buildAgentSystemPrompt('reviewer', systemPrompt) },
    {
      role: 'user',
      content: `User request:\n${userTurn}\n\nPlan:\n${planText}\n\nCoder output:\n${coderText}`
    }
  ]
  const reviewText = await chatOnce(reviewerMessages, reviewerModel)
  send('agent:status', { conversationId, role: 'reviewer', model: reviewerModel, state: 'done', output: reviewText })

  const consolidated =
    `### Plan (${plannerModel})\n${planText}\n\n` +
    `### Implementation (${coderModel})\n${coderText}\n\n` +
    `### Review (${reviewerModel})\n${reviewText}`

  const assistantMsg = convStore.saveMessage({
    id: randomUUID(),
    conversationId,
    role: 'assistant',
    content: consolidated,
    model: `multi:${plannerModel}+${coderModel}+${reviewerModel}`
  })
  send('chat:chunk', { conversationId, content: consolidated })
  send('chat:done', { conversationId, message: assistantMsg })
}
