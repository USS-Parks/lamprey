import { useEffect } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { useUiStore } from '@/stores/ui-store'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  if (target.isContentEditable) return true
  return false
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey

      // Ctrl/Cmd+N — new conversation
      if (mod && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault()
        useChatStore.getState().createConversation()
        return
      }

      // Ctrl/Cmd+K — focus search
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        useUiStore.getState().requestSearchFocus()
        return
      }

      // Ctrl/Cmd+B — toggle sidebar
      if (mod && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault()
        useUiStore.getState().toggleSidebar()
        return
      }

      // Ctrl/Cmd+, — open settings
      if (mod && e.key === ',') {
        e.preventDefault()
        useUiStore.getState().toggleSettings()
        return
      }

      // Esc — cancel stream, or close settings, or clear search
      if (e.key === 'Escape') {
        const chat = useChatStore.getState()
        const ui = useUiStore.getState()
        if (chat.isStreaming) {
          e.preventDefault()
          chat.cancelStream()
          return
        }
        if (ui.settingsOpen) {
          e.preventDefault()
          ui.closeSettings()
          return
        }
        // Don't intercept Esc inside text inputs — Sidebar's search has its own handler
        if (isEditableTarget(e.target)) return
        if (ui.searchQuery) {
          e.preventDefault()
          ui.setSearchQuery('')
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
