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

const RIGOR_RE =
  /\b(audit|verif(?:y|ied|ication)|prove|proof|review|validate|validation|double[- ]?check|rigor(?:ous)?|certify|guarantee|sign[- ]?off)\b/i

const rigorConversations = new Set<string>()

/** Pure: does the prompt explicitly ask for verification-grade rigor? */
export function isRigorRequest(text: string): boolean {
  return RIGOR_RE.test(text ?? '')
}

/** Mark whether the current turn of a conversation runs the proof machinery. */
export function setProofRigor(conversationId: string, on: boolean): void {
  if (on) rigorConversations.add(conversationId)
  else rigorConversations.delete(conversationId)
}

/** True when the proof gate + change contracts should engage this turn. */
export function isProofRigorActive(conversationId: string): boolean {
  return rigorConversations.has(conversationId)
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
}
