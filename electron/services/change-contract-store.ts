import { randomUUID } from 'crypto'
import { getDb } from './database'
import type { Goal } from './plan-goal-store'

export type ChangeContractStatus = 'active' | 'closed' | 'waived'
export type ChangeContractSource = 'user' | 'plan_goal' | 'implicit' | 'system'

export interface ChangeContract {
  id: string
  conversationId: string
  correlationId?: string
  status: ChangeContractStatus
  implicit: boolean
  source: ChangeContractSource
  goal: string
  acceptanceCriteria: string[]
  expectedFiles: string[]
  nonGoals: string[]
  verificationCommands: string[]
  requiredReceiptKinds: string[]
  createdAt: number
  updatedAt: number
  closedAt?: number
  waiverReason?: string
  waivedBy?: string
  waivedAt?: number
}

export interface CreateChangeContractInput {
  id?: string
  conversationId: string
  correlationId?: string
  goal: string
  acceptanceCriteria?: unknown
  expectedFiles?: unknown
  nonGoals?: unknown
  verificationCommands?: unknown
  requiredReceiptKinds?: unknown
  implicit?: boolean
  source?: ChangeContractSource
}

export interface UpdateChangeContractInput {
  goal?: string
  acceptanceCriteria?: unknown
  expectedFiles?: unknown
  nonGoals?: unknown
  verificationCommands?: unknown
  requiredReceiptKinds?: unknown
  correlationId?: string | null
}

export interface ListChangeContractsFilter {
  conversationId?: string
  correlationId?: string
  status?: ChangeContractStatus | ChangeContractStatus[]
  limit?: number
}

interface ChangeContractRow {
  id: string
  conversation_id: string
  correlation_id: string | null
  status: string
  implicit: number
  source: string
  goal: string
  acceptance_criteria_json: string
  expected_files_json: string
  non_goals_json: string
  verification_commands_json: string
  required_receipt_kinds_json: string
  created_at: number
  updated_at: number
  closed_at: number | null
  waiver_reason: string | null
  waived_by: string | null
  waived_at: number | null
}

const memoryContracts: ChangeContract[] = []
let useFallback = false
let __monoCursor = 0

function monoNow(): number {
  const t = Date.now()
  __monoCursor = t > __monoCursor ? t : __monoCursor + 1
  return __monoCursor
}

function activateFallback(reason: string): void {
  if (!useFallback) {
    useFallback = true
    console.warn(
      `[change-contract-store] persistence unavailable, falling back to memory: ${reason}`
    )
  }
}

function getStoreDb(): ReturnType<typeof getDb> | null {
  if (useFallback) return null
  try {
    return getDb()
  } catch (err: any) {
    activateFallback(err?.message ?? 'unknown')
    return null
  }
}

function parseStringArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

function rowToContract(row: ChangeContractRow): ChangeContract {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    correlationId: row.correlation_id ?? undefined,
    status: row.status as ChangeContractStatus,
    implicit: row.implicit === 1,
    source: row.source as ChangeContractSource,
    goal: row.goal,
    acceptanceCriteria: parseStringArray(row.acceptance_criteria_json),
    expectedFiles: parseStringArray(row.expected_files_json),
    nonGoals: parseStringArray(row.non_goals_json),
    verificationCommands: parseStringArray(row.verification_commands_json),
    requiredReceiptKinds: parseStringArray(row.required_receipt_kinds_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at ?? undefined,
    waiverReason: row.waiver_reason ?? undefined,
    waivedBy: row.waived_by ?? undefined,
    waivedAt: row.waived_at ?? undefined
  }
}

function cloneContract(contract: ChangeContract): ChangeContract {
  return {
    ...contract,
    acceptanceCriteria: [...contract.acceptanceCriteria],
    expectedFiles: [...contract.expectedFiles],
    nonGoals: [...contract.nonGoals],
    verificationCommands: [...contract.verificationCommands],
    requiredReceiptKinds: [...contract.requiredReceiptKinds]
  }
}

function asStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array of strings`)
  }
  return value.map((item, index) => {
    if (typeof item !== 'string') {
      throw new Error(`${field}[${index}] must be a string`)
    }
    const trimmed = item.trim()
    if (!trimmed) throw new Error(`${field}[${index}] must not be empty`)
    return trimmed
  })
}

function validateStatus(status: string): asserts status is ChangeContractStatus {
  if (!['active', 'closed', 'waived'].includes(status)) {
    throw new Error(`invalid change contract status ${JSON.stringify(status)}`)
  }
}

function validateSource(source: string): asserts source is ChangeContractSource {
  if (!['user', 'plan_goal', 'implicit', 'system'].includes(source)) {
    throw new Error(`invalid change contract source ${JSON.stringify(source)}`)
  }
}

function validateCreateInput(input: CreateChangeContractInput): void {
  if (typeof input.conversationId !== 'string' || !input.conversationId.trim()) {
    throw new Error('createChangeContract: conversationId is required')
  }
  if (typeof input.goal !== 'string' || !input.goal.trim()) {
    throw new Error('createChangeContract: goal is required')
  }
  validateSource(input.source ?? (input.implicit ? 'implicit' : 'user'))
  asStringArray(input.acceptanceCriteria, 'acceptanceCriteria')
  asStringArray(input.expectedFiles, 'expectedFiles')
  asStringArray(input.nonGoals, 'nonGoals')
  asStringArray(input.verificationCommands, 'verificationCommands')
  asStringArray(input.requiredReceiptKinds, 'requiredReceiptKinds')
}

function toRecord(input: CreateChangeContractInput): ChangeContract {
  validateCreateInput(input)
  const now = monoNow()
  const source = input.source ?? (input.implicit ? 'implicit' : 'user')
  validateSource(source)
  return {
    id: input.id ?? `ctr_${randomUUID()}`,
    conversationId: input.conversationId.trim(),
    correlationId: input.correlationId?.trim() || undefined,
    status: 'active',
    implicit: input.implicit ?? source === 'implicit',
    source,
    goal: input.goal.trim(),
    acceptanceCriteria: asStringArray(input.acceptanceCriteria, 'acceptanceCriteria'),
    expectedFiles: asStringArray(input.expectedFiles, 'expectedFiles'),
    nonGoals: asStringArray(input.nonGoals, 'nonGoals'),
    verificationCommands: asStringArray(input.verificationCommands, 'verificationCommands'),
    requiredReceiptKinds: asStringArray(input.requiredReceiptKinds, 'requiredReceiptKinds'),
    createdAt: now,
    updatedAt: now
  }
}

function insertDb(contract: ChangeContract): void {
  const db = getStoreDb()
  if (!db) {
    memoryContracts.push(cloneContract(contract))
    return
  }
  try {
    db.prepare(
      `INSERT INTO change_contracts
        (id, conversation_id, correlation_id, status, implicit, source, goal,
         acceptance_criteria_json, expected_files_json, non_goals_json,
         verification_commands_json, required_receipt_kinds_json,
         created_at, updated_at, closed_at, waiver_reason, waived_by, waived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      contract.id,
      contract.conversationId,
      contract.correlationId ?? null,
      contract.status,
      contract.implicit ? 1 : 0,
      contract.source,
      contract.goal,
      JSON.stringify(contract.acceptanceCriteria),
      JSON.stringify(contract.expectedFiles),
      JSON.stringify(contract.nonGoals),
      JSON.stringify(contract.verificationCommands),
      JSON.stringify(contract.requiredReceiptKinds),
      contract.createdAt,
      contract.updatedAt,
      contract.closedAt ?? null,
      contract.waiverReason ?? null,
      contract.waivedBy ?? null,
      contract.waivedAt ?? null
    )
  } catch (err: any) {
    activateFallback(err?.message ?? 'unknown')
    memoryContracts.push(cloneContract(contract))
  }
}

export function createChangeContract(input: CreateChangeContractInput): ChangeContract {
  const contract = toRecord(input)
  insertDb(contract)
  return cloneContract(contract)
}

export function createChangeContractFromGoal(
  conversationId: string,
  goal: Pick<Goal, 'title' | 'description'>,
  opts: Partial<Omit<CreateChangeContractInput, 'conversationId' | 'goal' | 'source'>> = {}
): ChangeContract {
  return createChangeContract({
    ...opts,
    conversationId,
    goal: goal.description ? `${goal.title}\n\n${goal.description}` : goal.title,
    source: 'plan_goal',
    implicit: false
  })
}

export function synthesizeImplicitChangeContract(input: {
  conversationId: string
  correlationId?: string
  userRequest: string
  firstObservedFile?: string
  verificationCommands?: string[]
}): ChangeContract {
  const expectedFiles = input.firstObservedFile ? [input.firstObservedFile] : []
  return createChangeContract({
    conversationId: input.conversationId,
    correlationId: input.correlationId,
    goal: input.userRequest,
    acceptanceCriteria: ['Satisfy the user request without expanding scope silently'],
    expectedFiles,
    verificationCommands: input.verificationCommands ?? [],
    requiredReceiptKinds: ['verify'],
    implicit: true,
    source: 'implicit'
  })
}

function getMemoryContract(id: string): ChangeContract | null {
  const found = memoryContracts.find((contract) => contract.id === id)
  return found ? cloneContract(found) : null
}

export function getChangeContract(id: string): ChangeContract | null {
  if (!id) return null
  const db = getStoreDb()
  if (!db) return getMemoryContract(id)
  try {
    const row = db
      .prepare(`SELECT * FROM change_contracts WHERE id = ?`)
      .get(id) as ChangeContractRow | undefined
    return row ? rowToContract(row) : null
  } catch (err: any) {
    activateFallback(err?.message ?? 'unknown')
    return getMemoryContract(id)
  }
}

function memoryMatches(contract: ChangeContract, filter: ListChangeContractsFilter): boolean {
  if (filter.conversationId && contract.conversationId !== filter.conversationId) return false
  if (filter.correlationId && contract.correlationId !== filter.correlationId) return false
  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status]
    if (!statuses.includes(contract.status)) return false
  }
  return true
}

export function listChangeContracts(
  filter: ListChangeContractsFilter = {}
): ChangeContract[] {
  const limit =
    typeof filter.limit === 'number' && Number.isFinite(filter.limit) && filter.limit > 0
      ? Math.min(Math.floor(filter.limit), 500)
      : 100
  const db = getStoreDb()
  if (!db) {
    return memoryContracts
      .filter((contract) => memoryMatches(contract, filter))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map(cloneContract)
  }
  try {
    const where: string[] = []
    const params: unknown[] = []
    if (filter.conversationId) {
      where.push('conversation_id = ?')
      params.push(filter.conversationId)
    }
    if (filter.correlationId) {
      where.push('correlation_id = ?')
      params.push(filter.correlationId)
    }
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status]
      for (const status of statuses) validateStatus(status)
      where.push(`status IN (${statuses.map(() => '?').join(', ')})`)
      params.push(...statuses)
    }
    params.push(limit)
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const rows = db
      .prepare(
        `SELECT * FROM change_contracts ${whereClause}
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(...params) as ChangeContractRow[]
    return rows.map(rowToContract)
  } catch (err: any) {
    activateFallback(err?.message ?? 'unknown')
    return listChangeContracts(filter)
  }
}

export function getActiveChangeContract(
  conversationId: string,
  correlationId?: string
): ChangeContract | null {
  const rows = listChangeContracts({
    conversationId,
    correlationId,
    status: 'active',
    limit: 1
  })
  return rows[0] ?? null
}

function updateMemoryContract(
  id: string,
  patch: (contract: ChangeContract) => ChangeContract
): ChangeContract {
  const idx = memoryContracts.findIndex((contract) => contract.id === id)
  if (idx < 0) throw new Error(`change contract ${JSON.stringify(id)} not found`)
  const updated = patch(cloneContract(memoryContracts[idx]))
  memoryContracts[idx] = cloneContract(updated)
  return cloneContract(updated)
}

export function updateChangeContract(
  id: string,
  input: UpdateChangeContractInput
): ChangeContract {
  const current = getChangeContract(id)
  if (!current) throw new Error(`change contract ${JSON.stringify(id)} not found`)
  if (current.status !== 'active') {
    throw new Error('only active change contracts can be updated')
  }
  const updated: ChangeContract = {
    ...current,
    goal: input.goal !== undefined ? String(input.goal).trim() : current.goal,
    correlationId:
      input.correlationId === null
        ? undefined
        : input.correlationId !== undefined
        ? input.correlationId.trim() || undefined
        : current.correlationId,
    acceptanceCriteria:
      input.acceptanceCriteria !== undefined
        ? asStringArray(input.acceptanceCriteria, 'acceptanceCriteria')
        : current.acceptanceCriteria,
    expectedFiles:
      input.expectedFiles !== undefined
        ? asStringArray(input.expectedFiles, 'expectedFiles')
        : current.expectedFiles,
    nonGoals:
      input.nonGoals !== undefined ? asStringArray(input.nonGoals, 'nonGoals') : current.nonGoals,
    verificationCommands:
      input.verificationCommands !== undefined
        ? asStringArray(input.verificationCommands, 'verificationCommands')
        : current.verificationCommands,
    requiredReceiptKinds:
      input.requiredReceiptKinds !== undefined
        ? asStringArray(input.requiredReceiptKinds, 'requiredReceiptKinds')
        : current.requiredReceiptKinds,
    updatedAt: monoNow()
  }
  if (!updated.goal) throw new Error('updateChangeContract: goal is required')

  const db = getStoreDb()
  if (!db) return updateMemoryContract(id, () => updated)
  try {
    db.prepare(
      `UPDATE change_contracts
       SET correlation_id = ?,
           goal = ?,
           acceptance_criteria_json = ?,
           expected_files_json = ?,
           non_goals_json = ?,
           verification_commands_json = ?,
           required_receipt_kinds_json = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(
      updated.correlationId ?? null,
      updated.goal,
      JSON.stringify(updated.acceptanceCriteria),
      JSON.stringify(updated.expectedFiles),
      JSON.stringify(updated.nonGoals),
      JSON.stringify(updated.verificationCommands),
      JSON.stringify(updated.requiredReceiptKinds),
      updated.updatedAt,
      id
    )
    return updated
  } catch (err: any) {
    activateFallback(err?.message ?? 'unknown')
    return updateMemoryContract(id, () => updated)
  }
}

function transitionContract(
  id: string,
  patch: Pick<ChangeContract, 'status' | 'closedAt' | 'waiverReason' | 'waivedBy' | 'waivedAt'>
): ChangeContract {
  const current = getChangeContract(id)
  if (!current) throw new Error(`change contract ${JSON.stringify(id)} not found`)
  if (current.status !== 'active') {
    throw new Error('only active change contracts can transition')
  }
  const updated: ChangeContract = { ...current, ...patch, updatedAt: monoNow() }
  const db = getStoreDb()
  if (!db) return updateMemoryContract(id, () => updated)
  try {
    db.prepare(
      `UPDATE change_contracts
       SET status = ?,
           updated_at = ?,
           closed_at = ?,
           waiver_reason = ?,
           waived_by = ?,
           waived_at = ?
       WHERE id = ?`
    ).run(
      updated.status,
      updated.updatedAt,
      updated.closedAt ?? null,
      updated.waiverReason ?? null,
      updated.waivedBy ?? null,
      updated.waivedAt ?? null,
      id
    )
    return updated
  } catch (err: any) {
    activateFallback(err?.message ?? 'unknown')
    return updateMemoryContract(id, () => updated)
  }
}

export function closeChangeContract(id: string): ChangeContract {
  const closedAt = monoNow()
  return transitionContract(id, { status: 'closed', closedAt })
}

export function waiveChangeContract(input: {
  id: string
  reason: string
  waivedBy: string
}): ChangeContract {
  const reason = String(input.reason ?? '').trim()
  const waivedBy = String(input.waivedBy ?? '').trim()
  if (!reason) throw new Error('waiveChangeContract: reason is required')
  if (!waivedBy) throw new Error('waiveChangeContract: waivedBy is required')
  const waivedAt = monoNow()
  return transitionContract(input.id, {
    status: 'waived',
    closedAt: waivedAt,
    waiverReason: reason,
    waivedBy,
    waivedAt
  })
}

export function __resetChangeContractStore(): void {
  memoryContracts.length = 0
  useFallback = false
  __monoCursor = 0
}

export function __forceChangeContractMemoryFallback(): void {
  useFallback = true
}
