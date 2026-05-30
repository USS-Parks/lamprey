import OpenAI from 'openai'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'
import { getKey } from './keychain'

export class DeepSeekClient {
  private client: OpenAI | null = null

  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey = getKey('deepseek')
      if (!apiKey) throw new Error('DeepSeek API key not configured')
      this.client = new OpenAI({
        apiKey,
        baseURL: 'https://api.deepseek.com/v1'
      })
    }
    return this.client
  }

  resetClient(): void {
    this.client = null
  }

  async validateKey(): Promise<boolean> {
    try {
      const client = this.getClient()
      const response = await client.chat.completions.create({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Respond with only: OK' }],
        max_tokens: 5
      })
      return !!response.choices[0]?.message?.content
    } catch (err: any) {
      if (err?.status === 401) return false
      throw err
    }
  }

  async chat(
    messages: ChatCompletionMessageParam[],
    model: string
  ): Promise<string> {
    const client = this.getClient()
    const response = await client.chat.completions.create({
      model,
      messages
    })
    return response.choices[0]?.message?.content || ''
  }

  async chatStream(
    messages: ChatCompletionMessageParam[],
    model: string,
    tools: ChatCompletionTool[] | undefined,
    onChunk: (content: string) => void,
    onDone: (fullContent: string, toolCalls?: any[]) => void,
    onError: (error: string) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const client = this.getClient()
    let fullContent = ''
    const toolCallsAccumulator: Map<number, { id: string; type: string; function: { name: string; arguments: string } }> = new Map()
    let retries = 0
    const maxRetries = 3

    while (retries <= maxRetries) {
      try {
        const stream = await client.chat.completions.create({
          model,
          messages,
          stream: true,
          tools: tools && tools.length > 0 ? tools : undefined
        }, { signal })

        for await (const chunk of stream) {
          if (signal?.aborted) {
            onDone(fullContent + ' [cancelled]')
            return
          }

          const delta = chunk.choices[0]?.delta

          if (delta?.content) {
            fullContent += delta.content
            onChunk(delta.content)
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index
              if (!toolCallsAccumulator.has(idx)) {
                toolCallsAccumulator.set(idx, {
                  id: tc.id || '',
                  type: 'function',
                  function: { name: '', arguments: '' }
                })
              }
              const acc = toolCallsAccumulator.get(idx)!
              if (tc.id) acc.id = tc.id
              if (tc.function?.name) acc.function.name = tc.function.name
              if (tc.function?.arguments) acc.function.arguments += tc.function.arguments
            }
          }
        }

        const toolCalls = toolCallsAccumulator.size > 0
          ? Array.from(toolCallsAccumulator.values())
          : undefined

        onDone(fullContent, toolCalls)
        return
      } catch (err: any) {
        if (signal?.aborted) {
          onDone(fullContent + ' [cancelled]')
          return
        }

        if (err?.status === 401) {
          onError('Invalid API key')
          return
        }

        if (err?.status === 429 && retries < maxRetries) {
          retries++
          const delay = Math.pow(2, retries) * 1000
          await new Promise((r) => setTimeout(r, delay))
          continue
        }

        if (retries < maxRetries && !err?.status) {
          retries++
          const delay = Math.pow(2, retries) * 1000
          await new Promise((r) => setTimeout(r, delay))
          continue
        }

        onError(err?.message || 'Unknown error')
        return
      }
    }
  }
}

export const deepseekClient = new DeepSeekClient()
