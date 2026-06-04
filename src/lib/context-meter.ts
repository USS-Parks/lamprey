// Fluidity J8: pure helpers for the StatusLine context% slot.
//
// Context = tokens-already-spent / active-model-context-window. The status
// line shows the % and applies a warning tone past 70 / 90% so a long
// transcript visibly approaches the wall. Pure / framework-free so the
// rules are unit-testable without rendering.

export type ContextTone = 'neutral' | 'amber' | 'red'

/**
 * Compute the context-usage percentage. Returns null when the model's
 * context window is unknown so the StatusLine can hide the slot rather
 * than render `NaN%`. Clamped to [0, 100] — if the user manages to overrun
 * the window we cap at 100 (the wall is the wall).
 */
export function contextPercent(
  tokenSpend: number,
  contextWindow: number | undefined
): number | null {
  if (!contextWindow || contextWindow <= 0) return null
  if (!Number.isFinite(tokenSpend) || tokenSpend < 0) return 0
  return Math.max(0, Math.min(100, Math.round((tokenSpend / contextWindow) * 100)))
}

/**
 * Map a percentage to a warning tone. Amber kicks in at ≥ 70 (a hint to
 * compact or fork); red at ≥ 90 (you have minutes left, not hours).
 */
export function contextTone(percent: number): ContextTone {
  if (percent >= 90) return 'red'
  if (percent >= 70) return 'amber'
  return 'neutral'
}
