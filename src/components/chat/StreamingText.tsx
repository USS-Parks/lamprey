import { MarkdownRenderer } from '@/components/artifacts/MarkdownRenderer'

interface StreamingTextProps {
  content: string
}

export function StreamingText({ content }: StreamingTextProps) {
  return (
    <div>
      <MarkdownRenderer content={content} />
      <span className="inline-block h-4 w-0.5 animate-pulse bg-[var(--accent)]" />
    </div>
  )
}
