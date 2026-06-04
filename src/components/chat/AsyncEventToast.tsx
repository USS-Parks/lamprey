import { useEffect } from 'react'
import { toast } from '@/stores/toast-store'
import { useChatStore } from '@/stores/chat-store'
import { useInlineNoticesStore } from '@/stores/inline-notices-store'

interface AsyncEventToastPayload {
  conversationId?: string
  title?: string
  message?: string
}

// Fluidity J9: async background events (turn-completed, wake-up landed,
// etc.) now surface as inline transcript notices when their conversation
// is active. Falls back to a toast only when the user is NOT looking at
// the affected conversation, so the toast surface stays reserved for
// genuine "you need to switch focus to see this" cases.

export function AsyncEventToast() {
  useEffect(() => {
    if (!window.api?.chat?.onAsyncEvent) return
    return window.api.chat.onAsyncEvent((event: unknown) => {
      const e = event as AsyncEventToastPayload
      const title =
        typeof e.title === 'string' && e.title.trim()
          ? e.title.trim()
          : 'Background update'
      const message =
        typeof e.message === 'string' && e.message.trim()
          ? e.message.trim()
          : 'Ready for the next turn'

      const targetConv = typeof e.conversationId === 'string' ? e.conversationId : null
      const activeConv = useChatStore.getState().activeConversationId
      const ts = Date.now()

      if (targetConv && targetConv === activeConv) {
        useInlineNoticesStore.getState().push({
          id: `async-${ts}-${Math.random().toString(36).slice(2, 8)}`,
          conversationId: targetConv,
          title,
          message,
          ts
        })
        return
      }
      // Off-conversation (or no active conv) → keep the toast as the
      // signal so the user knows something happened in another window.
      toast.info(`${title}: ${message}`, 6000)
    })
  }, [])

  return null
}
