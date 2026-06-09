import { randomUUID } from 'crypto'
import { getDb, withWriteRetry } from './database'
import { touchProject } from './projects-store'
import { clearConversationState } from './plan-goal-store'
import { sanitizePseudoTags } from './sanitize-pseudo-tags'

export interface ConversationRow {
  id: string
  title: string | null
  model: string
  created_at: number
  updated_at: number
  kind?: string
  worktree_path?: string | null
  project_id?: string | null
  archived?: number
  pinned_at?: number | null
  forked_from_id?: string | null
  forked_from_message_id?: string | null
  seed_blob?: string | null
  seed_source_kind?: SeedSourceKind | null
}

export interface MessageRow {
  id: string
  conversation_id: string
  role: string
  content: string
  model: string | null
  tool_call_id: string | null
  tool_calls: string | null
  draft: string | null
  reasoning: string | null
  created_at: number
  /** Track 2 / E5 — when this message was folded into a summary by the
   *  context compressor, this is the id of the summary message. NULL
   *  for messages that have never been compressed (the default for
   *  every row in a fresh conversation). */
  compressed_into: string | null
  /** JSON-encoded array of StoredDocument. NULL for turns with no
   *  create_document calls. */
  documents: string | null
  /** Reasoning Audit Phase R1 — multi-agent pipeline stage discriminator.
   *  NULL = legacy or single-agent. 'planner' | 'reviewer' | 'composer'
   *  set by the pipeline / composer save sites. Coder rows stay NULL
   *  (the implicit default) so legacy rows don't need backfill. */
  stage: string | null
  /** Robustness Hotfix HX4 (v0.8.4) — verbatim pre-sanitization copy of
   *  the assistant row's body. NULL on pre-hotfix legacy rows + non-
   *  assistant rows. UI continues to read `content` (sanitized); this
   *  column exists for the audit / export surface (RT-Viewer extension). */
  content_raw: string | null
  /** WC-4 — Persisted proof gate trust state.
   *
   *  NULL = not applicable (read-only turn, legacy row, no mutating tool
   *  call observed). `'trusted'` = the M5 gate evaluated and found a
   *  passing receipt after the last mutation. `'untrusted'` = mutations
   *  observed but no fresh passing receipt. `'blocked'` = a strict-mode
   *  block (reserved; WC-5 surfaces this in the UI banner). `'waived'` =
   *  user explicitly waived via the contract waiver flow (M6).
   *
   *  Replaces the WC-pre era of parsing `proofGateNotice` text out of the
   *  message body to know whether a turn is trusted. */
  proof_status: string | null
}

/** Allowed values for `MessageRow.stage`. Kept as a string union so
 *  callers can pass `undefined` to mean "not a multi-agent row".
 *  Coder rows intentionally stay NULL — see database.ts R1 migration. */
export type MessageStage = 'planner' | 'reviewer' | 'composer'

/** WC-4 — Allowed values for `MessageRow.proof_status`. NULL on the row
 *  means "not applicable" (use the absence rather than a sentinel string). */
export type ProofStatus = 'trusted' | 'untrusted' | 'blocked' | 'waived'
export type SeedSourceKind = 'none' | 'message' | 'block' | 'transcript-range' | 'custom'

export interface ConversationSeedBlob {
  sourceConversationId?: string
  sourceMessageId?: string
  source?: string
  kind: SeedSourceKind
  contentPreview?: string
  attachedDocumentId?: string
  seedBytes?: number
}

export interface StoredToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface StoredDocument {
  id: string
  name: string
  mimeType: string
  content: string
  sizeBytes: number
  createdAt: number
}

export function createConversation(
  model: string,
  opts?: {
    kind?: 'local' | 'cloud' | 'worktree'
    worktreePath?: string | null
    projectId?: string | null
    forkedFromId?: string | null
    forkedFromMessageId?: string | null
    seedBlob?: ConversationSeedBlob | string | null
    seedSourceKind?: SeedSourceKind
  }
) {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()
  const kind = opts?.kind ?? 'local'
  const worktreePath = opts?.worktreePath ?? null
  const projectId = opts?.projectId ?? null
  const seedSourceKind = opts?.seedSourceKind ?? 'none'
  const seedBlob =
    typeof opts?.seedBlob === 'string'
      ? opts.seedBlob
      : opts?.seedBlob
        ? JSON.stringify(opts.seedBlob)
        : null
  db.prepare(
    `INSERT INTO conversations
       (id, title, model, created_at, updated_at, kind, worktree_path, project_id,
        forked_from_id, forked_from_message_id, seed_blob, seed_source_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    null,
    model,
    now,
    now,
    kind,
    worktreePath,
    projectId,
    opts?.forkedFromId ?? null,
    opts?.forkedFromMessageId ?? null,
    seedBlob,
    seedSourceKind
  )
  if (projectId) touchProject(projectId)
  return {
    id,
    title: null,
    model,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    kind,
    worktreePath,
    projectId,
    forkedFromId: opts?.forkedFromId ?? null,
    forkedFromMessageId: opts?.forkedFromMessageId ?? null,
    seedBlob: seedBlob ?? undefined,
    seedSourceKind
  }
}

function rowToConversation(row: ConversationRow, count: number) {
  let seedBlob: ConversationSeedBlob | string | null = null
  if (row.seed_blob) {
    try {
      seedBlob = JSON.parse(row.seed_blob) as ConversationSeedBlob
    } catch {
      seedBlob = row.seed_blob
    }
  }
  return {
    id: row.id,
    title: row.title || 'New conversation',
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: count,
    kind: (row.kind as 'local' | 'cloud' | 'worktree' | undefined) ?? 'local',
    worktreePath: row.worktree_path ?? null,
    projectId: row.project_id ?? null,
    archived: row.archived === 1,
    pinnedAt: row.pinned_at ?? null,
    forkedFromId: row.forked_from_id ?? null,
    forkedFromMessageId: row.forked_from_message_id ?? null,
    seedBlob,
    seedSourceKind: row.seed_source_kind ?? 'none'
  }
}

export function findMessage(conversationId: string, messageId: string) {
  const rows = getMessages(conversationId)
  return rows.find((m) => m.id === messageId) ?? null
}

export function listConversationLineage(conversationId: string, limit = 10) {
  const lineage: ReturnType<typeof getConversation>[] = []
  let current = getConversation(conversationId)
  let guard = 0
  while (current?.forkedFromId && guard < limit) {
    const parent = getConversation(current.forkedFromId)
    if (!parent) break
    lineage.push(parent)
    current = parent
    guard += 1
  }
  return lineage
}

export function getConversation(id: string) {
  const db = getDb()
  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
    | ConversationRow
    | undefined
  if (!row) return null
  const count = db.prepare(
    'SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ?'
  ).get(id) as { cnt: number }
  return rowToConversation(row, count.cnt)
}

export function listConversations() {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM conversations ORDER BY updated_at DESC')
    .all() as ConversationRow[]
  return rows.map((row) => {
    const count = db.prepare(
      'SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ?'
    ).get(row.id) as { cnt: number }
    return rowToConversation(row, count.cnt)
  })
}

// E3 — Sessions sidebar uses three buckets: Recent (not archived,
// not pinned), Pinned (pinned_at IS NOT NULL), Archived (archived = 1).
// The optional `query` arg restricts by FTS hit, and `limit`/`offset`
// support infinite-scroll pagination.
export type SessionsTab = 'recent' | 'pinned' | 'archived'

export interface ListSessionsOptions {
  tab?: SessionsTab
  query?: string
  limit?: number
  offset?: number
}

export function listSessions(opts: ListSessionsOptions = {}) {
  const db = getDb()
  const tab: SessionsTab = opts.tab ?? 'recent'
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500)
  const offset = Math.max(opts.offset ?? 0, 0)

  let ids: string[] | null = null
  if (opts.query && opts.query.trim()) {
    // FTS scan returns the candidate conversation ids; we then join
    // back to the canonical row for the bucket filter so we don't
    // double-implement archive/pin logic in the FTS query.
    try {
      const matches = db
        .prepare(
          `SELECT DISTINCT conversation_id
             FROM sessions_fts
            WHERE sessions_fts MATCH ?
            ORDER BY rank
            LIMIT ?`
        )
        .all(opts.query.trim(), 500) as { conversation_id: string }[]
      ids = matches.map((m) => m.conversation_id)
    } catch (err) {
      // Malformed FTS query — fall back to a LIKE scan on titles only.
      console.warn('[conversation-store] FTS query failed:', (err as Error).message)
      const like = `%${opts.query.trim().replace(/[\\%_]/g, '')}%`
      const matches = db
        .prepare(
          `SELECT id FROM conversations
            WHERE title LIKE ?
            ORDER BY updated_at DESC
            LIMIT 500`
        )
        .all(like) as { id: string }[]
      ids = matches.map((m) => m.id)
    }
    if (ids.length === 0) return []
  }

  let where: string
  let order = 'updated_at DESC'
  if (tab === 'recent') {
    where = 'archived = 0 AND pinned_at IS NULL'
  } else if (tab === 'pinned') {
    where = 'pinned_at IS NOT NULL'
    order = 'pinned_at DESC'
  } else {
    where = 'archived = 1'
  }

  let sql = `SELECT * FROM conversations WHERE ${where}`
  const params: any[] = []
  if (ids) {
    const placeholders = ids.map(() => '?').join(',')
    sql += ` AND id IN (${placeholders})`
    params.push(...ids)
  }
  sql += ` ORDER BY ${order} LIMIT ? OFFSET ?`
  params.push(limit, offset)

  const rows = db.prepare(sql).all(...params) as ConversationRow[]
  return rows.map((row) => {
    const count = db
      .prepare('SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ?')
      .get(row.id) as { cnt: number }
    return rowToConversation(row, count.cnt)
  })
}

export function setConversationArchived(id: string, archived: boolean): void {
  const db = getDb()
  db.prepare('UPDATE conversations SET archived = ?, updated_at = ? WHERE id = ?').run(
    archived ? 1 : 0,
    Date.now(),
    id
  )
}

export function setConversationPinned(id: string, pinned: boolean): void {
  const db = getDb()
  db.prepare('UPDATE conversations SET pinned_at = ?, updated_at = ? WHERE id = ?').run(
    pinned ? Date.now() : null,
    Date.now(),
    id
  )
}

// Cross-session FTS — returns a flat list of hits keyed by source so
// the renderer can render "matched in title" vs "matched in message"
// distinctly. Snippets are taken from the FTS5 snippet() helper.
export interface SessionSearchHit {
  conversationId: string
  source: 'conversation' | 'message'
  messageId: string | null
  snippet: string
  rank: number
}

export function searchSessions(query: string, limit = 50): SessionSearchHit[] {
  const q = query.trim()
  if (!q) return []
  const db = getDb()
  try {
    const rows = db
      .prepare(
        `SELECT source, conversation_id, message_id,
                snippet(sessions_fts, 4, '<<', '>>', '…', 24) AS snippet,
                rank
           FROM sessions_fts
          WHERE sessions_fts MATCH ?
          ORDER BY rank
          LIMIT ?`
      )
      .all(q, limit) as any[]
    return rows.map((r) => ({
      conversationId: r.conversation_id,
      source: r.source,
      messageId: r.message_id ?? null,
      snippet: r.snippet ?? '',
      rank: r.rank
    }))
  } catch (err) {
    console.warn('[conversation-store] FTS search failed:', (err as Error).message)
    return []
  }
}

// ────────────── FTS sync helpers ──────────────

function ftsDeleteConversation(id: string): void {
  const db = getDb()
  try {
    db.prepare(
      "DELETE FROM sessions_fts WHERE source = 'conversation' AND conversation_id = ?"
    ).run(id)
  } catch (err) {
    console.warn('[conversation-store] FTS delete-conv failed:', (err as Error).message)
  }
}

function ftsDeleteAllForConversation(id: string): void {
  const db = getDb()
  try {
    db.prepare('DELETE FROM sessions_fts WHERE conversation_id = ?').run(id)
  } catch (err) {
    console.warn('[conversation-store] FTS delete-all failed:', (err as Error).message)
  }
}

function ftsDeleteMessagesForConversation(conversationId: string): void {
  const db = getDb()
  try {
    db.prepare(
      "DELETE FROM sessions_fts WHERE source = 'message' AND conversation_id = ?"
    ).run(conversationId)
  } catch (err) {
    console.warn(
      '[conversation-store] FTS delete-messages-for-conv failed:',
      (err as Error).message
    )
  }
}

// Bulk clear a conversation's messages + the matching FTS rows. Used by
// the compact path which collapses a long conversation into a single
// summary message; reusing this helper keeps the FTS index from
// re-surfacing the discarded content.
export function clearConversationMessages(conversationId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId)
  ftsDeleteMessagesForConversation(conversationId)
}

function ftsDeleteMessage(messageId: string): void {
  const db = getDb()
  try {
    db.prepare(
      "DELETE FROM sessions_fts WHERE source = 'message' AND message_id = ?"
    ).run(messageId)
  } catch (err) {
    console.warn('[conversation-store] FTS delete-message failed:', (err as Error).message)
  }
}

function ftsUpsertConversation(id: string, title: string | null): void {
  if (!title) return
  const db = getDb()
  try {
    ftsDeleteConversation(id)
    db.prepare(
      `INSERT INTO sessions_fts (source, conversation_id, message_id, title, body)
       VALUES ('conversation', ?, NULL, ?, '')`
    ).run(id, title)
  } catch (err) {
    console.warn('[conversation-store] FTS upsert-conv failed:', (err as Error).message)
  }
}

function ftsInsertMessage(messageId: string, conversationId: string, body: string): void {
  if (!body || !body.trim()) return
  const db = getDb()
  try {
    db.prepare(
      `INSERT INTO sessions_fts (source, conversation_id, message_id, title, body)
       VALUES ('message', ?, ?, '', ?)`
    ).run(conversationId, messageId, body)
  } catch (err) {
    console.warn('[conversation-store] FTS insert-message failed:', (err as Error).message)
  }
}

/**
 * One-shot index repair. Empties `sessions_fts` and re-fills it from
 * the conversation + message tables. Called on first boot after the E3
 * migration runs so any pre-existing conversations are searchable
 * immediately. Subsequent boots see a non-empty index and skip.
 */
export function backfillSessionsFts(force = false): { rebuilt: boolean; rows: number } {
  const db = getDb()
  let existing: number
  try {
    existing = (db.prepare('SELECT COUNT(*) AS cnt FROM sessions_fts').get() as { cnt: number }).cnt
  } catch (err) {
    // If the FTS vtable isn't there yet (binding unavailable), bail.
    console.warn('[conversation-store] FTS backfill skipped:', (err as Error).message)
    return { rebuilt: false, rows: 0 }
  }
  if (existing > 0 && !force) return { rebuilt: false, rows: existing }
  try {
    db.exec('DELETE FROM sessions_fts')
    const convs = db
      .prepare('SELECT id, title FROM conversations WHERE title IS NOT NULL AND title <> ""')
      .all() as { id: string; title: string }[]
    for (const c of convs) ftsUpsertConversation(c.id, c.title)
    const msgs = db
      .prepare(
        "SELECT id, conversation_id, content FROM messages WHERE role IN ('user','assistant') AND content IS NOT NULL"
      )
      .all() as { id: string; conversation_id: string; content: string }[]
    for (const m of msgs) ftsInsertMessage(m.id, m.conversation_id, m.content)
    const rows = (db.prepare('SELECT COUNT(*) AS cnt FROM sessions_fts').get() as { cnt: number }).cnt
    return { rebuilt: true, rows }
  } catch (err) {
    console.error('[conversation-store] FTS backfill failed:', (err as Error).message)
    return { rebuilt: false, rows: 0 }
  }
}

// Suppress unused-import flag — `ftsDeleteMessage` is exposed for
// future per-message-edit support (T2:E5 compression will need it).
void ftsDeleteMessage

export function deleteConversation(id: string) {
  const db = getDb()
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
  // plan_steps / goals have no FK to conversations (the '__global__' bucket and
  // ephemeral runs need rows without a conversation row), so clear them here.
  clearConversationState(id)
  ftsDeleteAllForConversation(id)
}

export function updateConversationTitle(id: string, title: string) {
  const db = getDb()
  db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(
    title,
    Date.now(),
    id
  )
  ftsUpsertConversation(id, title)
}

export function updateConversationModel(id: string, model: string) {
  const db = getDb()
  db.prepare('UPDATE conversations SET model = ?, updated_at = ? WHERE id = ?').run(
    model,
    Date.now(),
    id
  )
}

export function setConversationProject(id: string, projectId: string | null) {
  const db = getDb()
  db.prepare('UPDATE conversations SET project_id = ?, updated_at = ? WHERE id = ?').run(
    projectId,
    Date.now(),
    id
  )
  if (projectId) touchProject(projectId)
}

// Track 2 / C3 — plan mode gate. The flag lives on the conversation row so
// it survives restarts; the dispatcher reads it before approving any
// mutating tool call. `isPlanModeActive` returns false for missing rows so
// stale conversation ids in flight cannot trip the gate.
export function isPlanModeActive(id: string): boolean {
  const db = getDb()
  const row = db
    .prepare('SELECT plan_mode_active FROM conversations WHERE id = ?')
    .get(id) as { plan_mode_active?: number } | undefined
  return !!(row && row.plan_mode_active === 1)
}

export function setPlanModeActive(id: string, active: boolean): boolean {
  const db = getDb()
  const result = db
    .prepare(
      'UPDATE conversations SET plan_mode_active = ?, updated_at = ? WHERE id = ?'
    )
    .run(active ? 1 : 0, Date.now(), id)
  return result.changes > 0
}

export function touchConversation(id: string) {
  const db = getDb()
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), id)
  // Bubble activity up to the parent project so it sorts to the top.
  const row = db
    .prepare('SELECT project_id FROM conversations WHERE id = ?')
    .get(id) as { project_id?: string | null } | undefined
  if (row?.project_id) touchProject(row.project_id)
}

/** Pull a leading <think>…</think> block out of an assistant content string
 *  and route it into the dedicated reasoning column. Models without a native
 *  reasoning_content streaming channel (everything except DeepSeek's V4-Flash
 *  thinking mode + the reasoner) emit reasoning inline because the contract
 *  forces them to lead every turn with <think>. Without this extraction, the
 *  reasoning would survive in `content` but never light up the Reasoning
 *  panel — which keys off the dedicated column. We extract at save time so
 *  the persistence shape is consistent regardless of which channel produced
 *  the reasoning. If `reasoning` is already populated (native channel did
 *  its job), leave `content` untouched. */
export function splitInlineReasoning(
  content: string,
  reasoning: string | undefined
): { content: string; reasoning: string | undefined } {
  if (reasoning && reasoning.length > 0) return { content, reasoning }
  const closed = content.match(/^\s*<think>([\s\S]*?)<\/think>\s*([\s\S]*)$/)
  if (closed) {
    return { content: closed[2], reasoning: closed[1].trim() }
  }
  return { content, reasoning }
}

/** Composer-aware variant: tries to pull inline `<think>…</think>` from
 *  `content` first; when that comes up empty AND a `draft` is supplied,
 *  re-runs the split against the draft and hoists any inline reasoning out.
 *  This lets the Reasoning panel survive Final Response Composer passes,
 *  which replace the original body in `content` with a clean rewrite and
 *  stash the original (which carries the inline block) in `draft`.
 *
 *  When neither place has a `<think>` block and `reasoning` was already
 *  supplied by the provider's native channel, the supplied value is
 *  passed through untouched. */
export function splitInlineReasoningWithDraft(
  content: string,
  reasoning: string | undefined,
  draft: string | undefined
): { content: string; reasoning: string | undefined } {
  const fromContent = splitInlineReasoning(content, reasoning)
  if (fromContent.reasoning && fromContent.reasoning.length > 0) {
    return fromContent
  }
  if (typeof draft !== 'string' || draft.length === 0) {
    return fromContent
  }
  const fromDraft = splitInlineReasoning(draft, undefined)
  if (fromDraft.reasoning && fromDraft.reasoning.length > 0) {
    return { content: fromContent.content, reasoning: fromDraft.reasoning }
  }
  return fromContent
}

export function saveMessage(msg: {
  id: string
  conversationId: string
  role: string
  content: string
  model?: string
  toolCallId?: string
  toolCalls?: StoredToolCall[]
  draft?: string
  reasoning?: string
  documents?: StoredDocument[]
  /** Reasoning Audit Phase R1 — multi-agent pipeline stage discriminator.
   *  Pass 'planner' / 'reviewer' / 'composer' from agent-pipeline.ts +
   *  chat.ts composer path. Omit (NULL) for single-agent + Coder rows. */
  stage?: MessageStage
  /** WC-4 — Persisted proof gate trust status. Omit (NULL) for read-only
   *  turns or non-assistant rows. Chat dispatch writes this after the M5
   *  gate evaluates. UI and composer consume from the column, not from
   *  message body text. */
  proofStatus?: ProofStatus
}) {
  const db = getDb()
  const now = Date.now()
  // Only assistant turns can carry reasoning — user/system/tool rows are
  // always pass-through so the <think> heuristic doesn't accidentally
  // mangle user input that happens to start with a literal <think>.
  //
  // Composer fallback: when the Final Response Composer rewrites the body,
  // chat.ts puts the ORIGINAL (which carries the inline `<think>…</think>`)
  // into `draft` and the composed clean text into `content`. The first
  // splitInlineReasoning call sees no inline block in `content` and returns
  // reasoning=undefined; the draft path below recovers the inline block so
  // the Reasoning panel survives composer passes. Without this, every
  // tool-using turn from inline-emitting models (Gemma, Qwen, V4 Pro
  // without thinking mode) loses its chain-of-thought the moment the
  // composer runs.
  const split =
    msg.role === 'assistant'
      ? splitInlineReasoningWithDraft(msg.content, msg.reasoning, msg.draft)
      : { content: msg.content, reasoning: msg.reasoning }
  // Robustness Hotfix HX4 (v0.8.4) — pseudo-XML sanitisation. Assistant
  // rows occasionally emit `<bash>find …</bash>` (or `<tool>`, `<run>`,
  // `<shell>`, etc.) as final prose instead of invoking a real tool. The
  // chat bubble would render the pseudo-XML as literal text and the user
  // has to re-prompt. We persist the sanitised text in `content` (what
  // every UI surface reads) and the verbatim original in `content_raw`
  // for the audit trail. Non-assistant rows pass through unchanged.
  //
  // FC-7 — when the assistant message has native tool calls (toolCalls
  // populated by the provider), skip sanitisation. The model used the API
  // correctly; pseudo-XML in prose alongside real tool_calls is never a
  // ghosted invocation. Fallback models (no tool_calls, supportsTools:
  // false) still run through the sanitizer.
  const hasNativeToolCalls = !!(msg.toolCalls && msg.toolCalls.length > 0)
  const sanitizedContent =
    msg.role === 'assistant' && !hasNativeToolCalls
      ? sanitizePseudoTags(split.content)
      : split.content
  const contentRaw =
    msg.role === 'assistant' && sanitizedContent !== split.content ? split.content : null
  const toolCallsJson = msg.toolCalls && msg.toolCalls.length > 0 ? JSON.stringify(msg.toolCalls) : null
  const documentsJson = msg.documents && msg.documents.length > 0 ? JSON.stringify(msg.documents) : null
  // PS3 — wrap the message INSERT + touchConversation + FTS sync in
  // withWriteRetry so a transient SQLITE_BUSY (post-busy_timeout, rare
  // multi-process edge case) doesn't drop a chat message silently.
  // This is the single highest-frequency writer in the app; a dropped
  // row leaves the renderer's optimistic-updated bubble without DB
  // backing on the next reload.
  withWriteRetry(
    () => {
      db.prepare(
        'INSERT INTO messages (id, conversation_id, role, content, model, tool_call_id, tool_calls, draft, reasoning, documents, stage, content_raw, proof_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        msg.id,
        msg.conversationId,
        msg.role,
        sanitizedContent,
        msg.model || null,
        msg.toolCallId || null,
        toolCallsJson,
        msg.draft || null,
        split.reasoning || null,
        documentsJson,
        msg.stage || null,
        contentRaw,
        msg.proofStatus || null,
        now
      )
      touchConversation(msg.conversationId)
      // E3: keep the cross-session FTS index in sync. User/assistant
      // bodies are the ones worth searching; system/tool messages are
      // usually plumbing and would inflate the index with noise. We index
      // the sanitised content so search matches what the user sees in the
      // bubble, not the pseudo-XML.
      if (msg.role === 'user' || msg.role === 'assistant') {
        ftsInsertMessage(msg.id, msg.conversationId, sanitizedContent)
      }
    },
    { label: 'conversation-store.saveMessage' }
  )
  return {
    id: msg.id,
    conversationId: msg.conversationId,
    role: msg.role,
    content: sanitizedContent,
    contentRaw: contentRaw ?? undefined,
    timestamp: now,
    model: msg.model,
    toolCallId: msg.toolCallId,
    toolCalls: msg.toolCalls,
    draft: msg.draft,
    reasoning: split.reasoning,
    documents: msg.documents,
    stage: msg.stage,
    proofStatus: msg.proofStatus
  }
}

/**
 * WC-5 — Flip a message's persisted proof_status. Used by the waiver
 * flow after the user explicitly waives a proof gate via the
 * `contracts:waive` IPC. Returns the new status on success, or null if
 * the message row does not exist.
 */
export function setMessageProofStatus(
  messageId: string,
  status: ProofStatus | null
): ProofStatus | null {
  const db = getDb()
  const result = db
    .prepare('UPDATE messages SET proof_status = ? WHERE id = ?')
    .run(status ?? null, messageId)
  if (result.changes === 0) return null
  return status
}

export function getMessages(conversationId: string) {
  const db = getDb()
  const rows = db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(conversationId) as MessageRow[]
  return rows.map((row) => {
    let toolCalls: StoredToolCall[] | undefined
    if (row.tool_calls) {
      try {
        const parsed = JSON.parse(row.tool_calls)
        if (Array.isArray(parsed)) toolCalls = parsed as StoredToolCall[]
      } catch {
        // Corrupt JSON — drop. The orphan-tool filter in chat.ts will
        // handle the consequence (drop tool replies that have no parent).
      }
    }
    let documents: StoredDocument[] | undefined
    if (row.documents) {
      try {
        const parsed = JSON.parse(row.documents)
        if (Array.isArray(parsed)) documents = parsed as StoredDocument[]
      } catch {
        // Same corrupt-JSON policy as toolCalls — drop and continue.
      }
    }
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role as 'user' | 'assistant' | 'system' | 'tool',
      content: row.content,
      timestamp: row.created_at,
      model: row.model || undefined,
      toolCallId: row.tool_call_id || undefined,
      // Track 2 / E5 — passed through to the renderer so the chat view
      // can show a CompressedRegionPill where originals were folded.
      compressedInto: row.compressed_into ?? undefined,
      toolCalls,
      reasoning: row.reasoning ?? undefined,
      documents,
      // Reasoning Audit Phase R1 — multi-agent pipeline stage discriminator.
      // NULL on legacy rows + Coder rows reaches the renderer as `undefined`,
      // which MessageBubble (R7) treats as "no chip, no toggle".
      stage: (row.stage ?? undefined) as MessageStage | undefined,
      // Robustness Hotfix HX4 (v0.8.4) — verbatim pre-sanitisation copy of
      // the assistant body. NULL on legacy + non-assistant + already-clean
      // assistant rows. Renderer ignores it; audit / export surfaces opt in.
      contentRaw: row.content_raw ?? undefined,
      // WC-4 — persisted proof gate trust status. NULL → undefined so the
      // renderer treats it as "not applicable" and renders no banner state.
      proofStatus: (row.proof_status ?? undefined) as ProofStatus | undefined
    }
  })
}
