// HY2 — per-conversation lazy tool-surface state.
//
// When `settings.toolSurface === 'lazy'`, chat dispatch sends the model the
// core tools + `tool_search`. As the model unlocks tools via `tool_search`,
// their names accumulate here so subsequent rounds (and turns) of the SAME
// conversation include them. State is process-local and ephemeral — it is not
// persisted; a fresh app launch starts every conversation at the core set,
// which is correct (the model re-discovers what it needs cheaply).
//
// Downgrade path (FC-10-style, surface-scoped): if a model repeatedly emits
// malformed `tool_search` calls (no usable query), the conversation is pinned
// to the full catalog so a model that can't drive the round-trip still works.

/** Malformed `tool_search` calls before a conversation falls back to full. */
export const MALFORMED_SEARCH_DOWNGRADE_THRESHOLD = 3

const unlocked = new Map<string, Set<string>>()
const lazyActive = new Set<string>()
const downgraded = new Set<string>()
const malformedSearches = new Map<string, number>()

/** Mark the lazy surface as active for a conversation (no-op if downgraded). */
export function activateLazySurface(conversationId: string): void {
  if (!downgraded.has(conversationId)) lazyActive.add(conversationId)
}

/** True when this conversation's dispatch should rebuild the lazy surface. */
export function isLazyActive(conversationId: string): boolean {
  return lazyActive.has(conversationId)
}

/** True when this conversation has been pinned to the full catalog. */
export function isSurfaceDowngraded(conversationId: string): boolean {
  return downgraded.has(conversationId)
}

/** Add resolved tool names to the conversation's unlocked set. */
export function unlockTools(conversationId: string, names: string[]): void {
  if (!names || names.length === 0) return
  let set = unlocked.get(conversationId)
  if (!set) {
    set = new Set<string>()
    unlocked.set(conversationId, set)
  }
  for (const n of names) set.add(n)
}

/** Snapshot of the conversation's unlocked tool names. */
export function getUnlockedTools(conversationId: string): string[] {
  return [...(unlocked.get(conversationId) ?? [])]
}

/**
 * Record a malformed `tool_search` call. At the threshold the conversation is
 * downgraded to the full catalog (lazy deactivated). Returns the new count.
 */
export function recordMalformedSearch(conversationId: string): number {
  const n = (malformedSearches.get(conversationId) ?? 0) + 1
  malformedSearches.set(conversationId, n)
  if (n >= MALFORMED_SEARCH_DOWNGRADE_THRESHOLD) {
    downgraded.add(conversationId)
    lazyActive.delete(conversationId)
  }
  return n
}

/** Drop all lazy-surface state for a conversation (call on delete). */
export function clearToolUnlockState(conversationId: string): void {
  unlocked.delete(conversationId)
  lazyActive.delete(conversationId)
  downgraded.delete(conversationId)
  malformedSearches.delete(conversationId)
}

/** Test-only reset of the entire module state. */
export function __resetToolUnlockStateForTesting(): void {
  unlocked.clear()
  lazyActive.clear()
  downgraded.clear()
  malformedSearches.clear()
}
