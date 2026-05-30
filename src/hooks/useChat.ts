import { useEffect } from 'react'
import { useChatStore } from '@/stores/chat-store'

export function useChat(): void {
  useEffect(() => {
    if (!window.api) return

    window.api.chat.onChunk((e) => {
      useChatStore.getState().appendStreamChunk(e.content)
    })

    window.api.chat.onDone((e) => {
      useChatStore.getState().finishStream(e.message as any)
    })

    window.api.chat.onError((e) => {
      useChatStore.getState().streamError(e.error)
    })

    window.api.chat.onToolCall((e) => {
      useChatStore.getState().addToolCall(e as any)
    })

    window.api.chat.onToolCallResult((e) => {
      useChatStore.getState().updateToolCall(e as any)
    })

    return () => {
      window.api?.chat.offAll()
    }
  }, [])
}
