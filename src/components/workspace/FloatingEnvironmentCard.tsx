import { useEffect, useRef, useState } from 'react'
import { useUiStore } from '@/stores/ui-store'
import { useAgentStore } from '@/stores/agent-store'
import { useEnvironment } from '@/hooks/useEnvironment'
import { useSources } from '@/hooks/useSources'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { toast } from '@/stores/toast-store'
import { WorkModePopover } from './WorkModePopover'
import { BranchPickerPopover } from './BranchPickerPopover'

// Card layout constants. The card is a true floating overlay anchored
// to the viewport (position: fixed), NOT to the chat surround — so
// when the right panel expands the card stays put and retreats
// rightward as it fades, instead of being dragged leftward.
//
// Width is provided by the parent and tracks (rightPanelWidth - rail)
// so the chat content area stays identical width whether the card is
// showing or the right panel is expanded — toggling between the two
// no longer shifts the input pill.
// From viewport top: clears the 36px (h-9) titlebar with a 20px gap.
export const ENV_CARD_TOP_OFFSET = 56
// From viewport right: rail is 32px wide; we sit 8px to its left.
export const ENV_CARD_RIGHT_OFFSET = 40
export const ENV_CARD_TRANSITION_MS = 220
// How far the card translates rightward during exit / starts left of
// during entry. Larger value = more visible "retreating toward the
// rail" motion. Was 12 — bumped to 20 for clearer handoff.
const ENV_CARD_TRANSLATE_PX = 20

type CardState = 'hidden' | 'entering' | 'visible' | 'exiting'

// Drives a four-phase transition so the card can play an enter or exit
// animation around React's mount/unmount. The component returns null while
// state === 'hidden', so the DOM is only present while the card is meant
// to be seen or animating.
function useCardState(visible: boolean, durationMs: number): CardState {
  const [state, setState] = useState<CardState>(visible ? 'visible' : 'hidden')
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)

    if (visible) {
      // hidden | exiting | entering → entering, then a paint later → visible.
      // The double-RAF gives the browser one frame to commit the entering
      // styles (opacity 0, translated) before we flip to visible — otherwise
      // the CSS transition has no "from" frame to interpolate from.
      setState((prev) => (prev === 'visible' ? 'visible' : 'entering'))
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null
          setState('visible')
        })
      })
    } else {
      // visible | entering | exiting → exiting now, → hidden after the
      // transition completes. We leave it mounted during exiting so the
      // CSS transition has somewhere to run.
      setState((prev) => (prev === 'hidden' ? 'hidden' : 'exiting'))
      if (durationMs <= 0) {
        setState('hidden')
      } else {
        timeoutRef.current = setTimeout(() => {
          timeoutRef.current = null
          setState('hidden')
        }, durationMs)
      }
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [visible, durationMs])

  return state
}

function GearGlyph(): React.ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </svg>
  )
}

function ChevronDownGlyph(): React.ReactElement {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function ChangesGlyph(): React.ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  )
}

function MonitorGlyph(): React.ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  )
}

function BranchGlyph(): React.ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )
}

function CommitGlyph(): React.ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" />
      <line x1="2" y1="12" x2="8" y2="12" />
      <line x1="16" y1="12" x2="22" y2="12" />
    </svg>
  )
}

interface CardRowProps {
  leading: React.ReactNode
  label: string
  trailing?: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  title?: string
  buttonRef?: React.Ref<HTMLButtonElement>
}

function CardRow({
  leading,
  label,
  trailing,
  onClick,
  disabled,
  title,
  buttonRef
}: CardRowProps): React.ReactElement {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => {
        if (disabled) return
        onClick?.()
      }}
      disabled={disabled}
      title={title}
      className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors ${
        disabled
          ? 'cursor-not-allowed text-[var(--text-muted)] opacity-60'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{leading}</span>
      <span className="flex-1 truncate">{label}</span>
      {trailing && <span className="shrink-0">{trailing}</span>}
    </button>
  )
}

interface FloatingEnvironmentCardProps {
  // The parent (App.tsx) computes this from: not narrow viewport, right
  // panel collapsed, and workspace wide enough to fit the card without
  // overlapping the chat dialogue. We never make this decision here —
  // the card just animates in / out around the boolean.
  visible: boolean
  // Pixel width the card should render at. Driven by the right panel's
  // expanded width minus the rail width, so the chat content stays the
  // same width whether the card is shown or the right panel is expanded
  // (no input-pill shift on toggle). The card itself doesn't know or
  // care why it's that wide — it just renders.
  width: number
}

export function FloatingEnvironmentCard({
  visible,
  width
}: FloatingEnvironmentCardProps): React.ReactElement | null {
  const openSettings = useUiStore((s) => s.openSettings)
  const setActiveTool = useUiStore((s) => s.setActiveTool)
  const agentMode = useAgentStore((s) => s.mode)
  const { snapshot, refresh } = useEnvironment()
  const { sources, groups } = useSources()
  const reduced = usePrefersReducedMotion()

  const containerRef = useRef<HTMLDivElement>(null)
  const workModeRef = useRef<HTMLButtonElement>(null)
  const branchRef = useRef<HTMLButtonElement>(null)
  const [workModeOpen, setWorkModeOpen] = useState(false)
  const [branchOpen, setBranchOpen] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [headerCollapsed, setHeaderCollapsed] = useState(false)

  const duration = reduced ? 0 : ENV_CARD_TRANSITION_MS
  const state = useCardState(visible, duration)

  // When the card starts exiting, drop focus out of it so screen readers
  // and keyboard users aren't trapped inside a region that's about to
  // disappear. Popovers anchored to card rows close for the same reason.
  useEffect(() => {
    if (state !== 'exiting') return
    setWorkModeOpen(false)
    setBranchOpen(false)
    const active = document.activeElement
    if (active instanceof HTMLElement && containerRef.current?.contains(active)) {
      active.blur()
    }
  }, [state])

  if (state === 'hidden') return null

  const handleCommitOrPush = async () => {
    if (committing) return
    if (!window.api?.review) {
      toast.error('Review API unavailable')
      return
    }
    if (snapshot.hasChanges) {
      const msg = window.prompt('Commit message:')
      if (!msg?.trim()) return
      setCommitting(true)
      const res = await window.api.review.commit({ message: msg.trim(), stageAll: true })
      setCommitting(false)
      if (!res.success) {
        toast.error(res.error ?? 'Commit failed')
        return
      }
      toast.success('Committed')
      void refresh()
    } else if (snapshot.ahead > 0) {
      setCommitting(true)
      const res = await window.api.review.push()
      setCommitting(false)
      if (!res.success) {
        toast.error(res.error ?? 'Push failed')
        return
      }
      toast.success('Pushed')
      void refresh()
    }
  }

  const commitDisabled = !snapshot.hasChanges && snapshot.ahead === 0
  const commitLabel = snapshot.hasChanges
    ? 'Commit'
    : snapshot.ahead > 0
    ? `Push (${snapshot.ahead} ahead)`
    : 'Commit or push'
  const workModeLabel = agentMode === 'multi' ? 'Pipeline' : 'Local'

  const settled = state === 'visible'
  const interactive = settled
  const easing = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

  const motionStyle: React.CSSProperties = reduced
    ? {
        opacity: settled ? 1 : 0,
        transition: `opacity 80ms linear`
      }
    : {
        opacity: settled ? 1 : 0,
        // Retreats rightward on exit (toward where the rail / expanding
        // right panel sits) and slides in from the right on entry. The
        // viewport-fixed positioning means the chat surround shrinking
        // can't drag the card leftward — it stays put and fades.
        transform: settled
          ? 'translateX(0) scale(1)'
          : `translateX(${ENV_CARD_TRANSLATE_PX}px) scale(0.98)`,
        transformOrigin: 'top right',
        transition: `opacity ${duration}ms ${easing}, transform ${duration}ms ${easing}`
      }

  return (
    <>
      <div
        ref={containerRef}
        className="pointer-events-auto fixed z-40 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-2 shadow-xl"
        style={{
          top: ENV_CARD_TOP_OFFSET,
          right: ENV_CARD_RIGHT_OFFSET,
          width,
          pointerEvents: interactive ? 'auto' : 'none',
          ...motionStyle
        }}
        role="region"
        aria-label="Environment"
        aria-hidden={interactive ? undefined : true}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-2.5 py-2">
          <button
            type="button"
            onClick={() => setHeaderCollapsed((v) => !v)}
            className="flex flex-1 items-center gap-1 text-[13px] font-medium text-[var(--text-primary)]"
            aria-expanded={!headerCollapsed}
          >
            <span>Environment</span>
            <span
              className={`text-[var(--text-muted)] transition-transform ${
                headerCollapsed ? '' : 'rotate-90'
              }`}
            >
              <svg
                width="10"
                height="10"
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
          {(snapshot.additions > 0 || snapshot.deletions > 0) && headerCollapsed && (
            <span className="font-mono text-[11px]">
              <span className="text-green-500">+{snapshot.additions}</span>{' '}
              <span className="text-red-500">-{snapshot.deletions}</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => openSettings()}
            title="Settings"
            aria-label="Settings"
            className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            <GearGlyph />
          </button>
        </div>

        {!headerCollapsed && (
          <>
            <CardRow
              leading={<ChangesGlyph />}
              label="Changes"
              trailing={
                <span className="font-mono text-[11px]">
                  <span className="text-green-500">+{snapshot.additions}</span>{' '}
                  <span className="text-red-500">-{snapshot.deletions}</span>
                </span>
              }
              onClick={() => setActiveTool('review')}
            />
            <CardRow
              buttonRef={workModeRef}
              leading={<MonitorGlyph />}
              label={workModeLabel}
              trailing={<ChevronDownGlyph />}
              onClick={() => setWorkModeOpen((v) => !v)}
            />
            <CardRow
              buttonRef={branchRef}
              leading={<BranchGlyph />}
              label={snapshot.branch ?? 'detached HEAD'}
              trailing={<ChevronDownGlyph />}
              onClick={() => setBranchOpen((v) => !v)}
              title={
                snapshot.ahead || snapshot.behind
                  ? `↑${snapshot.ahead} ↓${snapshot.behind}`
                  : undefined
              }
            />
            <CardRow
              leading={<CommitGlyph />}
              label={commitLabel}
              onClick={() => void handleCommitOrPush()}
              disabled={commitDisabled || committing}
            />

            <div className="my-2 border-t border-[var(--border)]" aria-hidden />

            <div className="px-2.5 pb-1 pt-1 text-[12px] font-medium text-[var(--text-secondary)]">
              Sources
            </div>
            {sources.length === 0 ? (
              <div className="px-2.5 pb-2 text-[12px] text-[var(--text-muted)]">
                No sources yet
              </div>
            ) : (
              <div className="max-h-[200px] overflow-y-auto pb-1.5">
                {(['files', 'skills', 'memory', 'mcp'] as const).map((groupKey) => {
                  const group = groups[groupKey]
                  if (group.length === 0) return null
                  const labels = {
                    files: 'Files',
                    skills: 'Skills',
                    memory: 'Memory',
                    mcp: 'MCP servers'
                  }
                  return (
                    <div key={groupKey}>
                      <div className="px-2.5 pb-0.5 pt-1.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                        {labels[groupKey]}
                      </div>
                      {group.map((item) => (
                        <div
                          key={item.id}
                          className="group flex items-center gap-2.5 px-2.5 py-1.5 text-[12px] text-[var(--text-secondary)]"
                        >
                          <span className="min-w-0 flex-1 truncate">{item.title}</span>
                          {item.subtitle && (
                            <span className="shrink-0 truncate font-mono text-[10px] text-[var(--text-muted)]">
                              {item.subtitle}
                            </span>
                          )}
                          {item.onRemove && (
                            <button
                              type="button"
                              onClick={item.onRemove}
                              aria-label={`Remove ${item.title}`}
                              className="rounded p-0.5 text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--text-primary)] group-hover:opacity-100"
                            >
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden
                              >
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      <WorkModePopover
        open={workModeOpen}
        onClose={() => setWorkModeOpen(false)}
        anchorRef={workModeRef}
      />
      <BranchPickerPopover
        open={branchOpen}
        onClose={() => setBranchOpen(false)}
        anchorRef={branchRef}
        onChanged={() => void refresh()}
      />
    </>
  )
}
