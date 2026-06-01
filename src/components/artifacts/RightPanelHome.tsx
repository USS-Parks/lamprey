import { useUiStore, type ToolId } from '@/stores/ui-store'
import { useThemedIcon } from '@/lib/themed-icon'
import folderLight from '@assets/Lamprey Folder 1 Icon.png'
import folderDark from '@assets/Lamprey Folder 1 Dark View.png'
import chatLight from '@assets/Lamprey Chat Window Icon.png'
import chatDark from '@assets/Lamprey Chat Icon Dark View.png'
import workLocationLight from '@assets/Lamprey Work Location Icon.png'
import workLocationDark from '@assets/Lamprey Work Location Icon Dark View.png'
import codeWindowLight from '@assets/Lamprey Code Window Icon.png'
import codeWindowDark from '@assets/Lamprey Code Window Icon Dark View.png'
import codingLight from '@assets/Lamprey Coding Icon.png'
import codingDark from '@assets/Lamprey Coding Icon Dark View.png'
import fullAccessLight from '@assets/Lamprey Full Access Icon.png'
import fullAccessDark from '@assets/Lamprey Full Access Icon Dark View.png'

interface RightPanelHomeProps {
  onCollapse: () => void
}

interface Pill {
  id: ToolId
  label: string
  description: string
  iconLight: string
  iconDark: string
}

// 4 rounded pill subpanels, each one an entry point into the docked mode
// of the same name. Visual language matches the chat column (rounded-xl +
// border + bg-primary). Removed Memory and Add file cards entirely — the
// user has the chat composer + Skills sidebar + Memory modal for those.
export function RightPanelHome({ onCollapse }: RightPanelHomeProps): React.ReactElement {
  const setActiveTool = useUiStore((s) => s.setActiveTool)

  const folderIcon = useThemedIcon(folderLight, folderDark)
  const chatIcon = useThemedIcon(chatLight, chatDark)
  const workLocationIcon = useThemedIcon(workLocationLight, workLocationDark)
  const codeWindowIcon = useThemedIcon(codeWindowLight, codeWindowDark)
  const codingIcon = useThemedIcon(codingLight, codingDark)
  const fullAccessIcon = useThemedIcon(fullAccessLight, fullAccessDark)

  const pills: Array<Pill & { iconUrl: string }> = [
    {
      id: 'files',
      label: 'Files',
      description: 'Workspace tree, filter, preview',
      iconLight: folderLight,
      iconDark: folderDark,
      iconUrl: folderIcon
    },
    {
      id: 'sidechat',
      label: 'Side chat',
      description: 'Branch the current conversation',
      iconLight: chatLight,
      iconDark: chatDark,
      iconUrl: chatIcon
    },
    {
      id: 'browser',
      label: 'Browser',
      description: 'Embedded webview for docs and references',
      iconLight: workLocationLight,
      iconDark: workLocationDark,
      iconUrl: workLocationIcon
    },
    {
      id: 'artifacts',
      label: 'Artifacts',
      description: 'Generated HTML, SVG, Mermaid, JSX',
      iconLight: codeWindowLight,
      iconDark: codeWindowDark,
      iconUrl: codeWindowIcon
    },
    {
      id: 'terminal',
      label: 'Terminal',
      description: 'PowerShell, Git Bash, WSL, or cmd',
      iconLight: codingLight,
      iconDark: codingDark,
      iconUrl: codingIcon
    },
    {
      id: 'review',
      label: 'Review',
      description: 'Git status, diffs, stage and commit',
      iconLight: fullAccessLight,
      iconDark: fullAccessDark,
      iconUrl: fullAccessIcon
    }
  ]

  return (
    <>
      <div className="flex h-10 items-center justify-between border-b border-[var(--border)] pl-3 pr-2 text-[12px] font-medium text-[var(--text-secondary)]">
        <span>Workspace</span>
        <button
          onClick={onCollapse}
          title="Collapse panel"
          aria-label="Collapse panel"
          className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-2.5">
        {pills.map((pill) => (
          <button
            key={pill.id}
            type="button"
            onClick={() => setActiveTool(pill.id)}
            className="group flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-3 text-left transition-all hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-[var(--bg-tertiary)]"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center">
              <img
                src={pill.iconLight}
                alt=""
                aria-hidden
                className="themed-variant-light icon-asset h-11 w-11 object-contain transition-transform group-hover:scale-110"
              />
              <img
                src={pill.iconDark}
                alt=""
                aria-hidden
                className="themed-variant-dark icon-asset h-11 w-11 object-contain transition-transform group-hover:scale-110"
              />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[14px] font-medium text-[var(--text-primary)]">
                {pill.label}
              </span>
              <span className="text-[12px] leading-tight text-[var(--text-muted)]">
                {pill.description}
              </span>
            </span>
            <span className="shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </span>
          </button>
        ))}
      </div>
    </>
  )
}
