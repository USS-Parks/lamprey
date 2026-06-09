import { ipcMain } from 'electron'
import {
  closeChangeContract,
  createChangeContract,
  getActiveChangeContract,
  getChangeContract,
  listChangeContracts,
  updateChangeContract,
  waiveChangeContract,
  type ListChangeContractsFilter
} from '../services/change-contract-store'
import { setMessageProofStatus } from '../services/conversation-store'

function asObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}
}

function asString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : undefined
}

function asPositiveInt(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : undefined
}

function coerceListFilter(raw: unknown): ListChangeContractsFilter {
  const r = asObject(raw)
  const filter: ListChangeContractsFilter = {}
  const conversationId = asString(r.conversationId)
  if (conversationId) filter.conversationId = conversationId
  const correlationId = asString(r.correlationId)
  if (correlationId) filter.correlationId = correlationId
  if (r.status === 'active' || r.status === 'closed' || r.status === 'waived') {
    filter.status = r.status
  } else if (Array.isArray(r.status)) {
    const statuses = r.status.filter(
      (status): status is 'active' | 'closed' | 'waived' =>
        status === 'active' || status === 'closed' || status === 'waived'
    )
    if (statuses.length > 0) filter.status = statuses
  }
  const limit = asPositiveInt(r.limit)
  if (limit !== undefined) filter.limit = limit
  return filter
}

export function registerContractHandlers(): void {
  ipcMain.handle('contracts:create', async (_event, input: unknown) => {
    try {
      return { success: true, data: createChangeContract(asObject(input) as any) }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'contracts:create failed' }
    }
  })

  ipcMain.handle('contracts:update', async (_event, id: unknown, input: unknown) => {
    try {
      const contractId = asString(id)
      if (!contractId) return { success: false, error: 'id is required' }
      return { success: true, data: updateChangeContract(contractId, asObject(input) as any) }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'contracts:update failed' }
    }
  })

  ipcMain.handle('contracts:close', async (_event, id: unknown) => {
    try {
      const contractId = asString(id)
      if (!contractId) return { success: false, error: 'id is required' }
      return { success: true, data: closeChangeContract(contractId) }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'contracts:close failed' }
    }
  })

  ipcMain.handle('contracts:waive', async (_event, input: unknown) => {
    try {
      const r = asObject(input)
      const id = asString(r.id)
      if (!id) return { success: false, error: 'id is required' }
      return {
        success: true,
        data: waiveChangeContract({
          id,
          reason: String(r.reason ?? ''),
          waivedBy: String(r.waivedBy ?? '')
        })
      }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'contracts:waive failed' }
    }
  })

  ipcMain.handle('contracts:get', async (_event, id: unknown) => {
    try {
      const contractId = asString(id)
      if (!contractId) return { success: false, error: 'id is required' }
      const contract = getChangeContract(contractId)
      if (!contract) return { success: false, error: 'not found' }
      return { success: true, data: contract }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'contracts:get failed' }
    }
  })

  ipcMain.handle('contracts:list', async (_event, filter: unknown) => {
    try {
      return { success: true, data: listChangeContracts(coerceListFilter(filter)) }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'contracts:list failed' }
    }
  })

  ipcMain.handle(
    'contracts:active',
    async (_event, conversationId: unknown, correlationId?: unknown) => {
      try {
        const conv = asString(conversationId)
        if (!conv) return { success: false, error: 'conversationId is required' }
        return {
          success: true,
          data: getActiveChangeContract(conv, asString(correlationId))
        }
      } catch (err: any) {
        return { success: false, error: err?.message ?? 'contracts:active failed' }
      }
    }
  )

  // WC-5 — Flip a message's persisted proof_status. Used by the proof
  // gate waiver flow so the inline banner does not return on refetch.
  ipcMain.handle('messages:setProofStatus', async (_event, input: unknown) => {
    try {
      const r = asObject(input)
      const messageId = asString(r.messageId)
      if (!messageId) return { success: false, error: 'messageId is required' }
      const raw = r.status
      const status =
        raw === 'trusted' || raw === 'untrusted' || raw === 'blocked' || raw === 'waived'
          ? raw
          : null
      return { success: true, data: setMessageProofStatus(messageId, status) }
    } catch (err: any) {
      return {
        success: false,
        error: err?.message ?? 'messages:setProofStatus failed'
      }
    }
  })
}
