import { useEffect } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { useAgentStore } from '@/stores/agent-store'
import type { AgentStatusEvent } from '@/lib/types'

export function useChat(): void {
  useEffect(() => {
    if (!window.api) return

    window.api.chat.onChunk((e) => {
      useChatStore.getState().appendStreamChunk(e.content)
    })

    window.api.chat.onDone((e) => {
      useChatStore.getState().finishStream(e.message as any)
      useAgentStore.getState().clearRun()
    })

    window.api.chat.onError((e) => {
      useChatStore.getState().streamError(e.error)
      useAgentStore.getState().clearRun()
    })

    window.api.chat.onToolCall((e) => {
      useChatStore.getState().addToolCall(e as any)
    })

    window.api.chat.onToolCallResult((e) => {
      useChatStore.getState().updateToolCall(e as any)
    })

    const onAgentStatus = window.api.chat.onAgentStatus
    if (onAgentStatus) {
      onAgentStatus((e: unknown) => {
        useAgentStore.getState().recordStatus(e as AgentStatusEvent)
      })
    }

    return () => {
      window.api?.chat.offAll()
    }
  }, [])
}
