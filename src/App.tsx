import { useEffect, useState, useCallback } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import { Titlebar } from '@/components/layout/Titlebar'
import { ChatView } from '@/components/chat/ChatView'
import { ArtifactPanel } from '@/components/artifacts/ArtifactPanel'
import { RightPanelHome } from '@/components/artifacts/RightPanelHome'
import { ApiKeyModal } from '@/components/settings/ApiKeyModal'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { ConfirmationModal } from '@/components/mcp/ConfirmationModal'
import { ToastContainer } from '@/components/ui/Toast'
import { useChatStore } from '@/stores/chat-store'
import { useModelStore } from '@/stores/model-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useAgentStore } from '@/stores/agent-store'
import { useUiStore, RIGHT_PANEL_BOUNDS } from '@/stores/ui-store'
import { toast } from '@/stores/toast-store'
import { useChat } from '@/hooks/useChat'
import { useMcp } from '@/hooks/useMcp'
import { useSkills } from '@/hooks/useSkills'
import { useMemory } from '@/hooks/useMemory'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useShellSignals } from '@/hooks/useShellSignals'
import { UpdateBanner } from '@/components/ui/UpdateBanner'
import { SecurityBanner } from '@/components/ui/SecurityBanner'
import { useThemedIcon } from '@/lib/themed-icon'
import artifactsPlaceholderLight from '@assets/Lamprey Code Window Icon.png'
import artifactsPlaceholderDark from '@assets/Lamprey Code Window Icon Dark View.png'
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
  const hydrateAgents = useAgentStore((s) => s.hydrate)
  const settingsOpen = useUiStore((s) => s.settingsOpen)
  const closeSettings = useUiStore((s) => s.closeSettings)
  const openSettings = useUiStore((s) => s.openSettings)
  const rightPanelCollapsed = useUiStore((s) => s.rightPanelCollapsed)
  const rightPanelWidth = useUiStore((s) => s.rightPanelWidth)
  const setRightPanelCollapsed = useUiStore((s) => s.setRightPanelCollapsed)
  const setRightPanelWidth = useUiStore((s) => s.setRightPanelWidth)
  const artifactsPlaceholderUrl = useThemedIcon(artifactsPlaceholderLight, artifactsPlaceholderDark)

  const handleRightResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = rightPanelWidth
      const onMove = (me: MouseEvent) => {
        const delta = startX - me.clientX
        const next = Math.max(
          RIGHT_PANEL_BOUNDS.min,
          Math.min(RIGHT_PANEL_BOUNDS.max, startWidth + delta)
        )
        setRightPanelWidth(next)
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
      }
      document.body.style.cursor = 'col-resize'
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [rightPanelWidth, setRightPanelWidth]
  )

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
    window.api.app.onError((e: { message: string }) => {
      toast.error(e.message)
    })
    window.api.app.onWarning((e: { message: string }) => {
      toast.warning(e.message)
    })
  }, [])

  useEffect(() => {
    const init = async () => {
      if (!window.api) {
        setNeedsApiKey(true)
        return
      }
      // Considered "configured" if ANY provider key is present.
      const providerList = await window.api.settings.listProviderKeys()
      if (providerList.success) {
        const anyKey = (providerList.data as Array<{ hasKey: boolean }>).some((p) => p.hasKey)
        setNeedsApiKey(!anyKey)
      } else {
        const fallback = await window.api.settings.hasApiKey()
        setNeedsApiKey(fallback.success ? !fallback.data : true)
      }
      await Promise.all([loadConversations(), loadModels(), loadSettings()])
      const s = useSettingsStore.getState().settings
      hydrateAgents(s.agentMode || 'single', s.agentRoster)
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
        <SecurityBanner />
        <UpdateBanner />
        <ChatView />
      </div>

      {rightPanelCollapsed ? (
        <div className="flex h-full w-8 flex-col items-center border-l border-[var(--border)] bg-[var(--bg-secondary)] py-2">
          <button
            onClick={() => setRightPanelCollapsed(false)}
            title="Expand artifacts panel"
            aria-label="Expand artifacts panel"
            className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <img src={artifactsPlaceholderUrl} alt="" aria-hidden className="icon-asset mt-2 h-[25px] w-[25px] object-contain opacity-60" />
        </div>
      ) : artifactOpen ? (
        <ArtifactPanel
          artifactType={artifactType}
          artifactSource={artifactSource}
          onClose={() => setArtifactOpen(false)}
        />
      ) : (
        <div
          className="relative flex flex-col border-l border-[var(--border)] bg-[var(--bg-secondary)]"
          style={{ width: rightPanelWidth, minWidth: rightPanelWidth }}
        >
          <div
            onMouseDown={handleRightResizeStart}
            onDoubleClick={() => setRightPanelWidth(RIGHT_PANEL_BOUNDS.default)}
            title="Drag to resize · double-click to reset"
            role="separator"
            aria-orientation="vertical"
            className="resize-handle-v resize-handle-v-left"
          />
          <RightPanelHome onCollapse={() => setRightPanelCollapsed(true)} />
        </div>
      )}

      <ToastContainer />
    </div>
  )
}

export default App
