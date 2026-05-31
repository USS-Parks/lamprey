import { useChatStore } from '@/stores/chat-store'
import { useUiStore } from '@/stores/ui-store'
import { useThemedIcon } from '@/lib/themed-icon'
import artifactsHeaderLight from '@assets/Lamprey Code Window Icon.png'
import artifactsHeaderDark from '@assets/Lamprey Code Window Icon Dark View.png'
import newChatLight from '@assets/Lamprey New Chat Icon.png'
import newChatDark from '@assets/Lamprey New Chat Icon Dark View.png'
import addFileLight from '@assets/Lamprey Add File Icon.png'
import addFileDark from '@assets/Lamprey Add File Icon Dark View.png'
import pluginsLight from '@assets/Lamprey Plugins Icon.png'
import pluginsDark from '@assets/Lamprey Plugins Icon Dark View.png'
import folderLight from '@assets/Lamprey Folder 1 Icon.png'
import folderDark from '@assets/Lamprey Folder 1 Dark View.png'

interface QuickAction {
  icon: string
  label: string
  description: string
  shortcut?: string
  onClick: () => void
}

interface RightPanelHomeProps {
  onCollapse: () => void
}

export function RightPanelHome({ onCollapse }: RightPanelHomeProps) {
  const createConversation = useChatStore((s) => s.createConversation)
  const seedComposeDraft = useUiStore((s) => s.seedComposeDraft)
  const openSettings = useUiStore((s) => s.openSettings)

  const artifactsHeaderIconUrl = useThemedIcon(artifactsHeaderLight, artifactsHeaderDark)
  const newChatIconUrl = useThemedIcon(newChatLight, newChatDark)
  const addFileIconUrl = useThemedIcon(addFileLight, addFileDark)
  const pluginsIconUrl = useThemedIcon(pluginsLight, pluginsDark)
  const folderIconUrl = useThemedIcon(folderLight, folderDark)

  const actions: QuickAction[] = [
    {
      icon: newChatIconUrl,
      label: 'New chat',
      description: 'Start a new conversation',
      shortcut: 'Ctrl+N',
      onClick: () => createConversation()
    },
    {
      icon: addFileIconUrl,
      label: 'Add file',
      description: 'Attach a file to your prompt',
      onClick: () => seedComposeDraft('')
    },
    {
      icon: pluginsIconUrl,
      label: 'Skills',
      description: 'Manage installed skills',
      onClick: openSettings
    },
    {
      icon: folderIconUrl,
      label: 'Memory',
      description: 'Browse stored memories',
      onClick: openSettings
    }
  ]

  return (
    <>
      <div className="flex h-12 items-center justify-between border-b border-[var(--border)] pl-3 pr-[28px] text-sm font-medium text-[var(--text-secondary)]">
        <span className="flex items-center gap-2">
          <img src={artifactsHeaderIconUrl} alt="" aria-hidden className="icon-asset h-9 w-9 object-contain" />
          Artifacts
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

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto pb-4 pl-4 pr-[28px] pt-4">
        <div className="grid grid-cols-2 gap-3">
          {actions.map((action) => (
            <button
              key={action.label}
              onClick={action.onClick}
              className="group flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-4 text-center transition-all hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-[var(--bg-tertiary)]"
            >
              <img
                src={action.icon}
                alt=""
                aria-hidden
                className="icon-asset h-[50px] w-[50px] object-contain transition-transform group-hover:scale-110"
              />
              <span className="text-[13px] font-medium text-[var(--text-primary)]">
                {action.label}
              </span>
              <span className="text-[11px] leading-tight text-[var(--text-muted)]">
                {action.description}
              </span>
              {action.shortcut && (
                <span className="mt-0.5 rounded bg-[var(--bg-secondary)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]">
                  {action.shortcut}
                </span>
              )}
            </button>
          ))}
        </div>

        <p className="px-2 pt-2 text-center text-[11px] leading-relaxed text-[var(--text-muted)]">
          HTML, SVG, Mermaid, or JSX artifacts open here when the assistant generates them.
        </p>
      </div>
    </>
  )
}
