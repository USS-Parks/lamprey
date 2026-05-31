/**
 * Legacy shim. The real chat dispatch lives in services/providers/registry.ts.
 * Kept so older imports keep compiling; everything routes through the registry,
 * which selects DeepSeek, Google (Gemma), or DashScope (Qwen) per model.
 */
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'
import {
  chatOnce,
  chatStream,
  resetProviderClient,
  resetProviderClients,
  validateProviderKey,
  type ToolCallAccumulator
} from './providers/registry'

export class DeepSeekClient {
  resetClient(): void {
    resetProviderClient('deepseek')
  }

  resetAll(): void {
    resetProviderClients()
  }

  async validateKey(): Promise<boolean> {
    return validateProviderKey('deepseek')
  }

  async chat(messages: ChatCompletionMessageParam[], model: string): Promise<string> {
    return chatOnce(messages, model)
  }

  async chatStream(
    messages: ChatCompletionMessageParam[],
    model: string,
    tools: ChatCompletionTool[] | undefined,
    onChunk: (content: string) => void,
    onDone: (fullContent: string, toolCalls?: ToolCallAccumulator[]) => void,
    onError: (error: string) => void,
    signal?: AbortSignal,
    params?: { temperature?: number; topP?: number; maxTokens?: number | null }
  ): Promise<void> {
    return chatStream(messages, model, tools, { onChunk, onDone, onError }, signal, params)
  }
}

export const deepseekClient = new DeepSeekClient()
