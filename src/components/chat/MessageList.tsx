import { useEffect, useRef } from 'react'
import type { Message } from '@/lib/types'
import { MessageBubble } from './MessageBubble'
import { StreamingText } from './StreamingText'

interface MessageListProps {
  messages: Message[]
  isStreaming: boolean
  streamingContent: string
}

export function MessageList({ messages, isStreaming, streamingContent }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      {isStreaming && streamingContent && (
        <div className="mb-3 flex justify-start">
          <div className="max-w-[80%] rounded-lg bg-[var(--bg-secondary)] px-4 py-3">
            <StreamingText content={streamingContent} />
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
