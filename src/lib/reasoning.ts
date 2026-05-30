export interface ParsedReasoning {
  reasoning: string | null
  body: string
  isThinking: boolean
}

export function parseReasoning(content: string): ParsedReasoning {
  if (!content) return { reasoning: null, body: '', isThinking: false }
  const closed = content.match(/^\s*<think>([\s\S]*?)<\/think>\s*([\s\S]*)$/)
  if (closed) {
    return { reasoning: closed[1].trim(), body: closed[2], isThinking: false }
  }
  if (/^\s*<think>/.test(content)) {
    return { reasoning: content.replace(/^\s*<think>/, '').trim(), body: '', isThinking: true }
  }
  return { reasoning: null, body: content, isThinking: false }
}
