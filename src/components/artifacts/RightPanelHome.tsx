import { useUiStore, type ToolId } from '@/stores/ui-store'
import { usePlanStore } from '@/stores/plan-store'
import folderIcon from '@assets/Lamprey Worktree Icon.png'
import chatIcon from '@assets/Lamprey Chat Window Icon.png'
import workLocationIcon from '@assets/Lamprey Work Location Icon.png'
import codeWindowIcon from '@assets/Lamprey Code Window Icon.png'
import codingIcon from '@assets/Lamprey Coding Icon.png'
import fullAccessIcon from '@assets/Lamprey Full Access Icon.png'
import planIcon from '@assets/Lamprey Plan Icon.png'
import backgroundIcon from '@assets/Lamprey Background Tasks Icon.png'

interface RightPanelHomeProps {
  onCollapse: () => void
}

interface Pill {
  id: ToolId
  label: string
  description: string
  icon: string
  iconSizeClass?: string
}

// 4 rounded pill subpanels, each one an entry point into the docked mode
// of the same name. Visual language matches the chat column (rounded-xl +
// border + bg-primary). Removed Memory and Add file cards entirely — the
// user has the chat composer + Skills sidebar + Memory modal for those.
export function RightPanelHome({ onCollapse }: RightPanelHomeProps): React.ReactElement {
  const setActiveTool = useUiStore((s) => s.setActiveTool)
  const planSnapshot = usePlanStore((s) => s.snapshot)
  const planModeActive = usePlanStore((s) => s.planModeActive)
  const planState: 'idle' | 'ready' | 'gated' = planModeActive
    ? 'gated'
    : planSnapshot && planSnapshot.steps.length > 0
      ? 'ready'
      : 'idle'

  const pills: Pill[] = [
    {
      id: 'files',
      label: 'Files',
      description: 'Workspace tree, filter, preview',
      icon: folderIcon
    },
    {
      id: 'sidechat',
      label: 'Side chat',
      description: 'Branch the current conversation',
      icon: chatIcon
    },
    {
      id: 'browser',
      label: 'Browser',
      description: 'Embedded webview for docs and references',
      icon: workLocationIcon
    },
    {
      id: 'artifacts',
      label: 'Artifacts',
      description: 'Generated HTML, SVG, Mermaid, JSX',
      icon: codeWindowIcon
    },
    {
      id: 'terminal',
      label: 'Terminal',
      description: 'PowerShell, Git Bash, WSL, or cmd',
      icon: codingIcon
    },
    {
      id: 'review',
      label: 'Review',
      description: 'Git status, diffs, stage and commit',
      icon: fullAccessIcon
    },
    {
      id: 'plan',
      label: 'Plan',
      description: 'Plan goals checklist, approve or reject the gate',
      icon: planIcon
    },
    {
      id: 'background',
      label: 'Background tasks',
      description: 'Live agents, tool calls, wakeups, and scheduled jobs',
      icon: backgroundIcon
    }
  ]

  return (
    <>
      <div className="flex h-10 items-center justify-between pl-3 pr-2 text-[12px] font-medium text-[var(--text-secondary)]">
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

      <div className="flex flex-1 flex-col gap-2 overflow-hidden p-2.5">
        {pills.map((pill) => {
          const isPlan = pill.id === 'plan'
          const planSignal = isPlan && planState !== 'idle'
          const planRingClass =
            planState === 'gated'
              ? 'ring-2 ring-[var(--warning)]/60 shadow-[0_0_18px_-2px_var(--warning)]'
              : 'ring-2 ring-[var(--accent)]/50 shadow-[0_0_18px_-2px_var(--accent)]'
          const planAccentText =
            planState === 'gated' ? 'text-[var(--warning)]' : 'text-[var(--accent)]'
          const planAccentBg =
            planState === 'gated' ? 'bg-[var(--warning)]' : 'bg-[var(--accent)]'
          const planStatusText =
            planState === 'gated'
              ? `${planSnapshot?.totals.done ?? 0}/${planSnapshot?.totals.total ?? 0} · gated · awaiting approval`
              : `${planSnapshot?.totals.done ?? 0}/${planSnapshot?.totals.total ?? 0} ready to view`
          return (
            <button
              key={pill.id}
              type="button"
              onClick={() => setActiveTool(pill.id)}
              className={`group flex min-h-[68px] shrink-0 items-center gap-3 rounded-xl border border-[var(--panel-border)] bg-[var(--bg-primary)] p-3 text-left transition-all hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-[var(--bg-tertiary)] ${
                planSignal ? planRingClass : ''
              }`}
              aria-label={
                planSignal
                  ? `${pill.label} — ${planStatusText}`
                  : pill.label
              }
            >
              <span className={`relative flex ${pill.iconSizeClass ?? 'h-11 w-11'} shrink-0 items-center justify-center`}>
                <img
                  src={pill.icon}
                  alt=""
                  aria-hidden
                  className={`icon-asset ${pill.iconSizeClass ?? 'h-11 w-11'} object-contain transition-transform group-hover:scale-110`}
                />
                {planSignal && (
                  <span
                    aria-hidden
                    className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ${planAccentBg} animate-pulse ring-2 ring-[var(--panel-bg)]`}
                  />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[14px] font-medium text-[var(--text-primary)]">
                  {pill.label}
                </span>
                <span className="truncate text-[12px] leading-tight text-[var(--text-muted)]">
                  {pill.description}
                </span>
                {planSignal && (
                  <span className={`mt-1 flex items-center gap-1.5 text-[11px] font-medium ${planAccentText}`}>
                    <span
                      aria-hidden
                      className={`h-1.5 w-1.5 rounded-full ${planAccentBg} animate-pulse`}
                    />
                    {planStatusText}
                  </span>
                )}
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
          )
        })}
      </div>
    </>
  )
}
