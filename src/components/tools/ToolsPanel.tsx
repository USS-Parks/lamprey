import { useUiStore, type ToolId } from '@/stores/ui-store'
import { useThemedIcon } from '@/lib/themed-icon'
import addFileLight from '@assets/Lamprey Add File Icon.png'
import addFileDark from '@assets/Lamprey Add File Icon Dark View.png'
import autoReviewLight from '@assets/Lamprey Auto-Review Icon.png'
import autoReviewDark from '@assets/Lamprey Auto-Review Icon Dark View.png'
import chatWindowLight from '@assets/Lamprey Chat Window Icon.png'
import chatIconDark from '@assets/Lamprey Chat Icon Dark View.png'
import { FilesPanel } from './panels/FilesPanel'
import { SideChatPanel } from './panels/SideChatPanel'
import { BrowserPanel } from './panels/BrowserPanel'
import { ReviewPanel } from './panels/ReviewPanel'
import { TerminalPanel } from './panels/TerminalPanel'
import { EnvironmentPanel } from '@/components/workspace/EnvironmentPanel'
import { SourcesPanel } from '@/components/workspace/SourcesPanel'
import { ArtifactsPanel } from '@/components/workspace/ArtifactsPanel'

const TOOL_LABELS: Record<ToolId, string> = {
  files: 'Files',
  sidechat: 'Side chat',
  browser: 'Browser',
  review: 'Review',
  terminal: 'Terminal',
  environment: 'Environment',
  sources: 'Sources',
  artifacts: 'Artifacts'
}

function BrowserGlyph(): React.ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <path d="M12 3a14 14 0 0 1 0 18" />
      <path d="M12 3a14 14 0 0 0 0 18" />
    </svg>
  )
}

function TerminalGlyph(): React.ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <polyline points="7 9 10 12 7 15" />
      <line x1="13" y1="16" x2="17" y2="16" />
    </svg>
  )
}

function ToolHeaderIcon({ tool }: { tool: ToolId }): React.ReactElement {
  const filesIcon = useThemedIcon(addFileLight, addFileDark)
  const reviewIcon = useThemedIcon(autoReviewLight, autoReviewDark)
  const chatIcon = useThemedIcon(chatWindowLight, chatIconDark)

  switch (tool) {
    case 'files':
      return <img src={filesIcon} alt="" aria-hidden className="icon-asset h-7 w-7 object-contain" />
    case 'sidechat':
      return <img src={chatIcon} alt="" aria-hidden className="icon-asset h-7 w-7 object-contain" />
    case 'review':
      return <img src={reviewIcon} alt="" aria-hidden className="icon-asset h-7 w-7 object-contain" />
    case 'browser':
      return (
        <span className="flex h-7 w-7 items-center justify-center text-[var(--text-secondary)]">
          <BrowserGlyph />
        </span>
      )
    case 'terminal':
      return (
        <span className="flex h-7 w-7 items-center justify-center text-[var(--text-secondary)]">
          <TerminalGlyph />
        </span>
      )
    case 'environment':
      return (
        <span className="flex h-7 w-7 items-center justify-center text-[var(--text-secondary)]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="2" y="4" width="20" height="13" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        </span>
      )
    case 'sources':
      return (
        <span className="flex h-7 w-7 items-center justify-center text-[var(--text-secondary)]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 7l9-4 9 4-9 4-9-4z" />
            <path d="M3 12l9 4 9-4" />
            <path d="M3 17l9 4 9-4" />
          </svg>
        </span>
      )
    case 'artifacts':
      return (
        <span className="flex h-7 w-7 items-center justify-center text-[var(--text-secondary)]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <circle cx="6" cy="6" r="0.5" fill="currentColor" />
            <circle cx="8" cy="6" r="0.5" fill="currentColor" />
            <circle cx="10" cy="6" r="0.5" fill="currentColor" />
          </svg>
        </span>
      )
  }
}

function renderToolBody(tool: ToolId): React.ReactElement {
  switch (tool) {
    case 'files':
      return <FilesPanel />
    case 'sidechat':
      return <SideChatPanel />
    case 'browser':
      return <BrowserPanel />
    case 'review':
      return <ReviewPanel />
    case 'terminal':
      return <TerminalPanel />
    case 'environment':
      return <EnvironmentPanel />
    case 'sources':
      return <SourcesPanel />
    case 'artifacts':
      return <ArtifactsPanel />
  }
}

interface ToolsPanelProps {
  onCollapse: () => void
}

export function ToolsPanel({ onCollapse }: ToolsPanelProps) {
  const activeTool = useUiStore((s) => s.activeTool)
  const closeActiveTool = useUiStore((s) => s.closeActiveTool)

  if (!activeTool) return null

  return (
    <>
      <div className="flex h-12 items-center justify-between border-b border-[var(--border)] pl-3 pr-[28px] text-sm font-medium text-[var(--text-secondary)]">
        <span className="flex items-center gap-2">
          <ToolHeaderIcon tool={activeTool} />
          {TOOL_LABELS[activeTool]}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={closeActiveTool}
            title="Close tool"
            aria-label="Close tool"
            className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <button
            onClick={onCollapse}
            title="Collapse panel"
            aria-label="Collapse panel"
            className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>
      {renderToolBody(activeTool)}
    </>
  )
}
