import { useChatStore } from '@/stores/chat-store'
import { useSkillsStore } from '@/stores/skills-store'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { MCPStatusBar } from '@/components/mcp/MCPStatusBar'
import { AttachmentPreview } from './AttachmentPreview'
import { FileDropZone } from './FileDropZone'

export function ChatView() {
  const { messages, isStreaming, streamingContent, activeConversationId, sendMessage, cancelStream, toolCalls, activeModel } = useChatStore()
  const activeSkillIds = useSkillsStore((s) => s.activeSkillIds)

  const handleSend = (content: string) => {
    sendMessage(content, activeSkillIds)
  }

  return (
    <div className="relative flex flex-1 flex-col">
      <FileDropZone />
      {!activeConversationId ? (
        <>
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <h2 className="font-mono text-xl font-bold text-[var(--text-primary)]">Lamprey</h2>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                Start a new conversation or select one from the sidebar.
              </p>
            </div>
          </div>
          <MCPStatusBar />
          <AttachmentPreview />
          <ChatInput onSend={handleSend} onCancel={cancelStream} isStreaming={false} />
        </>
      ) : (
        <>
          <MessageList
            messages={messages}
            isStreaming={isStreaming}
            streamingContent={streamingContent}
            toolCalls={toolCalls}
            activeModel={activeModel}
          />
          <MCPStatusBar />
          <AttachmentPreview />
          <ChatInput onSend={handleSend} onCancel={cancelStream} isStreaming={isStreaming} />
        </>
      )}
    </div>
  )
}
