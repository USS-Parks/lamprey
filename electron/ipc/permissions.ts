import { ipcMain } from 'electron'
import {
  permissionsService,
  type ToolApprovalResponse
} from '../services/permissions-store'

const VALID_DECISIONS = new Set(['allow', 'deny'])
const VALID_SCOPES = new Set(['once', 'conversation', 'always'])

export function registerPermissionsHandlers(): void {
  ipcMain.handle('tools:respondToApproval', async (_event, response: ToolApprovalResponse) => {
    try {
      if (!response || typeof response.callId !== 'string') {
        return { success: false, error: 'callId is required' }
      }
      if (!VALID_DECISIONS.has(response.decision)) {
        return { success: false, error: `Invalid decision: ${response.decision}` }
      }
      if (!VALID_SCOPES.has(response.scope)) {
        return { success: false, error: `Invalid scope: ${response.scope}` }
      }
      permissionsService.respond(response)
      return { success: true, data: null }
    } catch (err: any) {
      return {
        success: false,
        error: err?.message ?? 'tools:respondToApproval failed'
      }
    }
  })

  // Backwards-compat — the previous renderer called window.api.mcp.approveToolCall
  // (boolean approved). Route it through the permissions service with scope=once.
  // This handler used to live in chat.ts; CLAUDE.md note about that is now stale.
  ipcMain.handle('mcp:approveToolCall', async (_event, callId: string, approved: boolean) => {
    try {
      if (typeof callId !== 'string') {
        return { success: false, error: 'callId is required' }
      }
      permissionsService.respondLegacy(callId, !!approved)
      return { success: true, data: null }
    } catch (err: any) {
      return {
        success: false,
        error: err?.message ?? 'mcp:approveToolCall failed'
      }
    }
  })

  ipcMain.handle('permissions:listGlobalPolicies', async () => {
    try {
      return { success: true, data: permissionsService.listGlobalPolicies() }
    } catch (err: any) {
      return {
        success: false,
        error: err?.message ?? 'permissions:listGlobalPolicies failed'
      }
    }
  })

  ipcMain.handle(
    'permissions:setGlobalPolicy',
    async (_event, toolId: string, decision: 'allow' | 'deny' | null) => {
      try {
        if (typeof toolId !== 'string' || !toolId) {
          return { success: false, error: 'toolId is required' }
        }
        if (decision !== null && !VALID_DECISIONS.has(decision)) {
          return { success: false, error: `Invalid decision: ${decision}` }
        }
        permissionsService.setGlobalPolicy(toolId, decision)
        return { success: true, data: null }
      } catch (err: any) {
        return {
          success: false,
          error: err?.message ?? 'permissions:setGlobalPolicy failed'
        }
      }
    }
  )

  ipcMain.handle(
    'permissions:clearConversationPolicies',
    async (_event, conversationId: string) => {
      try {
        if (typeof conversationId !== 'string' || !conversationId) {
          return { success: false, error: 'conversationId is required' }
        }
        permissionsService.clearConversationPolicies(conversationId)
        return { success: true, data: null }
      } catch (err: any) {
        return {
          success: false,
          error: err?.message ?? 'permissions:clearConversationPolicies failed'
        }
      }
    }
  )
}
