import type { Message } from '@/lib/types'

interface MessageBubbleProps {
  message: Message
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'

  if (isTool) return null

  return (
    <div className={`group flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-3 ${
          isUser
            ? 'bg-[var(--accent-dim)] text-[var(--text-primary)]'
            : 'bg-[var(--bg-secondary)] text-[var(--text-primary)]'
        }`}
      >
        <div className="whitespace-pre-wrap break-words text-sm">{message.content}</div>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100">
          <span>{formatTime(message.timestamp)}</span>
          {message.model && (
            <span className="rounded bg-[var(--bg-primary)] px-1">
              {message.model === 'deepseek-reasoner' ? 'R1' : 'V3'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
