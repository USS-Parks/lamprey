import { useEffect } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { toast } from '@/stores/toast-store'

export function useShellSignals(): void {
  useEffect(() => {
    if (!window.api) return

    window.api.tray.onNewConversation(() => {
      void useChatStore.getState().createConversation()
    })

    window.api.shortcuts.onCopyLastAssistant(async () => {
      const messages = useChatStore.getState().messages
      const last = [...messages].reverse().find((m) => m.role === 'assistant')
      if (!last) {
        toast.warning('No assistant message to copy.')
        return
      }
      try {
        await window.api.clipboard.writeText(last.content)
        toast.success('Last assistant message copied.')
      } catch (err) {
        toast.error(`Copy failed: ${(err as Error).message}`)
      }
    })

    window.api.update.onError((e) => {
      const message = (e as { message: string }).message
      if (message) toast.error(`Updater: ${message}`)
    })
  }, [])
}
