/**
 * WC-5 — Compute the ProofGateBanner display state from a message's
 * persisted `proofStatus` column (WC-4) with a legacy notice-text
 * fallback.
 *
 * 'trusted' / undefined-without-notice → null (no banner)
 * 'waived'  → 'waived' (muted chip)
 * 'untrusted' / 'blocked' → corresponding state
 * undefined-but-notice-present → 'untrusted' (legacy row)
 */
import type { Message } from '@/lib/types'

export type ProofBannerDisplayState = 'untrusted' | 'blocked' | 'waived'

export function computeProofBannerState(
  proofStatus: Message['proofStatus'],
  hasLegacyNotice: boolean
): ProofBannerDisplayState | null {
  if (proofStatus === 'trusted') return null
  if (proofStatus === 'waived') return 'waived'
  if (proofStatus === 'untrusted') return 'untrusted'
  if (proofStatus === 'blocked') return 'blocked'
  return hasLegacyNotice ? 'untrusted' : null
}
