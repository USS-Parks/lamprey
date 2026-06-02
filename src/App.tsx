import { useEffect, useState, useCallback } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import { Titlebar, SecondaryToolbar } from '@/components/layout/Titlebar'
import { ChatView } from '@/components/chat/ChatView'
import { ArtifactPanel } from '@/components/artifacts/ArtifactPanel'
import { RightPanelHome } from '@/components/artifacts/RightPanelHome'
import { ToolsPanel } from '@/components/tools/ToolsPanel'
import { QuickOpenPalette } from '@/components/tools/QuickOpenPalette'
import { WorktreeManagerModal } from '@/components/worktree/WorktreeManagerModal'
import { ApiKeyModal } from '@/components/settings/ApiKeyModal'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { ToolApprovalModal } from '@/components/tools/ToolApprovalModal'
import { MemoryModal } from '@/components/memory/MemoryModal'
import { ToastContainer } from '@/components/ui/Toast'
import { FloatingEnvironmentCard } from '@/components/workspace/FloatingEnvironmentCard'
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
import { useMediaQuery, NARROW_VIEWPORT_QUERY } from '@/hooks/useMediaQuery'
import { UpdateBanner } from '@/components/ui/UpdateBanner'
import { SecurityBanner } from '@/components/ui/SecurityBanner'
import { useThemedIcon } from '@/lib/themed-icon'
import artifactsPlaceholderLight from '@assets/Lamprey Code Window Icon.png'
import artifactsPlaceholderDark from '@assets/Lamprey Code Window Icon Dark View.png'
import type { ToolApprovalRequest } from '@/lib/types'

function App(): React.ReactElement {
  const [needsApiKey, setNeedsApiKey] = useState<boolean | null>(null)
  const [artifactOpen, setArtifactOpen] = useState(false)
  const [artifactType, setArtifactType] = useState<string | null>(null)
  const [artifactSource, setArtifactSource] = useState<string | null>(null)
  const [approvalRequest, setApprovalRequest] = useState<ToolApprovalRequest | null>(null)
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
  const activeTool = useUiStore((s) => s.activeTool)
  const artifactsPlaceholderUrl = useThemedIcon(artifactsPlaceholderLight, artifactsPlaceholderDark)
  const isNarrow = useMediaQuery(NARROW_VIEWPORT_QUERY)

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

  // When a tool opens while an artifact's WebContentsView is mounted, the
  // OS-level overlay would stay pinned to the (now-hidden) artifact slot.
  // Hide the view so the tool panel renders cleanly underneath.
  useEffect(() => {
    if (activeTool && window.api) {
      void window.api.artifact?.hide?.()
    }
  }, [activeTool])

  // Narrow-viewport drawer: Esc closes (collapses the right panel) so the
  // chat takes the full width back. Only active while the drawer is open.
  useEffect(() => {
    if (!isNarrow || rightPanelCollapsed) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const target = e.target
        if (target instanceof HTMLElement) {
          const tag = target.tagName
          if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
        }
        e.preventDefault()
        setRightPanelCollapsed(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isNarrow, rightPanelCollapsed, setRightPanelCollapsed])

  useEffect(() => {
    if (!window.api) return
    const unsubscribe = window.api.tools.onApprovalRequired((e: unknown) => {
      setApprovalRequest(e as ToolApprovalRequest)
    })
    return unsubscribe
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
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {needsApiKey && (
        <ApiKeyModal
          onComplete={() => {
            setNeedsApiKey(false)
          }}
        />
      )}

      {settingsOpen && <SettingsDialog onClose={closeSettings} />}

      <MemoryModal />

      {approvalRequest && (
        <ToolApprovalModal
          request={approvalRequest}
          onResolved={() => setApprovalRequest(null)}
        />
      )}

      <Titlebar onSettingsClick={openSettings} />

      {/* All three columns (Sidebar | Chat | RightPanel) sit flush below
          Row 1 of the Titlebar, forming one clean horizontal divider.
          SecondaryToolbar now lives at the top of the right panel only
          (suppressed when the right panel is collapsed or showing a
          transient ArtifactPanel). */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        <div className="flex flex-1 flex-col">
          <SecurityBanner />
          <UpdateBanner />
          <div className="flex flex-1 overflow-hidden bg-[var(--bg-secondary)] p-2">
            <ChatView />
          </div>
        </div>

        {/* On desktop the right panel is part of the flex row (rail when
            collapsed, full panel when expanded). On narrow viewports it's
            lifted out into a fixed slide-over drawer (see block below). */}
        {!isNarrow && rightPanelCollapsed && (
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
        )}
        {!isNarrow && !rightPanelCollapsed && activeTool && (
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
            <SecondaryToolbar onSettingsClick={openSettings} />
            <ToolsPanel onCollapse={() => setRightPanelCollapsed(true)} />
          </div>
        )}
        {!isNarrow && !rightPanelCollapsed && !activeTool && artifactOpen && (
          <ArtifactPanel
            artifactType={artifactType}
            artifactSource={artifactSource}
            onClose={() => setArtifactOpen(false)}
          />
        )}
        {!isNarrow && !rightPanelCollapsed && !activeTool && !artifactOpen && (
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
            <SecondaryToolbar onSettingsClick={openSettings} />
            <RightPanelHome onCollapse={() => setRightPanelCollapsed(true)} />
          </div>
        )}
      </div>

      {/* Narrow-viewport drawer. Slides in from the right with a backdrop
          when the right panel is "open" on narrow viewports. Doesn't render
          when collapsed (the chat takes full width); the user re-opens via
          the right-panel toggle in Titlebar row 1. */}
      {isNarrow && !rightPanelCollapsed && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
            onClick={() => setRightPanelCollapsed(true)}
            aria-hidden
          />
          <aside
            role="dialog"
            aria-label="Workspace panel"
            className="fixed bottom-0 right-0 top-0 z-50 flex flex-col border-l border-[var(--border)] bg-[var(--bg-secondary)] shadow-2xl"
            style={{
              width: Math.min(rightPanelWidth, window.innerWidth - 24),
              transition: 'transform 200ms ease-out',
              transform: 'translateX(0)'
            }}
          >
            <SecondaryToolbar onSettingsClick={openSettings} />
            {activeTool ? (
              <ToolsPanel onCollapse={() => setRightPanelCollapsed(true)} />
            ) : artifactOpen ? (
              <ArtifactPanel
                artifactType={artifactType}
                artifactSource={artifactSource}
                onClose={() => setArtifactOpen(false)}
              />
            ) : (
              <RightPanelHome onCollapse={() => setRightPanelCollapsed(true)} />
            )}
          </aside>
        </>
      )}

      <QuickOpenPalette />
      <WorktreeManagerModal />

      {/* Floating Environment card only shows when the right panel is
          collapsed to its rail. Expanding the panel (home pills, any tool,
          artifacts) hides the card seamlessly — the panel itself surfaces
          environment info from then on. Also hidden on narrow viewports
          where there's no real estate to float a 360px card. */}
      <FloatingEnvironmentCard
        hidden={!rightPanelCollapsed || isNarrow}
        rightInset={isNarrow ? 16 : 32}
      />

      <ToastContainer />
    </div>
  )
}

export default App
