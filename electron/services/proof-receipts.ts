import { createHash, randomUUID } from 'crypto'
import type { Database } from 'better-sqlite3'
import { getDb } from './database'
import { recordEvent, type RecordEventInput } from './event-log'

export type ProofReceiptStatus = 'passed' | 'failed' | 'skipped'
export type ProofReceiptCreatedBy = 'agent' | 'system' | 'user' | 'ci'

export interface ProofReceiptRecord {
  id: string
  kind: string
  status: ProofReceiptStatus
  conversationId?: string
  correlationId?: string
  contractId?: string
  toolCallId?: string
  workspacePath: string
  cwd: string
  gitHead?: string
  gitDirty: boolean
  diffHash?: string
  command: string
  commandHash: string
  startedAt: number
  finishedAt: number
  durationMs: number
  exitCode?: number
  timedOut: boolean
  stdoutHash: string
  stderrHash: string
  stdoutPreview: string
  stderrPreview: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  stdoutBytes: number
  stderrBytes: number
  parsedMetrics: Record<string, unknown>
  createdBy: ProofReceiptCreatedBy
  createdAt: number
}

export interface ProofReceiptArtifactRecord {
  id: string
  receiptId: string
  stream: 'stdout' | 'stderr'
  byteCount: number
  hash: string
  contentPreview: string
  contentTruncated: boolean
  createdAt: number
}

export interface CreateProofReceiptInput {
  id?: string
  kind: string
  status: ProofReceiptStatus
  conversationId?: string
  correlationId?: string
  contractId?: string
  toolCallId?: string
  workspacePath: string
  cwd: string
  gitHead?: string
  gitDirty?: boolean
  diffHash?: string
  command: string
  startedAt: number
  finishedAt: number
  durationMs?: number
  exitCode?: number
  timedOut?: boolean
  stdout?: string
  stderr?: string
  parsedMetrics?: Record<string, unknown>
  createdBy: ProofReceiptCreatedBy
}

export interface ProofReceiptFilter {
  conversationId?: string
  correlationId?: string
  contractId?: string
  toolCallId?: string
  workspacePath?: string
  kind?: string | string[]
  status?: ProofReceiptStatus | ProofReceiptStatus[]
  sinceMs?: number
  untilMs?: number
  limit?: number
  order?: 'asc' | 'desc'
}

export interface FreshProofQuery {
  contractId: string
  afterMs?: number
  kind?: string | string[]
  workspacePath?: string
  correlationId?: string
}

interface ProofReceiptRow {
  id: string
  kind: string
  status: string
  conversation_id: string | null
  correlation_id: string | null
  contract_id: string | null
  tool_call_id: string | null
  workspace_path: string
  cwd: string
  git_head: string | null
  git_dirty: number
  diff_hash: string | null
  command: string
  command_hash: string
  started_at: number
  finished_at: number
  duration_ms: number
  exit_code: number | null
  timed_out: number
  stdout_hash: string
  stderr_hash: string
  stdout_preview: string
  stderr_preview: string
  stdout_truncated: number
  stderr_truncated: number
  stdout_bytes: number
  stderr_bytes: number
  parsed_metrics_json: string
  created_by: string
  created_at: number
}

interface ProofReceiptArtifactRow {
  id: string
  receipt_id: string
  stream: string
  byte_count: number
  hash: string
  content_preview: string
  content_truncated: number
  created_at: number
}

interface StoreOptions {
  db?: Database
  emitEvent?: boolean
  eventRecorder?: (input: RecordEventInput) => unknown
}

interface PreviewResult {
  text: string
  byteCount: number
  truncated: boolean
}

const PREVIEW_BYTE_CAP = 4096
const ARTIFACT_BYTE_CAP = 256 * 1024
const MAX_LIST_LIMIT = 500

const SECRET_ASSIGNMENT_PATTERN =
  /\b([A-Z0-9_.-]*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|AUTHORIZATION|BEARER|PRIVATE[_-]?KEY|CLIENT[_-]?SECRET|REFRESH[_-]?TOKEN|ACCESS[_-]?TOKEN|CREDENTIAL|COOKIE|SESSION[_-]?ID)[A-Z0-9_.-]*)(\s*[:=]\s*)(["']?)[^\s"',;}]+/gi

function getStoreDb(options?: StoreOptions): Database {
  return options?.db ?? getDb()
}

function shouldEmitEvent(options?: StoreOptions): boolean {
  return options?.emitEvent !== false
}

function emitEvent(input: RecordEventInput, options?: StoreOptions): void {
  if (!shouldEmitEvent(options)) return
  const writer = options?.eventRecorder ?? recordEvent
  writer(input)
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

export function redactProofText(text: string): string {
  return text.replace(SECRET_ASSIGNMENT_PATTERN, (_match, key, sep, quote) => {
    return `${key}${sep}${quote}[redacted]`
  })
}

function boundedPreview(raw: string, capBytes: number): PreviewResult {
  const redacted = redactProofText(raw)
  const bytes = byteLength(redacted)
  if (bytes <= capBytes) {
    return { text: redacted, byteCount: byteLength(raw), truncated: false }
  }
  let out = ''
  let used = 0
  for (const ch of redacted) {
    const next = byteLength(ch)
    if (used + next > capBytes) break
    out += ch
    used += next
  }
  return { text: out, byteCount: byteLength(raw), truncated: true }
}

function parseMetrics(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function rowToReceipt(row: ProofReceiptRow): ProofReceiptRecord {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status as ProofReceiptStatus,
    conversationId: row.conversation_id ?? undefined,
    correlationId: row.correlation_id ?? undefined,
    contractId: row.contract_id ?? undefined,
    toolCallId: row.tool_call_id ?? undefined,
    workspacePath: row.workspace_path,
    cwd: row.cwd,
    gitHead: row.git_head ?? undefined,
    gitDirty: row.git_dirty === 1,
    diffHash: row.diff_hash ?? undefined,
    command: row.command,
    commandHash: row.command_hash,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    exitCode: row.exit_code ?? undefined,
    timedOut: row.timed_out === 1,
    stdoutHash: row.stdout_hash,
    stderrHash: row.stderr_hash,
    stdoutPreview: row.stdout_preview,
    stderrPreview: row.stderr_preview,
    stdoutTruncated: row.stdout_truncated === 1,
    stderrTruncated: row.stderr_truncated === 1,
    stdoutBytes: row.stdout_bytes,
    stderrBytes: row.stderr_bytes,
    parsedMetrics: parseMetrics(row.parsed_metrics_json),
    createdBy: row.created_by as ProofReceiptCreatedBy,
    createdAt: row.created_at
  }
}

function rowToArtifact(row: ProofReceiptArtifactRow): ProofReceiptArtifactRecord {
  return {
    id: row.id,
    receiptId: row.receipt_id,
    stream: row.stream as 'stdout' | 'stderr',
    byteCount: row.byte_count,
    hash: row.hash,
    contentPreview: row.content_preview,
    contentTruncated: row.content_truncated === 1,
    createdAt: row.created_at
  }
}

function validateCreateInput(input: CreateProofReceiptInput): void {
  if (!input.kind.trim()) throw new Error('createProofReceipt: kind is required')
  if (!['passed', 'failed', 'skipped'].includes(input.status)) {
    throw new Error(`createProofReceipt: invalid status ${JSON.stringify(input.status)}`)
  }
  if (!input.workspacePath.trim()) {
    throw new Error('createProofReceipt: workspacePath is required')
  }
  if (!input.cwd.trim()) throw new Error('createProofReceipt: cwd is required')
  if (!input.command.trim()) throw new Error('createProofReceipt: command is required')
  if (!Number.isFinite(input.startedAt) || !Number.isFinite(input.finishedAt)) {
    throw new Error('createProofReceipt: startedAt and finishedAt are required')
  }
  if (!['agent', 'system', 'user', 'ci'].includes(input.createdBy)) {
    throw new Error(`createProofReceipt: invalid createdBy ${JSON.stringify(input.createdBy)}`)
  }
}

function buildArtifacts(
  receiptId: string,
  createdAt: number,
  stdout: string,
  stderr: string,
  stdoutHash: string,
  stderrHash: string
): ProofReceiptArtifactRecord[] {
  const artifacts: ProofReceiptArtifactRecord[] = []
  const streams = [
    { stream: 'stdout' as const, raw: stdout, hash: stdoutHash },
    { stream: 'stderr' as const, raw: stderr, hash: stderrHash }
  ]
  for (const item of streams) {
    if (byteLength(item.raw) <= PREVIEW_BYTE_CAP) continue
    const preview = boundedPreview(item.raw, ARTIFACT_BYTE_CAP)
    artifacts.push({
      id: `prfa_${randomUUID()}`,
      receiptId,
      stream: item.stream,
      byteCount: byteLength(item.raw),
      hash: item.hash,
      contentPreview: preview.text,
      contentTruncated: preview.truncated,
      createdAt
    })
  }
  return artifacts
}

export function createProofReceipt(
  input: CreateProofReceiptInput,
  options?: StoreOptions
): ProofReceiptRecord {
  validateCreateInput(input)
  const db = getStoreDb(options)
  const id = input.id ?? `prf_${randomUUID()}`
  const stdout = input.stdout ?? ''
  const stderr = input.stderr ?? ''
  const stdoutHash = sha256(stdout)
  const stderrHash = sha256(stderr)
  const stdoutPreview = boundedPreview(stdout, PREVIEW_BYTE_CAP)
  const stderrPreview = boundedPreview(stderr, PREVIEW_BYTE_CAP)
  const createdAt = Date.now()
  const durationMs =
    input.durationMs ?? Math.max(0, Math.round(input.finishedAt - input.startedAt))
  const metricsJson = JSON.stringify(input.parsedMetrics ?? {})
  const record: ProofReceiptRecord = {
    id,
    kind: input.kind,
    status: input.status,
    conversationId: input.conversationId,
    correlationId: input.correlationId,
    contractId: input.contractId,
    toolCallId: input.toolCallId,
    workspacePath: input.workspacePath,
    cwd: input.cwd,
    gitHead: input.gitHead,
    gitDirty: input.gitDirty ?? false,
    diffHash: input.diffHash,
    command: input.command,
    commandHash: sha256(input.command),
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs,
    exitCode: input.exitCode,
    timedOut: input.timedOut ?? false,
    stdoutHash,
    stderrHash,
    stdoutPreview: stdoutPreview.text,
    stderrPreview: stderrPreview.text,
    stdoutTruncated: stdoutPreview.truncated,
    stderrTruncated: stderrPreview.truncated,
    stdoutBytes: stdoutPreview.byteCount,
    stderrBytes: stderrPreview.byteCount,
    parsedMetrics: input.parsedMetrics ?? {},
    createdBy: input.createdBy,
    createdAt
  }
  const artifacts = buildArtifacts(id, createdAt, stdout, stderr, stdoutHash, stderrHash)

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO proof_receipts
        (id, kind, status, conversation_id, correlation_id, contract_id, tool_call_id,
         workspace_path, cwd, git_head, git_dirty, diff_hash, command, command_hash,
         started_at, finished_at, duration_ms, exit_code, timed_out,
         stdout_hash, stderr_hash, stdout_preview, stderr_preview,
         stdout_truncated, stderr_truncated, stdout_bytes, stderr_bytes,
         parsed_metrics_json, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id,
      record.kind,
      record.status,
      record.conversationId ?? null,
      record.correlationId ?? null,
      record.contractId ?? null,
      record.toolCallId ?? null,
      record.workspacePath,
      record.cwd,
      record.gitHead ?? null,
      record.gitDirty ? 1 : 0,
      record.diffHash ?? null,
      record.command,
      record.commandHash,
      record.startedAt,
      record.finishedAt,
      record.durationMs,
      record.exitCode ?? null,
      record.timedOut ? 1 : 0,
      record.stdoutHash,
      record.stderrHash,
      record.stdoutPreview,
      record.stderrPreview,
      record.stdoutTruncated ? 1 : 0,
      record.stderrTruncated ? 1 : 0,
      record.stdoutBytes,
      record.stderrBytes,
      metricsJson,
      record.createdBy,
      record.createdAt
    )
    const insertArtifact = db.prepare(
      `INSERT INTO proof_receipt_artifacts
        (id, receipt_id, stream, byte_count, hash, content_preview, content_truncated, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const artifact of artifacts) {
      insertArtifact.run(
        artifact.id,
        artifact.receiptId,
        artifact.stream,
        artifact.byteCount,
        artifact.hash,
        artifact.contentPreview,
        artifact.contentTruncated ? 1 : 0,
        artifact.createdAt
      )
    }
  })
  tx()

  emitEvent(
    {
      type: record.status === 'failed' ? 'proof.receipt.failed' : 'proof.receipt.created',
      severity: record.status === 'failed' ? 'error' : 'info',
      conversationId: record.conversationId,
      workspacePath: record.workspacePath,
      toolCallId: record.toolCallId,
      correlationId: record.correlationId,
      actorKind:
        record.createdBy === 'agent'
          ? 'agent'
          : record.createdBy === 'user'
          ? 'user'
          : 'system',
      entityKind: 'proof_receipt',
      entityId: record.id,
      payload: {
        id: record.id,
        kind: record.kind,
        status: record.status,
        contractId: record.contractId,
        commandHash: record.commandHash,
        diffHash: record.diffHash,
        exitCode: record.exitCode,
        timedOut: record.timedOut,
        durationMs: record.durationMs,
        stdoutHash: record.stdoutHash,
        stderrHash: record.stderrHash,
        stdoutBytes: record.stdoutBytes,
        stderrBytes: record.stderrBytes,
        stdoutTruncated: record.stdoutTruncated,
        stderrTruncated: record.stderrTruncated,
        artifactCount: artifacts.length
      },
      redaction: 'metadata'
    },
    options
  )

  return record
}

export function getProofReceipt(
  id: string,
  options?: StoreOptions
): ProofReceiptRecord | null {
  const row = getStoreDb(options)
    .prepare(`SELECT * FROM proof_receipts WHERE id = ?`)
    .get(id) as ProofReceiptRow | undefined
  return row ? rowToReceipt(row) : null
}

function buildListQuery(filter: ProofReceiptFilter): { sql: string; params: unknown[] } {
  const where: string[] = []
  const params: unknown[] = []
  const addIn = (column: string, value: string | string[] | undefined): void => {
    if (value === undefined) return
    const values = Array.isArray(value) ? value : [value]
    if (values.length === 0) return
    where.push(`${column} IN (${values.map(() => '?').join(', ')})`)
    params.push(...values)
  }
  if (filter.conversationId) {
    where.push('conversation_id = ?')
    params.push(filter.conversationId)
  }
  if (filter.correlationId) {
    where.push('correlation_id = ?')
    params.push(filter.correlationId)
  }
  if (filter.contractId) {
    where.push('contract_id = ?')
    params.push(filter.contractId)
  }
  if (filter.toolCallId) {
    where.push('tool_call_id = ?')
    params.push(filter.toolCallId)
  }
  if (filter.workspacePath) {
    where.push('workspace_path = ?')
    params.push(filter.workspacePath)
  }
  addIn('kind', filter.kind)
  addIn('status', filter.status)
  if (typeof filter.sinceMs === 'number') {
    where.push('created_at >= ?')
    params.push(filter.sinceMs)
  }
  if (typeof filter.untilMs === 'number') {
    where.push('created_at <= ?')
    params.push(filter.untilMs)
  }
  const limit =
    typeof filter.limit === 'number' && Number.isFinite(filter.limit) && filter.limit > 0
      ? Math.min(Math.floor(filter.limit), MAX_LIST_LIMIT)
      : 100
  const order = filter.order === 'asc' ? 'ASC' : 'DESC'
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  params.push(limit)
  return {
    sql: `SELECT * FROM proof_receipts ${whereClause} ORDER BY created_at ${order} LIMIT ?`,
    params
  }
}

export function listProofReceipts(
  filter: ProofReceiptFilter = {},
  options?: StoreOptions
): ProofReceiptRecord[] {
  const { sql, params } = buildListQuery(filter)
  const rows = getStoreDb(options).prepare(sql).all(...params) as ProofReceiptRow[]
  return rows.map(rowToReceipt)
}

export function listProofReceiptArtifacts(
  receiptId: string,
  options?: StoreOptions
): ProofReceiptArtifactRecord[] {
  const rows = getStoreDb(options)
    .prepare(
      `SELECT * FROM proof_receipt_artifacts
       WHERE receipt_id = ?
       ORDER BY created_at ASC`
    )
    .all(receiptId) as ProofReceiptArtifactRow[]
  return rows.map(rowToArtifact)
}

export function findFreshProofForContract(
  query: FreshProofQuery,
  options?: StoreOptions
): ProofReceiptRecord | null {
  if (!query.contractId.trim()) {
    throw new Error('findFreshProofForContract: contractId is required')
  }
  const where = ['contract_id = ?', "status = 'passed'"]
  const params: unknown[] = [query.contractId]
  if (typeof query.afterMs === 'number') {
    where.push('finished_at >= ?')
    params.push(query.afterMs)
  }
  if (query.workspacePath) {
    where.push('workspace_path = ?')
    params.push(query.workspacePath)
  }
  if (query.correlationId) {
    where.push('correlation_id = ?')
    params.push(query.correlationId)
  }
  const kinds = query.kind ? (Array.isArray(query.kind) ? query.kind : [query.kind]) : []
  if (kinds.length > 0) {
    where.push(`kind IN (${kinds.map(() => '?').join(', ')})`)
    params.push(...kinds)
  }
  const row = getStoreDb(options)
    .prepare(
      `SELECT * FROM proof_receipts
       WHERE ${where.join(' AND ')}
       ORDER BY finished_at DESC, created_at DESC
       LIMIT 1`
    )
    .get(...params) as ProofReceiptRow | undefined
  return row ? rowToReceipt(row) : null
}
