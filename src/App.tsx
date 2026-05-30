import { useEffect, useState, useCallback } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import { Titlebar } from '@/components/layout/Titlebar'
import { ChatView } from '@/components/chat/ChatView'
import { ArtifactPanel } from '@/components/artifacts/ArtifactPanel'
import { ApiKeyModal } from '@/components/settings/ApiKeyModal'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { ConfirmationModal } from '@/components/mcp/ConfirmationModal'
import { useChatStore } from '@/stores/chat-store'
import { useModelStore } from '@/stores/model-store'
import { useChat } from '@/hooks/useChat'
import { useMcp } from '@/hooks/useMcp'
import { useSkills } from '@/hooks/useSkills'
import type { McpConfirmationEvent } from '@/lib/types'

function App(): React.ReactElement {
  const [needsApiKey, setNeedsApiKey] = useState<boolean | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [artifactOpen, setArtifactOpen] = useState(false)
  const [artifactType, setArtifactType] = useState<string | null>(null)
  const [artifactSource, setArtifactSource] = useState<string | null>(null)
  const [confirmationEvent, setConfirmationEvent] = useState<McpConfirmationEvent | null>(null)
  const loadConversations = useChatStore((s) => s.loadConversations)
  const loadModels = useModelStore((s) => s.loadModels)

  // Wire IPC event listeners
  useChat()
  useMcp()
  useSkills()

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

      {settingsOpen && (
        <SettingsDialog onClose={() => setSettingsOpen(false)} />
      )}

      {confirmationEvent && (
        <ConfirmationModal
          event={confirmationEvent}
          onDismiss={() => setConfirmationEvent(null)}
        />
      )}

      <Sidebar />

      <div className="flex flex-1 flex-col">
        <Titlebar onSettingsClick={() => setSettingsOpen(true)} />
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
    </div>
  )
}

export default App
