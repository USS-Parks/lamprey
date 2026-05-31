import { useChatStore } from '@/stores/chat-store'
import { useSkillsStore } from '@/stores/skills-store'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { AttachmentPreview } from './AttachmentPreview'
import { FileDropZone } from './FileDropZone'
import { WelcomeScreen } from './WelcomeScreen'
import { AgentRunBanner } from './AgentRunBanner'

export function ChatView() {
  const { messages, isStreaming, streamingContent, activeConversationId, sendMessage, cancelStream, toolCalls, activeModel } = useChatStore()
  const activeSkillIds = useSkillsStore((s) => s.activeSkillIds)

  const handleSend = (content: string) => {
    sendMessage(content, activeSkillIds)
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <FileDropZone />
      <div className="flex flex-1 flex-col overflow-hidden pb-[220px]">
        {!activeConversationId ? (
          <WelcomeScreen />
        ) : (
          <MessageList
            messages={messages}
            isStreaming={isStreaming}
            streamingContent={streamingContent}
            toolCalls={toolCalls}
            activeModel={activeModel}
          />
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center px-8 pb-[60px]">
        <div className="pointer-events-auto w-full max-w-3xl">
          <AgentRunBanner />
          <AttachmentPreview />
          <ChatInput
            onSend={handleSend}
            onCancel={cancelStream}
            isStreaming={!!activeConversationId && isStreaming}
          />
        </div>
      </div>
    </div>
  )
}
