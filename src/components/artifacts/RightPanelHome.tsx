import { useChatStore } from '@/stores/chat-store'
import { useUiStore } from '@/stores/ui-store'
import { useThemedIcon } from '@/lib/themed-icon'
import { pickAndAttachFiles } from '@/lib/attach-file'
import artifactsHeaderLight from '@assets/Lamprey Code Window Icon.png'
import artifactsHeaderDark from '@assets/Lamprey Code Window Icon Dark View.png'
import addFileLight from '@assets/Lamprey Add File Icon.png'
import addFileDark from '@assets/Lamprey Add File Icon Dark View.png'
import folderLight from '@assets/Lamprey Folder 1 Icon.png'
import folderDark from '@assets/Lamprey Folder 1 Dark View.png'
import thinkingLight from '@assets/Lamprey Thinking Icon.png'
import thinkingDark from '@assets/Lamprey Thinking Icon Dark View.png'
import { ActivityFeed } from './ActivityFeed'
import { AddToolMenu } from '@/components/layout/AddToolMenu'

interface QuickAction {
  iconLight: string
  iconDark: string
  label: string
  description: string
  shortcut?: string
  onClick: () => void
}

interface RightPanelHomeProps {
  onCollapse: () => void
}

export function RightPanelHome({ onCollapse }: RightPanelHomeProps) {
  const openMemory = useUiStore((s) => s.openMemory)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const toolCalls = useChatStore((s) => s.toolCalls)

  const artifactsHeaderIconUrl = useThemedIcon(artifactsHeaderLight, artifactsHeaderDark)
  const thinkingIconUrl = useThemedIcon(thinkingLight, thinkingDark)

  const actions: QuickAction[] = [
    {
      iconLight: addFileLight,
      iconDark: addFileDark,
      label: 'Add file',
      description: 'Attach a file to your prompt',
      shortcut: 'Ctrl+U',
      onClick: () => void pickAndAttachFiles()
    },
    {
      iconLight: folderLight,
      iconDark: folderDark,
      label: 'Memory',
      description: 'Browse stored memories',
      shortcut: 'Ctrl+Shift+M',
      onClick: openMemory
    }
  ]

  const showActivity = isStreaming || toolCalls.length > 0

  return (
    <>
      <div className="flex h-12 items-center justify-between border-b border-[var(--border)] pl-3 pr-[28px] text-sm font-medium text-[var(--text-secondary)]">
        <span className="flex items-center gap-2">
          <img
            src={showActivity ? thinkingIconUrl : artifactsHeaderIconUrl}
            alt=""
            aria-hidden
            className={`icon-asset h-9 w-9 object-contain ${showActivity ? 'animate-pulse' : ''}`}
          />
          {showActivity ? 'Activity' : 'Artifacts'}
        </span>
        <button
          onClick={onCollapse}
          title="Collapse panel"
          aria-label="Collapse panel"
          className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {showActivity ? (
        <ActivityFeed />
      ) : (
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5 pt-5">
          <div className="flex justify-center">
            <AddToolMenu variant="panel" />
          </div>
          <div className="flex flex-col gap-4">
            {actions.map((action) => (
              <button
                key={action.label}
                onClick={action.onClick}
                className="group flex items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-4 text-left transition-all hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-[var(--bg-tertiary)]"
              >
                <span className="relative flex h-[50px] w-[50px] shrink-0 items-center justify-center">
                  <img
                    src={action.iconLight}
                    alt=""
                    aria-hidden
                    className="themed-variant-light icon-asset h-[50px] w-[50px] object-contain transition-transform group-hover:scale-110"
                  />
                  <img
                    src={action.iconDark}
                    alt=""
                    aria-hidden
                    className="themed-variant-dark icon-asset h-[50px] w-[50px] object-contain transition-transform group-hover:scale-110"
                  />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-[15px] font-medium text-[var(--text-primary)]">
                    {action.label}
                  </span>
                  <span className="text-[13px] leading-tight text-[var(--text-muted)]">
                    {action.description}
                  </span>
                </span>
                {action.shortcut && (
                  <span className="ml-auto shrink-0 self-start rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-muted)]">
                    {action.shortcut}
                  </span>
                )}
              </button>
            ))}
          </div>

          <p className="px-2 pt-2 text-center text-[13px] leading-relaxed text-[var(--text-muted)]">
            HTML, SVG, Mermaid, or JSX artifacts open here when the assistant generates them.
          </p>
        </div>
      )}
    </>
  )
}
