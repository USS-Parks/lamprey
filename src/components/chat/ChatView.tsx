import { useChatStore } from '@/stores/chat-store'
import { useSkillsStore } from '@/stores/skills-store'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { AttachmentPreview } from './AttachmentPreview'
import { FileDropZone } from './FileDropZone'
import { WelcomeScreen } from './WelcomeScreen'
import { TokenTicker } from './TokenTicker'
import { AgentRunBanner } from './AgentRunBanner'
import { PlanModeBanner } from './PlanModeBanner'
import { ChapterSidebar } from './ChapterSidebar'
import { ChapterQuickJumper } from './ChapterQuickJumper'
import { SpawnTaskTray } from './SpawnTaskTray'

// Shared chat column: max-width cap + internal padding. Messages and the
// input pill both use this so they sit in the same centered column no
// matter how wide the surrounding chat area gets. `max-w-4xl` (896 px) is
// the comfortable-reading width; `px-6` keeps content off the column edge.
export const CHAT_COLUMN_CLASS = 'mx-auto w-full max-w-4xl px-6'

interface ChatViewProps {
  // Pixels of right-side padding applied to the chat-column. When the
  // floating Environment card is visible the parent passes the card's
  // width here so the centered max-w-4xl content (messages + input pill)
  // re-centers within the remaining space — same effect as expanding
  // the right sidebar would have, but achieved by padding the chat-
  // column itself (inside its border, on the same bg-primary surface)
  // so no separator line appears between chat and card. Animates in
  // lockstep with the card's entry/exit.
  rightInset?: number
}

export function ChatView({ rightInset = 0 }: ChatViewProps = {}) {
  const reducedMotion = usePrefersReducedMotion()
  const {
    messages,
    isStreaming,
    streamingContent,
    streamStartedAt,
    activeConversationId,
    sendMessage,
    cancelStream,
    activeModel
  } = useChatStore()
  const activeSkillIds = useSkillsStore((s) => s.activeSkillIds)

  const handleSend = (content: string) => {
    sendMessage(content, activeSkillIds)
  }

  return (
    <div
      className="chat-column relative flex flex-1 flex-col overflow-hidden bg-transparent"
      style={{
        paddingRight: rightInset,
        transition: reducedMotion ? undefined : 'padding-right 220ms cubic-bezier(0.2, 0.8, 0.2, 1)'
      }}
    >
      <FileDropZone />

      {/* Track 2 / C3 — persistent yellow banner above the conversation
          when plan mode is active. Self-hides when off. */}
      <PlanModeBanner conversationId={activeConversationId} />

      {/* Track 2 / E2 — chapter TOC + Ctrl+G quick-jumper. The sidebar
          floats over the message list (top-right) and self-hides until
          the conversation has at least one chapter. The quick-jumper
          opens on Ctrl+G regardless of mount order. */}
      <ChapterSidebar conversationId={activeConversationId} />
      <ChapterQuickJumper conversationId={activeConversationId} />

      <div className="flex flex-1 flex-col overflow-hidden">
        {!activeConversationId ? (
          <WelcomeScreen />
        ) : (
          <MessageList
            messages={messages}
            isStreaming={isStreaming}
            streamingContent={streamingContent}
            streamStartedAt={streamStartedAt}
            activeModel={activeModel}
          />
        )}
      </div>

      {/* Input area mirrors the messages column's scrollbar gutter so both
          columns center on the same axis — without `pr-[6px]` here the
          messages list (which has scrollbar-gutter: stable) sits 3 px to
          the left of the input pill at any chat-column width, which reads
          as a permanent half-step misalignment between the pipeline pill /
          input pill and the message bubbles above. The 6 px matches the
          ::-webkit-scrollbar width set in src/styles/index.css. */}
      <div className="flex justify-center pt-3 pb-4 pr-[6px]">
        <div className={CHAT_COLUMN_CLASS}>
          <AgentRunBanner />
          <SpawnTaskTray />
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
