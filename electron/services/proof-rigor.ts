// HY5 — proof-gate rigor scoping (the "Split" decision).
//
// L8's adaptive router is left untouched: large tasks still fan out to the
// multi-agent pipeline. What HY5 changes is *when the heavyweight proof
// machinery engages* — the change-contract synthesis (WC-3) and the proof-gate
// trust evaluation + the user-facing "untrusted" notice (M5/WC-5). On a casual
// single-agent turn that machinery added boilerplate to the reply and cost a
// receipts scan for no benefit; now it engages only on RIGOR turns.
//
// A turn is rigor when ANY of:
//   * the user asked for it (audit / verify / prove / review / validate / …),
//   * the turn dispatched multi-agent (the pipeline implies rigor), or
//   * settings pin `proofGate: 'always'`.
// Default (`proofGate: 'rigor'`, or unset) means rigor turns only.
//
// CR-5 (Cogency Restore Phase, 2026-06-09) — gates the proof machinery on
// `rigor && mutation_attempted`. The LL_SMOKE_PLAYBOOK confirmed F4: on
// multi-dispatch turns where no mutation happens, v0.11.0/v0.11.1 fired
// "Untrusted completion" pills despite no apply_patch or shell_command-write.
// CR-5 keeps the rigor signal intact but additionally requires a mutating tool
// to have been attempted before the gate engages. Plan-mode turns naturally
// pass through this gate (mutations are blocked there).

const RIGOR_RE =
  /\b(audit|verif(?:y|ied|ication)|prove|proof|review|validate|validation|double[- ]?check|rigor(?:ous)?|certify|guarantee|sign[- ]?off)\b/i

const rigorConversations = new Set<string>()
const mutationAttemptedConversations = new Set<string>()

let rigorRequiresMutation = true

/** Pure: does the prompt explicitly ask for verification-grade rigor? */
export function isRigorRequest(text: string): boolean {
  return RIGOR_RE.test(text ?? '')
}

/** Mark whether the current turn of a conversation runs the proof machinery. */
export function setProofRigor(conversationId: string, on: boolean): void {
  if (on) rigorConversations.add(conversationId)
  else rigorConversations.delete(conversationId)
}

/** True when the rigor signal alone is set for this conversation. CR-5: the
 *  proof gate now consumes `shouldEngageProofGate` (below) which AND-combines
 *  this with `hasMutationAttempted`. Kept exported for callers that want the
 *  pre-CR-5 semantics explicitly. */
export function isProofRigorActive(conversationId: string): boolean {
  return rigorConversations.has(conversationId)
}

/** CR-5 — flag that this conversation has attempted a mutating tool call this
 *  turn. Called from the chat tool-call dispatcher right after the descriptor
 *  is identified as mutating. */
export function markMutationAttempted(conversationId: string): void {
  mutationAttemptedConversations.add(conversationId)
}

/** CR-5 — true if at least one mutating tool call was attempted on this turn. */
export function hasMutationAttempted(conversationId: string): boolean {
  return mutationAttemptedConversations.has(conversationId)
}

/** CR-5 — toggle whether `shouldEngageProofGate` requires mutation_attempted in
 *  addition to rigor. Default true (the CR-5 fix). Set false to restore the
 *  v0.11.0/v0.11.1 behavior. Wired to `settings.rigorRequiresMutation`. */
export function setRigorRequiresMutation(value: boolean): void {
  rigorRequiresMutation = value
}

export function isRigorRequiresMutation(): boolean {
  return rigorRequiresMutation
}

/**
 * CR-5 — the combined predicate the proof gate + implicit-contract synthesis
 * consume in chat.ts. Rule:
 *   - if `rigorRequiresMutation` is false → behaves like `isProofRigorActive`
 *     (escape hatch preserving pre-CR-5 behavior)
 *   - else → rigor signal AND at least one mutating tool call attempted
 *
 * Plan mode handling is implicit: the plan-mode gate in chat.ts blocks
 * mutating descriptors before they reach this code, so plan-mode turns
 * never flip `hasMutationAttempted` and the predicate stays false.
 */
export function shouldEngageProofGate(conversationId: string): boolean {
  if (!rigorRequiresMutation) return isProofRigorActive(conversationId)
  return isProofRigorActive(conversationId) && hasMutationAttempted(conversationId)
}

/** Resolve the effective rigor decision for a turn. */
export function resolveProofRigor(input: {
  proofGateMode?: string
  dispatchKind?: 'single' | 'multi'
  content: string
}): boolean {
  if (input.proofGateMode === 'always') return true
  if (input.proofGateMode === 'off') return false
  return input.dispatchKind === 'multi' || isRigorRequest(input.content)
}

export function __resetProofRigorForTesting(): void {
  rigorConversations.clear()
  mutationAttemptedConversations.clear()
  rigorRequiresMutation = true
}
