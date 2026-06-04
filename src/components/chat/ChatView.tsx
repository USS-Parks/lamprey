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
import { PlanGoalsPanel } from './PlanGoalsPanel'
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
      className="chat-column relative flex flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-primary)]"
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

      <div className="flex justify-center bg-[var(--bg-primary)] pt-3 pb-4">
        <div className={CHAT_COLUMN_CLASS}>
          <PlanGoalsPanel conversationId={activeConversationId} />
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
