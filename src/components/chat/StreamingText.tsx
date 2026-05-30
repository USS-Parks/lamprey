interface StreamingTextProps {
  content: string
}

export function StreamingText({ content }: StreamingTextProps) {
  return (
    <div className="whitespace-pre-wrap break-words text-sm text-[var(--text-primary)]">
      {content}
      <span className="inline-block h-4 w-0.5 animate-pulse bg-[var(--accent)]" />
    </div>
  )
}
