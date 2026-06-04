// Fluidity J11: pure state machine for the right-panel collapsed flag.
//
// Each conversation has its own collapsed flag + a set of "trigger keys"
// (artifact sources, activeTool ids) whose auto-open the user has already
// refused. The rule:
//
//   - new conversation → collapsed (default)
//   - existing conversation → last-known state
//   - auto-open fires once per trigger key; if the user collapses while
//     that trigger is active, the key is marked dismissed and the same
//     trigger won't reopen until a different trigger fires

export interface RightPanelConvState {
  collapsed: boolean
  /** Trigger key that fired the most recent auto-open (or '__manual__'
   *  if the user expanded). Null when collapsed. */
  currentTrigger: string | null
  /** Trigger keys whose auto-open was dismissed by a user collapse.
   *  Same trigger will not re-open until a different key fires. */
  dismissed: string[]
}

export const NEW_CONV_DEFAULT: RightPanelConvState = {
  collapsed: true,
  currentTrigger: null,
  dismissed: []
}

export function getConvState(
  byConv: Readonly<Record<string, RightPanelConvState>>,
  conversationId: string | null
): RightPanelConvState {
  if (!conversationId) return { ...NEW_CONV_DEFAULT, collapsed: false }
  return byConv[conversationId] ?? NEW_CONV_DEFAULT
}

/** Auto-open driven by an artifact opening or a tool launching. Returns
 *  the next state for the conversation. Returns the input state unchanged
 *  when the trigger has been dismissed previously. */
export function tryAutoOpen(
  state: RightPanelConvState,
  triggerKey: string
): RightPanelConvState {
  if (!state.collapsed && state.currentTrigger === triggerKey) return state
  if (state.dismissed.includes(triggerKey)) return state
  return {
    collapsed: false,
    currentTrigger: triggerKey,
    dismissed: state.dismissed
  }
}

/** User clicked the collapse/expand toggle. `nextCollapsed=true` means
 *  the panel is closing; if there's a current trigger, mark it dismissed
 *  so the same one doesn't auto-reopen. */
export function applyUserToggle(
  state: RightPanelConvState,
  nextCollapsed: boolean
): RightPanelConvState {
  if (nextCollapsed) {
    const dismissed =
      state.currentTrigger && !state.dismissed.includes(state.currentTrigger)
        ? [...state.dismissed, state.currentTrigger]
        : state.dismissed
    return { collapsed: true, currentTrigger: null, dismissed }
  }
  return { collapsed: false, currentTrigger: '__manual__', dismissed: state.dismissed }
}
