import { MarkdownRenderer } from '@/components/artifacts/MarkdownRenderer'
import { parseReasoning } from '@/lib/reasoning'
import { ReasoningBlock } from './ReasoningBlock'
import codingIconUrl from '@assets/Lamprey Coding Icon.png'

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

export function StreamingText({ content, reasoning, isThinking, model: _model }: StreamingTextProps) {
  // Prefer the provider-side reasoning channel when the caller supplied it
  // (deepseek-reasoner + V4-Flash thinking mode + DashScope enable_thinking).
  // Fall back to the inline-<think> parse for EVERY model — the system
  // contract requires every assistant turn to lead with <think>…</think>,
  // so any model that doesn't expose a native channel still surfaces its
  // chain-of-thought through this path.
  let displayReasoning: string | null = null
  let displayBody = content
  let stillThinking = !!isThinking

  if (reasoning && reasoning.length > 0) {
    displayReasoning = reasoning
  } else {
    const parsed = parseReasoning(content)
    if (parsed.reasoning) {
      displayReasoning = parsed.reasoning
      displayBody = parsed.body
      stillThinking = parsed.isThinking
    }
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
        className="icon-asset ml-0.5 inline-block h-12 w-12 animate-pulse object-contain align-text-bottom"
      />
    </div>
  )
}
