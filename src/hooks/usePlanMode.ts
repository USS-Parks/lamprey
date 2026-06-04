import { useCallback } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { usePlanStore } from '@/stores/plan-store'

// Fluidity J2: tiny wrapper around the plan:enterMode / plan:exitMode IPC
// so callers (the Shift+Tab cycle, the legacy /plan slash command, future
// quick-action chips) don't have to re-thread the active conversation id
// through every call. Returns memoized enter/exit callbacks plus the live
// `active` flag so a consumer can render a label without subscribing to
// plan-store directly.

export function usePlanMode(): {
  active: boolean
  enter: () => Promise<boolean>
  exit: () => Promise<boolean>
  toggle: () => Promise<boolean>
} {
  const active = usePlanStore((s) => s.planModeActive ?? false)

  const enter = useCallback(async () => {
    const convId = useChatStore.getState().activeConversationId
    if (!convId) return false
    return usePlanStore.getState().enterPlanMode(convId)
  }, [])

  const exit = useCallback(async () => {
    const convId = useChatStore.getState().activeConversationId
    if (!convId) return false
    return usePlanStore.getState().exitPlanMode(convId)
  }, [])

  const toggle = useCallback(async () => {
    const isActive = usePlanStore.getState().planModeActive
    return isActive ? exit() : enter()
  }, [enter, exit])

  return { active, enter, exit, toggle }
}
