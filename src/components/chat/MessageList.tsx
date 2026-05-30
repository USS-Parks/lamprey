import { useEffect, useRef } from 'react'
import type { Message } from '@/lib/types'
import type { ToolCallState } from '@/stores/chat-store'
import { MessageBubble } from './MessageBubble'
import { StreamingText } from './StreamingText'
import { ToolUseCard } from './ToolUseCard'

interface MessageListProps {
  messages: Message[]
  isStreaming: boolean
  streamingContent: string
  toolCalls: ToolCallState[]
}

export function MessageList({ messages, isStreaming, streamingContent, toolCalls }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent, toolCalls])

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      {toolCalls.map((tc) => (
        <ToolUseCard key={tc.callId} toolCall={tc} />
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
