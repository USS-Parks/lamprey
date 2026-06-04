import { MarkdownRenderer } from '@/components/artifacts/MarkdownRenderer'
import { parseReasoning } from '@/lib/reasoning'
import { useThemedIcon } from '@/lib/themed-icon'
import { ReasoningBlock } from './ReasoningBlock'
import codingLight from '@assets/Lamprey Coding Icon.png'
import codingDark from '@assets/Lamprey Coding Icon Dark View.png'

interface StreamingTextProps {
  content: string
  /** Live chain-of-thought streamed off the provider's reasoning channel
   *  (DeepSeek/OpenRouter). When supplied, drives the ReasoningBlock —
   *  takes precedence over the legacy inline-<think> parse path. */
  reasoning?: string
  /** True while the model is still emitting reasoning deltas. Keeps the
   *  ReasoningBlock auto-expanded with a pulsing "thinking…" badge. */
  isThinking?: boolean
  model?: string
}

export function StreamingText({ content, reasoning, isThinking, model }: StreamingTextProps) {
  const codingIconUrl = useThemedIcon(codingLight, codingDark)

  // Prefer the provider-side reasoning channel when the caller supplied it.
  // Fall back to the legacy inline-<think> parse for any model that still
  // smuggles reasoning into the visible content stream.
  let displayReasoning: string | null = null
  let displayBody = content
  let stillThinking = !!isThinking

  if (reasoning && reasoning.length > 0) {
    displayReasoning = reasoning
  } else if (model === 'deepseek-reasoner') {
    const parsed = parseReasoning(content)
    displayReasoning = parsed.reasoning
    displayBody = parsed.body
    stillThinking = parsed.isThinking
  }

  return (
    <div>
      {displayReasoning && (
        <ReasoningBlock content={displayReasoning} isThinking={stillThinking} />
      )}
      <MarkdownRenderer content={displayBody} />
      <img
        src={codingIconUrl}
        alt=""
        aria-hidden
        className="icon-asset ml-0.5 inline-block h-6 w-6 animate-pulse object-contain align-text-bottom"
      />
    </div>
  )
}
