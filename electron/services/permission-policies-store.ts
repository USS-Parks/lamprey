import { randomUUID } from 'crypto'
import { resolve } from 'path'
import { getDb } from './database'
import type { ToolRisk } from './tool-registry'

// Persistent approval policies. The Codex Agent Contract sprint moved permission
// answers from per-launch in-memory maps to this table so a user's "Always allow"
// survives restarts. The in-memory layer in permissions-store.ts is now a
// fallback that activates when disk persistence fails — never the primary store.
//
// Resolution order (most-specific → broadest):
//   1. conversation + tool
//   2. conversation + risk
//   3. workspace + tool
//   4. workspace + risk
//   5. global + tool
//   6. global + risk
//   7. → modal
//
// Denies are authoritative across all matching levels. We choose the
// most-specific matching deny first, then the most-specific matching allow.
//
// Risk policies match against the descriptor's risks array: a policy on the
// 'destructive' risk matches any tool whose risks include 'destructive', so a
// single "deny destructive globally" silences apply_patch and Chrome
// destructive MCP tools at once.

export type PolicyScope = 'conversation' | 'workspace' | 'global'
export type PolicySubjectKind = 'tool' | 'risk'
export type PolicyDecision = 'allow' | 'deny'

export interface PermissionPolicy {
  id: string
  scope: PolicyScope
  subjectKind: PolicySubjectKind
  subject: string
  decision: PolicyDecision
  conversationId?: string
  workspacePath?: string
  createdAt: number
  updatedAt: number
}

export interface ResolveContext {
  toolId: string
  risks: ToolRisk[]
  conversationId?: string
  workspacePath?: string
}

export interface ResolveResult {
  decision: PolicyDecision
  /** Matched policy id — chat.ts records this on the audit row. */
  policyId: string
}

/**
 * Canonicalize a workspace path for equality matching. On Windows the resolved
 * form normalizes slashes, but case is also significant — comparison is folded
 * to lowercase so `C:\Foo` and `c:\foo` match. POSIX paths are case-sensitive
 * so we leave the case alone there.
 */
export function canonicalWorkspacePath(p: string | undefined): string | undefined {
  if (!p || typeof p !== 'string' || p.trim() === '') return undefined
  const absolute = resolve(p)
  if (process.platform === 'win32') return absolute.toLowerCase()
  return absolute
}

interface PolicyRow {
  id: string
  scope: PolicyScope
  subject_kind: PolicySubjectKind
  subject: string
  decision: PolicyDecision
  conversation_id: string | null
  workspace_path: string | null
  created_at: number
  updated_at: number
}

function rowToPolicy(row: PolicyRow): PermissionPolicy {
  return {
    id: row.id,
    scope: row.scope,
    subjectKind: row.subject_kind,
    subject: row.subject,
    decision: row.decision,
    conversationId: row.conversation_id ?? undefined,
    workspacePath: row.workspace_path ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * Pure resolution: scan an ordered policy set against the resolve context.
 * Exported so tests can verify precedence without booting the database.
 *
 * Matching denies are safety stops: collect matching policies from every
 * specificity level, return the most-specific deny if any deny matches, then
 * return the most-specific allow. That means a broad risk deny cannot be
 * silently bypassed by a narrower tool allow.
 */
export function resolveDecisionFromPolicies(
  policies: PermissionPolicy[],
  ctx: ResolveContext
): ResolveResult | null {
  const workspaceCanon = canonicalWorkspacePath(ctx.workspacePath)
  const conversationId = ctx.conversationId

  type LevelFilter = (p: PermissionPolicy) => boolean
  const levels: Array<{ filter: LevelFilter }> = [
    {
      filter: (p) =>
        p.scope === 'conversation' &&
        p.subjectKind === 'tool' &&
        p.subject === ctx.toolId &&
        !!conversationId &&
        p.conversationId === conversationId
    },
    {
      filter: (p) =>
        p.scope === 'conversation' &&
        p.subjectKind === 'risk' &&
        ctx.risks.includes(p.subject as ToolRisk) &&
        !!conversationId &&
        p.conversationId === conversationId
    },
    {
      filter: (p) =>
        p.scope === 'workspace' &&
        p.subjectKind === 'tool' &&
        p.subject === ctx.toolId &&
        !!workspaceCanon &&
        canonicalWorkspacePath(p.workspacePath) === workspaceCanon
    },
    {
      filter: (p) =>
        p.scope === 'workspace' &&
        p.subjectKind === 'risk' &&
        ctx.risks.includes(p.subject as ToolRisk) &&
        !!workspaceCanon &&
        canonicalWorkspacePath(p.workspacePath) === workspaceCanon
    },
    {
      filter: (p) =>
        p.scope === 'global' && p.subjectKind === 'tool' && p.subject === ctx.toolId
    },
    {
      filter: (p) =>
        p.scope === 'global' &&
        p.subjectKind === 'risk' &&
        ctx.risks.includes(p.subject as ToolRisk)
    }
  ]

  const matchedByLevel = levels.map((level) => policies.filter(level.filter))
  for (const matches of matchedByLevel) {
    const denial = matches.find((m) => m.decision === 'deny')
    if (denial) return { decision: 'deny', policyId: denial.id }
  }
  for (const matches of matchedByLevel) {
    const allow = matches.find((m) => m.decision === 'allow')
    if (allow) return { decision: 'allow', policyId: allow.id }
  }
  return null
}

// In-memory fallback. Activated when a getDb() call throws (e.g. headless
// tests that don't mock the DB). Mirrors the persistence API at the same
// granularity so resolveDecision can read from one or the other transparently.
const memoryFallback: PermissionPolicy[] = []
let useFallback = false

function activateFallback(reason: string): void {
  if (!useFallback) {
    useFallback = true
    console.warn(
      `[permission-policies-store] persistence unavailable, falling back to memory: ${reason}`
    )
  }
}

export function isUsingMemoryFallback(): boolean {
  return useFallback
}

export function listPolicies(): PermissionPolicy[] {
  if (useFallback) return [...memoryFallback]
  try {
    const db = getDb()
    const rows = db
      .prepare(`SELECT * FROM permission_policies ORDER BY created_at ASC`)
      .all() as PolicyRow[]
    return rows.map(rowToPolicy)
  } catch (err: any) {
    activateFallback(err?.message ?? 'unknown')
    return [...memoryFallback]
  }
}

export function getPolicy(id: string): PermissionPolicy | null {
  if (useFallback) return memoryFallback.find((p) => p.id === id) ?? null
  try {
    const db = getDb()
    const row = db
      .prepare(`SELECT * FROM permission_policies WHERE id = ?`)
      .get(id) as PolicyRow | undefined
    return row ? rowToPolicy(row) : null
  } catch (err: any) {
    activateFallback(err?.message ?? 'unknown')
    return memoryFallback.find((p) => p.id === id) ?? null
  }
}

export interface UpsertPolicyInput {
  scope: PolicyScope
  subjectKind: PolicySubjectKind
  subject: string
  decision: PolicyDecision
  conversationId?: string
  workspacePath?: string
}

/**
 * Upsert a policy. A second call with the same (scope, subjectKind, subject,
 * conversationId, workspacePath) tuple updates the existing row's decision +
 * updated_at instead of inserting a duplicate. Returns the resolved policy.
 */
export function upsertPolicy(input: UpsertPolicyInput): PermissionPolicy {
  if (input.scope === 'conversation' && !input.conversationId) {
    throw new Error('upsertPolicy: conversation-scoped policies require conversationId')
  }
  if (input.scope === 'workspace') {
    const canon = canonicalWorkspacePath(input.workspacePath)
    if (!canon) {
      throw new Error('upsertPolicy: workspace-scoped policies require workspacePath')
    }
    input = { ...input, workspacePath: canon }
  }

  const now = Date.now()

  const tryDb = (): PermissionPolicy | null => {
    try {
      const db = getDb()
      const existing = db
        .prepare(
          `SELECT * FROM permission_policies
           WHERE scope = ? AND subject_kind = ? AND subject = ?
             AND COALESCE(conversation_id, '') = COALESCE(?, '')
             AND COALESCE(workspace_path, '') = COALESCE(?, '')`
        )
        .get(
          input.scope,
          input.subjectKind,
          input.subject,
          input.conversationId ?? null,
          input.workspacePath ?? null
        ) as PolicyRow | undefined
      if (existing) {
        db.prepare(
          `UPDATE permission_policies SET decision = ?, updated_at = ? WHERE id = ?`
        ).run(input.decision, now, existing.id)
        return rowToPolicy({ ...existing, decision: input.decision, updated_at: now })
      }
      const id = randomUUID()
      db.prepare(
        `INSERT INTO permission_policies
           (id, scope, subject_kind, subject, decision,
            conversation_id, workspace_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        input.scope,
        input.subjectKind,
        input.subject,
        input.decision,
        input.conversationId ?? null,
        input.workspacePath ?? null,
        now,
        now
      )
      return {
        id,
        scope: input.scope,
        subjectKind: input.subjectKind,
        subject: input.subject,
        decision: input.decision,
        conversationId: input.conversationId,
        workspacePath: input.workspacePath,
        createdAt: now,
        updatedAt: now
      }
    } catch (err: any) {
      activateFallback(err?.message ?? 'unknown')
      return null
    }
  }

  const fromDb = tryDb()
  if (fromDb) return fromDb

  const existing = memoryFallback.find(
    (p) =>
      p.scope === input.scope &&
      p.subjectKind === input.subjectKind &&
      p.subject === input.subject &&
      (p.conversationId ?? '') === (input.conversationId ?? '') &&
      (p.workspacePath ?? '') === (input.workspacePath ?? '')
  )
  if (existing) {
    existing.decision = input.decision
    existing.updatedAt = now
    return { ...existing }
  }
  const policy: PermissionPolicy = {
    id: randomUUID(),
    scope: input.scope,
    subjectKind: input.subjectKind,
    subject: input.subject,
    decision: input.decision,
    conversationId: input.conversationId,
    workspacePath: input.workspacePath,
    createdAt: now,
    updatedAt: now
  }
  memoryFallback.push(policy)
  return { ...policy }
}

export function deletePolicy(id: string): boolean {
  if (!useFallback) {
    try {
      const db = getDb()
      const result = db.prepare(`DELETE FROM permission_policies WHERE id = ?`).run(id)
      return result.changes > 0
    } catch (err: any) {
      activateFallback(err?.message ?? 'unknown')
    }
  }
  const idx = memoryFallback.findIndex((p) => p.id === id)
  if (idx < 0) return false
  memoryFallback.splice(idx, 1)
  return true
}

export function clearPoliciesForConversation(conversationId: string): number {
  if (!useFallback) {
    try {
      const db = getDb()
      const result = db
        .prepare(
          `DELETE FROM permission_policies
           WHERE scope = 'conversation' AND conversation_id = ?`
        )
        .run(conversationId)
      return result.changes
    } catch (err: any) {
      activateFallback(err?.message ?? 'unknown')
    }
  }
  let count = 0
  for (let i = memoryFallback.length - 1; i >= 0; i--) {
    const p = memoryFallback[i]
    if (p.scope === 'conversation' && p.conversationId === conversationId) {
      memoryFallback.splice(i, 1)
      count++
    }
  }
  return count
}

export function clearPoliciesForScope(scope: PolicyScope): number {
  if (!useFallback) {
    try {
      const db = getDb()
      const result = db
        .prepare(`DELETE FROM permission_policies WHERE scope = ?`)
        .run(scope)
      return result.changes
    } catch (err: any) {
      activateFallback(err?.message ?? 'unknown')
    }
  }
  let count = 0
  for (let i = memoryFallback.length - 1; i >= 0; i--) {
    if (memoryFallback[i].scope === scope) {
      memoryFallback.splice(i, 1)
      count++
    }
  }
  return count
}

export function resolveDecision(ctx: ResolveContext): ResolveResult | null {
  return resolveDecisionFromPolicies(listPolicies(), ctx)
}

/** Test-only: drop the in-memory fallback so tests start from a clean slate. */
export function __resetPolicyStore(): void {
  memoryFallback.length = 0
  useFallback = false
}

/**
 * Test-only: force the store to use its in-memory fallback path. Useful when
 * the test environment cannot reach a real database (mocked electron, no
 * userData dir) but still wants to exercise the public CRUD API.
 */
export function __forceMemoryFallback(): void {
  useFallback = true
}
