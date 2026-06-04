import { useEffect } from 'react'
import { toast } from '@/stores/toast-store'

interface AsyncEventToastPayload {
  conversationId?: string
  title?: string
  message?: string
}

export function AsyncEventToast() {
  useEffect(() => {
    if (!window.api?.chat?.onAsyncEvent) return
    return window.api.chat.onAsyncEvent((event: unknown) => {
      const e = event as AsyncEventToastPayload
      const title = typeof e.title === 'string' && e.title.trim() ? e.title.trim() : 'Background update'
      const message =
        typeof e.message === 'string' && e.message.trim() ? e.message.trim() : 'Ready for the next turn'
      toast.info(`${title}: ${message}`, 6000)
    })
  }, [])

  return null
}
