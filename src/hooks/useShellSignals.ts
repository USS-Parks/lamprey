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

    // Note: update:error is no longer pushed from main on background checks
    // (it spammed toasts whenever the GitHub repo lacked latest.yml). The
    // channel is preserved for future use; for now we just no-op here. Manual
    // "Check for updates" still surfaces errors via the update:check return.
  }, [])
}
