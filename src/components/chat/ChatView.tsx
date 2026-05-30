import { useChatStore } from '@/stores/chat-store'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'

export function ChatView() {
  const { messages, isStreaming, streamingContent, activeConversationId, sendMessage, cancelStream } = useChatStore()

  const handleSend = (content: string) => {
    sendMessage(content, [])
  }

  if (!activeConversationId) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <h2 className="font-mono text-xl font-bold text-[var(--text-primary)]">Lamprey</h2>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Start a new conversation or select one from the sidebar.
            </p>
          </div>
        </div>
        <ChatInput onSend={handleSend} onCancel={cancelStream} isStreaming={false} />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        streamingContent={streamingContent}
      />
      <ChatInput onSend={handleSend} onCancel={cancelStream} isStreaming={isStreaming} />
    </div>
  )
}
