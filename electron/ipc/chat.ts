import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { deepseekClient } from '../services/deepseek'
import * as convStore from '../services/conversation-store'
import * as memStore from '../services/memory-store'
import { buildSystemPrompt } from '../services/system-prompt-builder'
import { mcpManager } from '../services/mcp-manager'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'

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
    const { content, model, activeSkillIds } = request
    let { conversationId } = request

    try {
      if (conversationId === 'new' || !conversationId) {
        const conv = convStore.createConversation(model)
        conversationId = conv.id
      }

      const userMsg = convStore.saveMessage({
        id: randomUUID(),
        conversationId,
        role: 'user',
        content,
        model
      })

      const allMessages = convStore.getMessages(conversationId)

      const memoryBlock = memStore.buildMemoryBlock()

      // Skill loading — gracefully handle if skill-loader not yet initialized
      let skillContents: { name: string; content: string }[] = []
      try {
        const { getSkillContent, listSkills } = await import('../services/skill-loader')
        if (activeSkillIds && activeSkillIds.length > 0) {
          const skills = listSkills()
          skillContents = activeSkillIds
            .map((id: string) => {
              const skill = skills.find((s: any) => s.id === id)
              if (!skill) return null
              const content = getSkillContent(id)
              return content ? { name: skill.name, content } : null
            })
            .filter(Boolean) as { name: string; content: string }[]
        }
      } catch {
        // skill-loader not yet available
      }

      const systemPrompt = buildSystemPrompt(skillContents, memoryBlock)

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
        ...allMessages.map((m): ChatCompletionMessageParam => {
          if (m.role === 'tool' && m.toolCallId) {
            return { role: 'tool' as const, content: m.content, tool_call_id: m.toolCallId }
          }
          if (m.role === 'assistant') {
            return { role: 'assistant' as const, content: m.content }
          }
          if (m.role === 'system') {
            return { role: 'system' as const, content: m.content }
          }
          return { role: 'user' as const, content: m.content }
        })
      ]

      const abortController = new AbortController()
      activeAbortControllers.set(conversationId, abortController)

      await runChatRound(
        conversationId,
        model,
        apiMessages,
        tools.length > 0 ? tools : undefined,
        abortController.signal,
        0
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
  round: number
): Promise<void> {
  if (round >= MAX_TOOL_ROUNDS) {
    send('chat:error', {
      conversationId,
      error: 'Maximum tool call rounds reached'
    })
    return
  }

  return new Promise<void>((resolve, reject) => {
    deepseekClient.chatStream(
      messages,
      model,
      model === 'deepseek-reasoner' ? undefined : tools,
      (chunk) => {
        send('chat:chunk', { conversationId, content: chunk })
      },
      async (fullContent, toolCalls) => {
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

        // Save assistant message with tool calls
        const assistantId = randomUUID()
        convStore.saveMessage({
          id: assistantId,
          conversationId,
          role: 'assistant',
          content: fullContent || '',
          model
        })

        // Build assistant message with tool_calls for API
        messages.push({
          role: 'assistant',
          content: fullContent || null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments }
          }))
        } as any)

        // Process each tool call
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
            // MCP tool call
            const [serverId, ...nameParts] = toolName.split('__')
            const mcpToolName = nameParts.join('__')

            // Check if destructive Chrome action requiring confirmation
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

          // Save tool result message
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

        // Continue with next round
        try {
          await runChatRound(conversationId, model, messages, tools, signal, round + 1)
          resolve()
        } catch (err) {
          reject(err)
        }
      },
      (error) => {
        send('chat:error', { conversationId, error })
        reject(new Error(error))
      },
      signal
    )
  })
}
