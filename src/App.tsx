import { useEffect, useState } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import { Titlebar } from '@/components/layout/Titlebar'
import { ChatView } from '@/components/chat/ChatView'
import { ApiKeyModal } from '@/components/settings/ApiKeyModal'
import { useChatStore } from '@/stores/chat-store'
import { useModelStore } from '@/stores/model-store'
import { useChat } from '@/hooks/useChat'

function App(): React.ReactElement {
  const [needsApiKey, setNeedsApiKey] = useState<boolean | null>(null)
  const loadConversations = useChatStore((s) => s.loadConversations)
  const loadModels = useModelStore((s) => s.loadModels)

  // Wire IPC event listeners
  useChat()

  useEffect(() => {
    const init = async () => {
      if (!window.api) {
        setNeedsApiKey(true)
        return
      }
      const result = await window.api.settings.hasApiKey()
      setNeedsApiKey(result.success ? !result.data : true)
      await Promise.all([loadConversations(), loadModels()])
    }
    init()
  }, [])

  if (needsApiKey === null) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--bg-primary)]">
        <div className="font-mono text-sm text-[var(--text-muted)]">Loading...</div>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {needsApiKey && (
        <ApiKeyModal
          onComplete={() => {
            setNeedsApiKey(false)
          }}
        />
      )}

      <Sidebar />

      <div className="flex flex-1 flex-col">
        <Titlebar onSettingsClick={() => {}} />
        <ChatView />
      </div>

      {/* Artifact panel placeholder */}
      <div className="flex w-[420px] flex-col border-l border-[var(--border)] bg-[var(--bg-secondary)]">
        <div className="flex h-12 items-center px-4 text-sm font-medium text-[var(--text-secondary)]">
          Artifacts
        </div>
        <div className="flex-1" />
      </div>
    </div>
  )
}

export default App
