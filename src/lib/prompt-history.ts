// Fluidity J1: pure helper for ChatInput's ↑/↓ prompt-history walker.
//
// State machine: `index === null` means the user is editing fresh text;
// `index >= 0` means they're browsing history (0 = most recent prompt,
// 1 = next older, ...). Entering history saves the in-progress draft so
// Esc (or walking back past the newest) restores it.
//
// Kept pure / framework-free so it can be unit-tested without a DOM.

export interface PromptHistoryState {
  /** null = not browsing; otherwise index into a most-recent-first list. */
  index: number | null
  /** Text the user had typed before entering history, restored on exit. */
  draft: string
}

export const emptyHistoryState: PromptHistoryState = { index: null, draft: '' }

export interface HistoryStep {
  state: PromptHistoryState
  text: string
}

/** Caller invariant: only fire when caret is on line 1 and there is no selection. */
export function historyUp(
  history: readonly string[],
  state: PromptHistoryState,
  currentText: string
): HistoryStep {
  if (history.length === 0) return { state, text: currentText }
  // First step into history — save current draft, jump to most recent.
  if (state.index === null) {
    return {
      state: { index: 0, draft: currentText },
      text: history[0]
    }
  }
  // Already at the oldest — stay put.
  const next = Math.min(state.index + 1, history.length - 1)
  return {
    state: { index: next, draft: state.draft },
    text: history[next]
  }
}

export function historyDown(
  history: readonly string[],
  state: PromptHistoryState
): HistoryStep {
  // Not browsing — nothing to do.
  if (state.index === null) return { state, text: '' }
  // Walking past the newest pops back to the saved draft.
  if (state.index === 0) {
    return {
      state: { index: null, draft: '' },
      text: state.draft
    }
  }
  const next = state.index - 1
  return {
    state: { index: next, draft: state.draft },
    text: history[next]
  }
}

/** Esc or send — restore draft and exit browsing. No-op when not browsing. */
export function historyReset(state: PromptHistoryState): HistoryStep {
  if (state.index === null) return { state, text: '' }
  return {
    state: { index: null, draft: '' },
    text: state.draft
  }
}
