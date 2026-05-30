import { useEffect, useState, useCallback } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import { Titlebar } from '@/components/layout/Titlebar'
import { ChatView } from '@/components/chat/ChatView'
import { ArtifactPanel } from '@/components/artifacts/ArtifactPanel'
import { ApiKeyModal } from '@/components/settings/ApiKeyModal'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { ConfirmationModal } from '@/components/mcp/ConfirmationModal'
import { ToastContainer } from '@/components/ui/Toast'
import { useChatStore } from '@/stores/chat-store'
import { useModelStore } from '@/stores/model-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useUiStore } from '@/stores/ui-store'
import { toast } from '@/stores/toast-store'
import { useChat } from '@/hooks/useChat'
import { useMcp } from '@/hooks/useMcp'
import { useSkills } from '@/hooks/useSkills'
import { useMemory } from '@/hooks/useMemory'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useShellSignals } from '@/hooks/useShellSignals'
import { UpdateBanner } from '@/components/ui/UpdateBanner'
import type { McpConfirmationEvent } from '@/lib/types'

function App(): React.ReactElement {
  const [needsApiKey, setNeedsApiKey] = useState<boolean | null>(null)
  const [artifactOpen, setArtifactOpen] = useState(false)
  const [artifactType, setArtifactType] = useState<string | null>(null)
  const [artifactSource, setArtifactSource] = useState<string | null>(null)
  const [confirmationEvent, setConfirmationEvent] = useState<McpConfirmationEvent | null>(null)
  const loadConversations = useChatStore((s) => s.loadConversations)
  const loadModels = useModelStore((s) => s.loadModels)
  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const settingsOpen = useUiStore((s) => s.settingsOpen)
  const closeSettings = useUiStore((s) => s.closeSettings)
  const openSettings = useUiStore((s) => s.openSettings)

  // Wire IPC event listeners + shortcuts
  useChat()
  useMcp()
  useSkills()
  useMemory()
  useKeyboardShortcuts()
  useShellSignals()

  const handleArtifactOpen = useCallback((type: string, source: string) => {
    setArtifactType(type)
    setArtifactSource(source)
    setArtifactOpen(true)
  }, [])

  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__openArtifact = handleArtifactOpen
    return () => {
      delete (window as unknown as Record<string, unknown>).__openArtifact
    }
  }, [handleArtifactOpen])

  useEffect(() => {
    if (!window.api) return
    window.api.mcp.onConfirmationRequired((e: unknown) => {
      setConfirmationEvent(e as McpConfirmationEvent)
    })
  }, [])

  useEffect(() => {
    if (!window.api) return
    window.api.chat.onError((e: { conversationId: string; error: string }) => {
      toast.error(e.error || 'Chat error')
    })
  }, [])

  useEffect(() => {
    const init = async () => {
      if (!window.api) {
        setNeedsApiKey(true)
        return
      }
      const result = await window.api.settings.hasApiKey()
      setNeedsApiKey(result.success ? !result.data : true)
      await Promise.all([loadConversations(), loadModels(), loadSettings()])
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

      {settingsOpen && <SettingsDialog onClose={closeSettings} />}

      {confirmationEvent && (
        <ConfirmationModal
          event={confirmationEvent}
          onDismiss={() => setConfirmationEvent(null)}
        />
      )}

      <Sidebar />

      <div className="flex flex-1 flex-col">
        <Titlebar onSettingsClick={openSettings} />
        <UpdateBanner />
        <ChatView />
      </div>

      {artifactOpen ? (
        <ArtifactPanel
          artifactType={artifactType}
          artifactSource={artifactSource}
          onClose={() => setArtifactOpen(false)}
        />
      ) : (
        <div className="flex w-[420px] flex-col border-l border-[var(--border)] bg-[var(--bg-secondary)]">
          <div className="flex h-12 items-center px-4 text-sm font-medium text-[var(--text-secondary)]">
            Artifacts
          </div>
          <div className="flex-1" />
        </div>
      )}

      <ToastContainer />
    </div>
  )
}

export default App
