import { useChatStore } from '@/stores/chat-store'
import { useSkillsStore } from '@/stores/skills-store'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { MCPStatusBar } from '@/components/mcp/MCPStatusBar'

export function ChatView() {
  const { messages, isStreaming, streamingContent, activeConversationId, sendMessage, cancelStream, toolCalls } = useChatStore()
  const activeSkillIds = useSkillsStore((s) => s.activeSkillIds)

  const handleSend = (content: string) => {
    sendMessage(content, activeSkillIds)
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
        <MCPStatusBar />
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
        toolCalls={toolCalls}
      />
      <MCPStatusBar />
      <ChatInput onSend={handleSend} onCancel={cancelStream} isStreaming={isStreaming} />
    </div>
  )
}
