import { BrowserWindow } from 'electron'
import type { ToolRisk } from './tool-registry'

// Permission and approval service. Driven by descriptor risk metadata; works
// for any tool the registry flags as requiresApproval (and additionally any
// tool with one of the GATING_RISKS below).
//
// Three policy scopes:
//   - 'once'         — answer this single call, do not persist.
//   - 'conversation' — sticky for (toolId, conversationId) until app restart.
//   - 'always'       — sticky for toolId globally until app restart.
//
// KNOWN GAP: persistence to disk is not implemented. The in-memory caches
// reset on every app launch. Sticky 'always' decisions therefore do not
// survive a restart yet.

export type ApprovalScope = 'once' | 'conversation' | 'always'
export type ApprovalDecision = 'allow' | 'deny'

export interface ToolApprovalRequest {
  callId: string
  toolId: string
  name: string
  serverId: string
  providerKind: 'native' | 'mcp' | 'plugin'
  risks: ToolRisk[]
  args: Record<string, unknown>
  conversationId?: string
}

export interface ToolApprovalResponse {
  callId: string
  decision: ApprovalDecision
  scope: ApprovalScope
}

const APPROVAL_TIMEOUT_MS = 30_000

// Risks that, even without descriptor.requiresApproval, cause chat.ts to route
// through this service. Pure 'read' and 'write' alone do NOT gate (memory_add,
// update_plan are local writes); 'network', 'destructive', and 'secret' do.
export const GATING_RISKS: ReadonlySet<ToolRisk> = new Set([
  'network',
  'destructive',
  'secret'
])

/** True if a descriptor with these risks should pass through requestApproval. */
export function shouldGateOnRisks(risks: ToolRisk[]): boolean {
  return risks.some((r) => GATING_RISKS.has(r))
}

class PermissionsService {
  private globalPolicies = new Map<string, ApprovalDecision>()
  private conversationPolicies = new Map<string, Map<string, ApprovalDecision>>()
  // Per-RISK policies (separate from per-tool). Set by request_permissions
  // when the user approves a scope; consulted by requestApproval so granting
  // "network" unlocks every tool that carries the network risk, not just one.
  private globalRiskPolicies = new Map<ToolRisk, ApprovalDecision>()
  private conversationRiskPolicies = new Map<string, Map<ToolRisk, ApprovalDecision>>()
  private pending = new Map<string, (response: ToolApprovalResponse) => void>()

  /**
   * Resolve approval for a tool call. Returns synchronously when a sticky
   * policy applies; otherwise dispatches an approval request to the UI and
   * waits for the user, or auto-denies after APPROVAL_TIMEOUT_MS.
   *
   * Policy precedence:
   *   1. Per-tool global → per-tool conversation (existing).
   *   2. Per-risk policies — deny wins, then allow if EVERY gating risk
   *      requested is covered by an allow policy.
   *   3. Ask the user.
   *
   * No active window → default 'deny' for safety (headless test runs, app
   * shutdown mid-request, etc.).
   */
  async requestApproval(req: ToolApprovalRequest): Promise<ApprovalDecision> {
    const stickyGlobal = this.globalPolicies.get(req.toolId)
    if (stickyGlobal) return stickyGlobal

    if (req.conversationId) {
      const convMap = this.conversationPolicies.get(req.conversationId)
      const stickyConv = convMap?.get(req.toolId)
      if (stickyConv) return stickyConv
    }

    // Per-risk policy check. Conversation policies win over global on a tie.
    const gatingRisks = req.risks.filter((r) => GATING_RISKS.has(r))
    if (gatingRisks.length > 0) {
      const convRiskMap = req.conversationId
        ? this.conversationRiskPolicies.get(req.conversationId)
        : undefined
      const riskDecision = (r: ToolRisk): ApprovalDecision | undefined =>
        convRiskMap?.get(r) ?? this.globalRiskPolicies.get(r)
      if (gatingRisks.some((r) => riskDecision(r) === 'deny')) return 'deny'
      if (gatingRisks.every((r) => riskDecision(r) === 'allow')) return 'allow'
    }

    return await this.askUser(req)
  }

  /**
   * Set a sticky policy for a single risk category. Used by request_permissions
   * after the user grants a scope, and by the future Permissions settings page.
   * Pass `null` to clear.
   */
  setRiskPolicy(
    risk: ToolRisk,
    scope: 'conversation' | 'always',
    decision: ApprovalDecision | null,
    conversationId?: string
  ): void {
    if (scope === 'always') {
      if (decision === null) this.globalRiskPolicies.delete(risk)
      else this.globalRiskPolicies.set(risk, decision)
      return
    }
    if (!conversationId) return
    let convMap = this.conversationRiskPolicies.get(conversationId)
    if (decision === null) {
      convMap?.delete(risk)
      return
    }
    if (!convMap) {
      convMap = new Map()
      this.conversationRiskPolicies.set(conversationId, convMap)
    }
    convMap.set(risk, decision)
  }

  getRiskPolicy(
    risk: ToolRisk,
    conversationId?: string
  ): { scope: 'conversation' | 'always'; decision: ApprovalDecision } | null {
    if (conversationId) {
      const conv = this.conversationRiskPolicies.get(conversationId)?.get(risk)
      if (conv) return { scope: 'conversation', decision: conv }
    }
    const glob = this.globalRiskPolicies.get(risk)
    if (glob) return { scope: 'always', decision: glob }
    return null
  }

  private async askUser(req: ToolApprovalRequest): Promise<ApprovalDecision> {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (!mainWindow) return 'deny'

    return new Promise<ApprovalDecision>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.has(req.callId)) {
          this.pending.delete(req.callId)
          resolve('deny')
        }
      }, APPROVAL_TIMEOUT_MS)

      this.pending.set(req.callId, (response) => {
        clearTimeout(timer)
        if (response.scope === 'conversation' && req.conversationId) {
          const map = this.conversationPolicies.get(req.conversationId) ?? new Map()
          map.set(req.toolId, response.decision)
          this.conversationPolicies.set(req.conversationId, map)
        } else if (response.scope === 'always') {
          this.globalPolicies.set(req.toolId, response.decision)
        }
        resolve(response.decision)
      })

      mainWindow.webContents.send('tools:approvalRequired', req)

      // Backwards-compat shim — the prior modal listened to this event; any
      // external code that subscribed to mcp:confirmationRequired before the
      // refactor still sees the request. New modal uses tools:approvalRequired.
      const legacyToolName = req.name.includes('__')
        ? req.name.split('__').slice(1).join('__')
        : req.name
      mainWindow.webContents.send('mcp:confirmationRequired', {
        callId: req.callId,
        serverId: req.serverId,
        toolName: legacyToolName,
        args: req.args
      })
    })
  }

  /** Renderer response to a pending approval request. */
  respond(response: ToolApprovalResponse): void {
    const resolver = this.pending.get(response.callId)
    if (resolver) {
      this.pending.delete(response.callId)
      resolver(response)
    }
  }

  /** Backwards-compat for the legacy mcp.approveToolCall(callId, boolean) IPC. */
  respondLegacy(callId: string, approved: boolean): void {
    this.respond({
      callId,
      decision: approved ? 'allow' : 'deny',
      scope: 'once'
    })
  }

  listGlobalPolicies(): Array<{ toolId: string; decision: ApprovalDecision }> {
    return Array.from(this.globalPolicies, ([toolId, decision]) => ({
      toolId,
      decision
    }))
  }

  setGlobalPolicy(toolId: string, decision: ApprovalDecision | null): void {
    if (decision === null) this.globalPolicies.delete(toolId)
    else this.globalPolicies.set(toolId, decision)
  }

  clearConversationPolicies(conversationId: string): void {
    this.conversationPolicies.delete(conversationId)
  }

  /** Cancel a pending request — used when a chat round is aborted. */
  cancelPending(callId: string): void {
    const resolver = this.pending.get(callId)
    if (resolver) {
      this.pending.delete(callId)
      resolver({ callId, decision: 'deny', scope: 'once' })
    }
  }
}

export const permissionsService = new PermissionsService()
