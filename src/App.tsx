import { useEffect, useRef, useState, useCallback } from 'react'
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
import { AsyncEventToast } from '@/components/chat/AsyncEventToast'
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

  // Track the chat workspace column's measured width so the card can
  // decide whether the empty right margin beside the centered chat
  // content is wide enough to fit a 180px floating card without
  // overlapping message bubbles. ResizeObserver re-fires on sidebar
  // resize / window resize / DPI change.
  const chatWorkspaceRef = useRef<HTMLDivElement>(null)
  const [chatWorkspaceWidth, setChatWorkspaceWidth] = useState(0)

  useEffect(() => {
    // The main app — and the chatWorkspaceRef div with it — doesn't render
    // until needsApiKey resolves out of `null`. Without this guard + dep,
    // the effect ran once at first commit (loading screen, ref=null), bailed,
    // and never re-ran when the main app actually mounted — so width stayed
    // 0 and the gutter check kept the card permanently hidden.
    if (needsApiKey === null) return
    const node = chatWorkspaceRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    setChatWorkspaceWidth(node.getBoundingClientRect().width)
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setChatWorkspaceWidth(entry.contentRect.width)
    })
    ro.observe(node)
    return () => ro.disconnect()
  }, [needsApiKey])

  // Card width tracks (rightPanelWidth - rail width). When the right
  // panel is expanded the chat workspace shrinks by exactly that delta;
  // setting the card to the same width makes the chat content area
  // identical in both states, so collapsing or expanding the panel
  // doesn't shift the input pill or any message bubble. ChatView gets
  // the same value as its `rightInset` so chat-column padding-right
  // and card width move together.
  const RAIL_WIDTH = 32
  const envCardWidth = Math.max(0, rightPanelWidth - RAIL_WIDTH)

  // Visibility check: the card only shows if the remaining chat content
  // area (chatColumn minus the card slot) is still wide enough to host
  // a usable dialogue. With padding-based recenter (ChatView pads its
  // chat-column by envCardWidth) the card no longer overlaps message
  // bubbles — so the gate is just "is the leftover chat area
  // workable?" instead of the old margin-overlap arithmetic.
  const CHAT_SURROUND_PADDING_X = 16 // chat surround `p-2` left + right
  const MIN_CHAT_CONTENT_WIDTH = 480
  const chatColumnWidth = Math.max(0, chatWorkspaceWidth - CHAT_SURROUND_PADDING_X)
  const chatHasRoomForEnvCard =
    chatColumnWidth > 0 && chatColumnWidth - envCardWidth >= MIN_CHAT_CONTENT_WIDTH
  // Single boolean the card animates around. Includes every "we don't
  // float in this mode" exclusion: narrow drawer mode, expanded right
  // panel (docked EnvironmentPanel owns Environment then), and not
  // enough chat-column width to host the card without squeezing chat.
  const shouldShowEnvCard = !isNarrow && rightPanelCollapsed && chatHasRoomForEnvCard

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

  // RAG ingest progress → forwarded to chat-store so rag-pending attachment
  // chips update live (queued → loading → chunking → embedding → ready).
  // The Library UI subscribes to the same channel separately; both
  // subscribers are independent, no fan-in conflict.
  useEffect(() => {
    if (!window.api?.rag?.document?.onProgress) return
    const unsubscribe = window.api.rag.document.onProgress((e: unknown) => {
      const evt = e as {
        jobId?: unknown
        documentId?: unknown
        phase?: unknown
        progress?: unknown
        chunkCount?: unknown
        error?: unknown
      }
      if (typeof evt?.jobId !== 'string' || typeof evt?.phase !== 'string') return
      useChatStore.getState()._updateRagAttachmentProgress({
        jobId: evt.jobId,
        documentId: typeof evt.documentId === 'string' ? evt.documentId : '',
        phase: evt.phase,
        progress: typeof evt.progress === 'number' ? evt.progress : 0,
        chunkCount: typeof evt.chunkCount === 'number' ? evt.chunkCount : undefined,
        error: typeof evt.error === 'string' ? evt.error : undefined
      })
    })
    return unsubscribe
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

        <div ref={chatWorkspaceRef} className="flex flex-1 flex-col">
          <SecurityBanner />
          <UpdateBanner />
          <div className="flex flex-1 overflow-hidden bg-[var(--bg-secondary)] p-2">
            <ChatView rightInset={shouldShowEnvCard ? envCardWidth : 0} />
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
      <AsyncEventToast />

      {/* Viewport-fixed floating overlay. Anchored to viewport coords so
          when the right panel expands the card stays put and retreats
          rightward as it fades — instead of being dragged leftward by a
          shrinking parent. The right panel mounts underneath it and is
          revealed as the card fades out. */}
      <FloatingEnvironmentCard visible={shouldShowEnvCard} width={envCardWidth} />

      <ToastContainer />
    </div>
  )
}

export default App
