import { useEffect, useState } from 'react'
import { usePlanStore } from '@/stores/plan-store'

// Track 2 / C3 — PlanModeBanner. Persistent yellow strip at the top of
// the chat view when the active conversation's plan_mode_active flag is
// on. The Exit button calls `plan:exitMode`, the model can flip the flag
// itself via the `exit_plan_mode` tool descriptor, and a live
// `plan:mode-changed` event keeps the renderer in sync either way.

interface PlanModeBannerProps {
  conversationId: string | null
}

export function PlanModeBanner({ conversationId }: PlanModeBannerProps) {
  const planModeActive = usePlanStore((s) => s.planModeActive)
  const storeConvId = usePlanStore((s) => s.conversationId)
  const loadForConversation = usePlanStore((s) => s.loadForConversation)
  const exitPlanMode = usePlanStore((s) => s.exitPlanMode)
  const applyModeChange = usePlanStore((s) => s.applyModeChange)
  const [exiting, setExiting] = useState(false)

  // Hydrate plan-mode state for the current conversation. The store
  // already loads on selectConversation in most flows, but the banner
  // mounts independently and may be the only consumer on plain replays.
  useEffect(() => {
    if (conversationId && storeConvId !== conversationId) {
      void loadForConversation(conversationId)
    }
  }, [conversationId, storeConvId, loadForConversation])

  // Subscribe to live mode-change events from the dispatcher's
  // enter/exit_plan_mode handlers. The subscription is window-wide; the
  // store reconciles against `conversationId` so a flip on a background
  // conversation does not flash the banner here.
  useEffect(() => {
    if (!window.api?.plan?.onModeChanged) return
    const unsubscribe = window.api.plan.onModeChanged(applyModeChange)
    return unsubscribe
  }, [applyModeChange])

  if (!conversationId) return null
  if (planModeActive !== true) return null

  const handleExit = async () => {
    setExiting(true)
    try {
      await exitPlanMode(conversationId)
    } finally {
      setExiting(false)
    }
  }

  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-[var(--warning)] bg-[var(--warning)]/15 px-3 py-1.5 text-[12px] text-[var(--text-primary)]"
    >
      <span
        aria-hidden
        className="inline-block h-2 w-2 shrink-0 rounded-full bg-[var(--warning)]"
      />
      <div className="min-w-0 flex-1">
        <span className="font-medium">Plan mode is on.</span>{' '}
        <span className="text-[var(--text-muted)]">
          Mutating tools (apply_patch, shell_command, destructive MCP) are blocked. Read-only
          tools still run.
        </span>
      </div>
      <button
        onClick={handleExit}
        disabled={exiting}
        className="shrink-0 rounded border border-[var(--warning)] bg-[var(--bg-primary)] px-2 py-0.5 text-[11px] font-medium text-[var(--warning)] hover:bg-[var(--warning)] hover:text-[var(--bg-primary)] disabled:opacity-50"
      >
        {exiting ? 'Exiting…' : 'Exit plan mode'}
      </button>
    </div>
  )
}
