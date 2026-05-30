import { useChatStore } from '@/stores/chat-store'
import { useSkillsStore } from '@/stores/skills-store'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { MCPStatusBar } from '@/components/mcp/MCPStatusBar'
import { AttachmentPreview } from './AttachmentPreview'
import { FileDropZone } from './FileDropZone'
import { WelcomeScreen } from './WelcomeScreen'

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
          <WelcomeScreen />
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
