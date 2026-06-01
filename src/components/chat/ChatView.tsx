import { useChatStore } from '@/stores/chat-store'
import { useSkillsStore } from '@/stores/skills-store'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { AttachmentPreview } from './AttachmentPreview'
import { FileDropZone } from './FileDropZone'
import { WelcomeScreen } from './WelcomeScreen'
import { TokenTicker } from './TokenTicker'

// Shared chat column: max-width cap + internal padding. Messages and the
// input pill both use this so they sit in the same centered column no
// matter how wide the surrounding chat area gets. `max-w-4xl` (896 px) is
// the comfortable-reading width; `px-6` keeps content off the column edge.
export const CHAT_COLUMN_CLASS = 'mx-auto w-full max-w-4xl px-6'

export function ChatView() {
  const {
    messages,
    isStreaming,
    streamingContent,
    streamStartedAt,
    activeConversationId,
    sendMessage,
    cancelStream,
    toolCalls,
    activeModel
  } = useChatStore()
  const activeSkillIds = useSkillsStore((s) => s.activeSkillIds)

  const handleSend = (content: string) => {
    sendMessage(content, activeSkillIds)
  }

  return (
    <div className="chat-column relative flex flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-primary)]">
      <FileDropZone />

      <div className="flex flex-1 flex-col overflow-hidden">
        {!activeConversationId ? (
          <WelcomeScreen />
        ) : (
          <MessageList
            messages={messages}
            isStreaming={isStreaming}
            streamingContent={streamingContent}
            streamStartedAt={streamStartedAt}
            toolCalls={toolCalls}
            activeModel={activeModel}
          />
        )}
      </div>

      <div className="flex justify-center border-t border-[var(--border)] bg-[var(--bg-primary)] pt-3 pb-4">
        <div className={CHAT_COLUMN_CLASS}>
          <TokenTicker />
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
