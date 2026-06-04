import { useEffect, useState } from 'react'
import { usePlanStore } from '@/stores/plan-store'

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

  useEffect(() => {
    if (conversationId && storeConvId !== conversationId) {
      void loadForConversation(conversationId)
    }
  }, [conversationId, storeConvId, loadForConversation])

  useEffect(() => {
    if (!window.api?.plan?.onModeChanged) return
    const unsubscribe = window.api.plan.onModeChanged(applyModeChange)
    return unsubscribe
  }, [applyModeChange])

  if (!conversationId || planModeActive !== true) return null

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
      className="sticky top-0 z-20 flex items-center gap-3 border-b border-[var(--warning)] bg-[var(--warning)]/20 px-3 py-2 text-[12px] text-[var(--text-primary)] shadow-sm transition-all duration-200"
    >
      <span
        aria-hidden
        className="inline-block h-2 w-2 shrink-0 rounded-full bg-[var(--warning)]"
      />
      <div className="min-w-0 flex-1">
        <span className="font-medium">Plan mode is on.</span>{' '}
        <span className="text-[var(--text-muted)]">
          Mutating tools are blocked. Review the plan, then execute when ready.
        </span>
      </div>
      <button
        onClick={handleExit}
        disabled={exiting}
        className="shrink-0 rounded border border-[var(--warning)] bg-[var(--bg-primary)] px-3 py-1 text-[11px] font-medium text-[var(--warning)] transition-colors hover:bg-[var(--warning)] hover:text-[var(--bg-primary)] disabled:opacity-50"
      >
        {exiting ? 'Exiting...' : 'Exit & Execute'}
      </button>
    </div>
  )
}
