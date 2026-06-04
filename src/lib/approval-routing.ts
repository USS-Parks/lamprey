// Fluidity J5: pure routing decision for tool-approval requests.
//
// The chip vs modal split:
//   - `destructive` risk → modal, always (the safety floor)
//   - first-time-this-session for the (server, tool) pair → modal (so the
//     user reads the full descriptor + args once before opting into the
//     lightweight chip)
//   - otherwise → chip
//
// `approvedSeen` is a renderer-session-level set of `${serverId}::${toolName}`
// keys mutated by App.tsx whenever a chip OR modal resolves with allow=true.
// Keeping it per-(server, tool) rather than per-server is conservative: a
// brand-new write-tier tool from a previously-approved server still gets
// the heavyweight confirmation the first time.

import type { ToolRisk } from './types'

export type ApprovalSurface = 'modal' | 'chip'

export interface ApprovalRoutingInput {
  serverId: string
  name: string
  risks: readonly ToolRisk[]
}

export interface ApprovalRoutingContext {
  approvedSeen: ReadonlySet<string>
}

export function approvalKey(serverId: string, name: string): string {
  return `${serverId}::${name}`
}

export function routeApproval(
  req: ApprovalRoutingInput,
  ctx: ApprovalRoutingContext
): ApprovalSurface {
  if (req.risks.includes('destructive')) return 'modal'
  if (!ctx.approvedSeen.has(approvalKey(req.serverId, req.name))) return 'modal'
  return 'chip'
}
