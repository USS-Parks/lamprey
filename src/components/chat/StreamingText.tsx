import { MarkdownRenderer } from '@/components/artifacts/MarkdownRenderer'
import { parseReasoning } from '@/lib/reasoning'
import { ReasoningBlock } from './ReasoningBlock'

interface StreamingTextProps {
  content: string
  model?: string
}

export function StreamingText({ content, model }: StreamingTextProps) {
  const isReasoner = model === 'deepseek-reasoner'
  const { reasoning, body, isThinking } = isReasoner
    ? parseReasoning(content)
    : { reasoning: null as string | null, body: content, isThinking: false }

  return (
    <div>
      {reasoning && <ReasoningBlock content={reasoning} isThinking={isThinking} />}
      <MarkdownRenderer content={body} />
      <span className="inline-block h-4 w-0.5 animate-pulse bg-[var(--accent)]" />
    </div>
  )
}
