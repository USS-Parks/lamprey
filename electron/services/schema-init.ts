import type Database from 'better-sqlite3'
import { isVecAvailable } from './rag/vec-loader'

// Persistence Phase / PS6 — partitioned schema initializer.
//
// The pre-PS6 `initSchema` in `database.ts` was ~700 lines of inline DDL
// + `safeAddColumn` calls in one function. PS6 extracts the body into
// named per-domain segments here. `database.ts.initSchema` becomes a
// dispatcher that calls each segment in the SAME ORDER as the original
// monolithic function — preserving the DDL execution order is
// non-negotiable (FK references, FTS triggers, and CREATE INDEX
// ordering all depend on it).
//
// Each segment is a pure function `(db) => void`. The `safeAddColumn`
// primitive lives here as well so callers don't need a separate
// migration helper import path. New schema work (PS7's
// `rag_embedder_meta`, future PS11 fork-lineage columns) lands in the
// PS1 migration ledger (`db-migrations.ts`), NOT here — this file is
// the legacy bootstrap for pre-PS1 schema and stays additive only.
//
// Splitting further into per-`*-store.ts`-adjacent files is a
// follow-up: today the cleanest line is segment-by-segment within this
// single file, which captures the domain partition in readable form
// without spreading risky DDL ordering changes across many files.

function safeAddColumn(db: Database.Database, table: string, ddl: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`)
  } catch (err: any) {
    // SQLite throws on duplicate column add. Swallow that; rethrow anything else.
    const msg = String(err?.message ?? err)
    if (!/duplicate column name/i.test(msg)) throw err
  }
}

// ───────────────────────── Segment 1: core domain tables ─────────────────────────
// conversations, messages, memory_entries, memory_index (+ FTS + triggers),
// hooks, automations, projects, tool_calls, permission_policies,
// plan_steps, goals, events, agent_runs, loop_wakeups.
//
// These all live in a single db.exec for two reasons:
//   1. The pre-PS6 code grouped them this way, so keeping the boundary
//      preserves byte-identical DDL execution order.
//   2. Several CREATE INDEX statements depend on tables defined earlier
//      in the same block; splitting them would require re-asserting the
//      order explicitly via dispatcher comments. A single block is
//      self-documenting on that front.
function initCoreDomainTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      model TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
      content TEXT NOT NULL,
      model TEXT,
      tool_call_id TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS memory_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      source_conversation_id TEXT
    );

    -- File-backed memory index (parity Track 3, D1). Files at
    -- userData/lamprey-memory/<projectSlug>/<slug>.md are the canonical
    -- store; this table mirrors them so list/search runs against SQL
    -- instead of re-parsing every file. The store keeps the mirror in
    -- sync via the chokidar watcher.
    CREATE TABLE IF NOT EXISTS memory_index (
      name TEXT PRIMARY KEY,
      project_slug TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('user','feedback','project','reference')),
      description TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      source_conversation_id TEXT,
      file_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_memory_index_type
      ON memory_index(type, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_index_project
      ON memory_index(project_slug, updated_at DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_index_fts USING fts5(
      name, description, body,
      content='memory_index', content_rowid='rowid',
      tokenize='porter unicode61 remove_diacritics 2'
    );

    CREATE TRIGGER IF NOT EXISTS memory_index_fts_ai
      AFTER INSERT ON memory_index BEGIN
        INSERT INTO memory_index_fts(rowid, name, description, body)
        VALUES (new.rowid, new.name, new.description, new.body);
      END;
    CREATE TRIGGER IF NOT EXISTS memory_index_fts_ad
      AFTER DELETE ON memory_index BEGIN
        INSERT INTO memory_index_fts(memory_index_fts, rowid, name, description, body)
        VALUES ('delete', old.rowid, old.name, old.description, old.body);
      END;
    CREATE TRIGGER IF NOT EXISTS memory_index_fts_au
      AFTER UPDATE ON memory_index BEGIN
        INSERT INTO memory_index_fts(memory_index_fts, rowid, name, description, body)
        VALUES ('delete', old.rowid, old.name, old.description, old.body);
        INSERT INTO memory_index_fts(rowid, name, description, body)
        VALUES (new.rowid, new.name, new.description, new.body);
      END;

    CREATE TABLE IF NOT EXISTS hooks (
      id TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      label TEXT NOT NULL,
      command TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      cron TEXT NOT NULL,
      prompt TEXT NOT NULL,
      model TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      last_run_at INTEGER,
      last_result TEXT
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL DEFAULT '',
      path TEXT,
      description TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0,
      last_activity_at INTEGER NOT NULL,
      last_opened_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_projects_archived_activity
      ON projects(archived, last_activity_at DESC);

    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY,
      tool_id TEXT NOT NULL,
      name TEXT NOT NULL,
      conversation_id TEXT,
      args_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','approved','denied','running','done','error')),
      result_preview TEXT,
      error TEXT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      duration_ms INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_tool_calls_recent
      ON tool_calls(started_at DESC);

    CREATE INDEX IF NOT EXISTS idx_tool_calls_conversation
      ON tool_calls(conversation_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS permission_policies (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL CHECK(scope IN ('conversation','workspace','global')),
      subject_kind TEXT NOT NULL CHECK(subject_kind IN ('tool','risk')),
      subject TEXT NOT NULL,
      decision TEXT NOT NULL CHECK(decision IN ('allow','deny')),
      conversation_id TEXT,
      workspace_path TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Resolution scans by scope + subject_kind + subject; the partial-conv and
    -- partial-workspace lookups also need to match by the scoping id.
    CREATE INDEX IF NOT EXISTS idx_permission_policies_scope
      ON permission_policies(scope, subject_kind, subject);
    CREATE INDEX IF NOT EXISTS idx_permission_policies_conv
      ON permission_policies(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_permission_policies_workspace
      ON permission_policies(workspace_path);

    -- Per-conversation plan steps for the update_plan tool / PlanChecklist.
    -- conversation_id holds '__global__' for the shared (no-conversation)
    -- bucket; no FK so global + ephemeral-conversation state is allowed.
    -- Order is carried by position (the in-memory plan is an ordered array).
    CREATE TABLE IF NOT EXISTS plan_steps (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      text TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','in_progress','done')),
      position INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_plan_steps_conversation
      ON plan_steps(conversation_id, position);

    -- Per-conversation goals for create_goal / update_goal / get_goal.
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      due_date TEXT,
      status TEXT NOT NULL CHECK(status IN ('open','in_progress','done','abandoned')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_goals_conversation
      ON goals(conversation_id, updated_at DESC);

    -- Append-only event spine. Cross-system audit/timeline complement to the
    -- structured domain tables (tool_calls, permission_policies, automations).
    -- Writers go through electron/services/event-log.ts which owns JSON
    -- serialization, payload size caps, and metadata-only redaction. The table
    -- itself is intentionally permissive — strict CHECK constraints would force
    -- migrations every time we add an event category.
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      conversation_id TEXT,
      project_id TEXT,
      workspace_path TEXT,
      automation_id TEXT,
      tool_call_id TEXT,
      parent_event_id TEXT,
      correlation_id TEXT,
      actor_kind TEXT NOT NULL,
      actor_id TEXT,
      entity_kind TEXT,
      entity_id TEXT,
      payload_json TEXT NOT NULL,
      redaction TEXT NOT NULL DEFAULT 'metadata'
    );

    CREATE INDEX IF NOT EXISTS idx_events_recent
      ON events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_conversation
      ON events(conversation_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_project
      ON events(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_workspace
      ON events(workspace_path, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_correlation
      ON events(correlation_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_events_type
      ON events(type, created_at DESC);

    -- Track 1 / A2: background-agent lifecycle. One row per forkAgent call
    -- that was tracked (production wires the store; tests/inline forks may
    -- skip). The runId is the same runId the in-memory subagent-runner
    -- registry uses, so tasks:stop can find the live handle.
    --   status:          'running' on insert; 'done' | 'error' | 'aborted' on finish
    --   background:      1 if the fork was launched with runInBackground:true
    --   worktree_path:   set by A3's isolation mode; NULL otherwise
    CREATE TABLE IF NOT EXISTS agent_runs (
      id              TEXT PRIMARY KEY,
      parent_conv_id  TEXT,
      parent_run_id   TEXT,
      agent_type      TEXT NOT NULL,
      label           TEXT NOT NULL,
      status          TEXT NOT NULL CHECK(status IN ('running','done','error','aborted')),
      started_at      INTEGER NOT NULL,
      finished_at     INTEGER,
      result_text     TEXT,
      error           TEXT,
      worktree_path   TEXT,
      background      INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_agent_runs_conv
      ON agent_runs(parent_conv_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_status
      ON agent_runs(status, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_parent_run
      ON agent_runs(parent_run_id, started_at DESC);

    -- Track 3 / G2: self-paced loop wake-ups. Rows are scheduled by the
    -- schedule_wakeup tool or loops:schedule IPC, then a 30s runner marks
    -- due rows fired and appends a user-visible wake-up message.
    CREATE TABLE IF NOT EXISTS loop_wakeups (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      fire_at         INTEGER NOT NULL,
      prompt          TEXT NOT NULL,
      reason          TEXT,
      status          TEXT NOT NULL CHECK(status IN ('pending','fired','cancelled','error')),
      created_at      INTEGER NOT NULL,
      fired_at        INTEGER,
      error           TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_loop_wakeups_due
      ON loop_wakeups(status, fire_at ASC);
    CREATE INDEX IF NOT EXISTS idx_loop_wakeups_conversation
      ON loop_wakeups(conversation_id, fire_at DESC);

  `)
}

// ───────────────────────── Segment 2: legacy column migrations (batch A) ─────────────────────────
// safeAddColumn calls for the first wave of post-baseline columns:
// conversations (kind, worktree_path, project_id, archived, pinned_at,
// plan_mode_active), messages (tool_calls, retrieval_id, draft,
// reasoning), tool_calls (approval_source), hooks (language,
// timeout_ms). Each call is idempotent (the helper swallows duplicate
// column name); the comments preserve the historical phase rationale.
function applyLegacyColumnMigrationsBatchA(db: Database.Database): void {
  // Migrations for older DBs that predate kind/worktree_path/project_id columns.
  safeAddColumn(db, 'conversations', "kind TEXT NOT NULL DEFAULT 'local'")
  safeAddColumn(db, 'conversations', 'worktree_path TEXT')
  safeAddColumn(db, 'conversations', 'project_id TEXT')
  // E3: archive flag + pin timestamp for the Sessions sidebar
  // (Recent / Pinned / Archived tabs). pinned_at is NULL when the
  // conversation isn't pinned so the index stays small.
  safeAddColumn(db, 'conversations', 'archived INTEGER NOT NULL DEFAULT 0')
  safeAddColumn(db, 'conversations', 'pinned_at INTEGER')

  // Persisted tool_calls on assistant messages.
  safeAddColumn(db, 'messages', 'tool_calls TEXT')
  // R12: link an assistant message to the rag_retrievals row.
  safeAddColumn(db, 'messages', 'retrieval_id TEXT')
  // Final-response composer preservation.
  safeAddColumn(db, 'messages', 'draft TEXT')
  // DeepSeek reasoners + V4-Flash thinking-mode chain-of-thought.
  safeAddColumn(db, 'messages', 'reasoning TEXT')

  // Audit provenance for tool_calls.
  safeAddColumn(db, 'tool_calls', 'approval_source TEXT')

  // Track 2 / C2 — hooks language + timeout_ms.
  safeAddColumn(db, 'hooks', "language TEXT NOT NULL DEFAULT 'shell'")
  safeAddColumn(db, 'hooks', 'timeout_ms INTEGER NOT NULL DEFAULT 5000')

  // Track 2 / C3 — per-conversation plan-mode flag.
  safeAddColumn(db, 'conversations', 'plan_mode_active INTEGER NOT NULL DEFAULT 0')
}

// ───────────────────────── Segment 3: chapters + async_events tables ─────────────────────────
// Track 2 / E1 (chapters) and E6 (async_events) tables, plus the E5
// `compressed_into` column on messages. Order matters: the
// safeAddColumn for compressed_into sits between the two db.exec blocks
// in the pre-PS6 code; preserved here.
function initChaptersAsyncEvents(db: Database.Database): void {
  // Track 2 / E1 — session chapters.
  db.exec(`
    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      summary TEXT,
      anchor_message_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chapters_conversation
      ON chapters(conversation_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_chapters_anchor
      ON chapters(anchor_message_id);
  `)

  // Track 2 / E5 — auto context compression marker on messages.
  safeAddColumn(db, 'messages', 'compressed_into TEXT')

  // Track 2 / E6 — async events queue for cross-tool notifications.
  db.exec(`
    CREATE TABLE IF NOT EXISTS async_events (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      delivered_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_async_events_pending
      ON async_events(conversation_id, delivered_at, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_async_events_kind
      ON async_events(kind, created_at DESC);
  `)
}

// ───────────────────────── Segment 4: legacy column migrations (batch B) ─────────────────────────
// tool_calls.parent_call_id, messages.documents, messages.stage (R1
// from Reasoning Audit Phase), messages.content_raw (HX3 from
// Robustness Hotfix). Same idempotency contract as batch A.
function applyLegacyColumnMigrationsBatchB(db: Database.Database): void {
  // Parent call id — set on synthetic rows spawned from another tool.
  safeAddColumn(db, 'tool_calls', 'parent_call_id TEXT')
  // Documents the assistant emitted via the `create_document` native tool.
  safeAddColumn(db, 'messages', 'documents TEXT')
  // Reasoning Audit Phase R1: per-stage discriminator for assistant rows.
  safeAddColumn(db, 'messages', 'stage TEXT')
  // Robustness Hotfix HX3 (v0.8.4): verbatim pre-sanitization body.
  safeAddColumn(db, 'messages', 'content_raw TEXT')
}

// ───────────────────────── Segment 5: github + rag + sessions_fts + snip ─────────────────────────
// project_github_repos + conversation_pull_requests; the full RAG
// subtree (collections, documents, chunks + FTS + triggers, retrievals,
// attachments); the cross-session sessions_fts; archive/pin indexes on
// conversations; snip_events + snip_command_log. All sit in a single
// db.exec block to preserve the pre-PS6 ordering and FK references.
function initGithubRagSessionsSnip(db: Database.Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversations_project
      ON conversations(project_id, updated_at DESC);

    -- One row per project that has a GitHub repo association.
    CREATE TABLE IF NOT EXISTS project_github_repos (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      repo_id INTEGER NOT NULL,
      full_name TEXT NOT NULL,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      default_branch TEXT NOT NULL,
      html_url TEXT NOT NULL,
      clone_url TEXT NOT NULL,
      local_path TEXT,
      linked_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_project_github_repos_full_name
      ON project_github_repos(full_name);

    -- Persisted PR links for a conversation.
    CREATE TABLE IF NOT EXISTS conversation_pull_requests (
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      pr_number INTEGER NOT NULL,
      full_name TEXT NOT NULL,
      html_url TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, full_name, pr_number)
    );

    -- ──────────────────── RAG (Local retrieval) ────────────────────
    -- See PLANNING/LAMPREY_RAG_PLAN.md §2.2 for the schema design rationale.
    CREATE TABLE IF NOT EXISTS rag_collections (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT,
      embedder_id   TEXT NOT NULL,
      chunk_size    INTEGER NOT NULL DEFAULT 800,
      chunk_overlap INTEGER NOT NULL DEFAULT 100,
      workspace_path TEXT,
      project_id    TEXT,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_rag_collections_updated
      ON rag_collections(updated_at DESC);

    CREATE TABLE IF NOT EXISTS rag_documents (
      id            TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL REFERENCES rag_collections(id) ON DELETE CASCADE,
      source_kind   TEXT NOT NULL CHECK(source_kind IN ('file','paste','workspace','skill','memory','planning')),
      source_path   TEXT,
      display_name  TEXT NOT NULL,
      mime          TEXT,
      bytes         INTEGER,
      hash_sha256   TEXT NOT NULL,
      mtime         INTEGER,
      status        TEXT NOT NULL CHECK(status IN ('queued','loading','chunking','embedding','ready','error','stale')),
      status_detail TEXT,
      chunk_count   INTEGER NOT NULL DEFAULT 0,
      ingested_at   INTEGER,
      updated_at    INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_rag_documents_collection
      ON rag_documents(collection_id);
    CREATE INDEX IF NOT EXISTS idx_rag_documents_status
      ON rag_documents(status);
    CREATE INDEX IF NOT EXISTS idx_rag_documents_hash
      ON rag_documents(hash_sha256);

    CREATE TABLE IF NOT EXISTS rag_chunks (
      id            TEXT PRIMARY KEY,
      document_id   TEXT NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
      collection_id TEXT NOT NULL,
      chunk_index   INTEGER NOT NULL,
      start_offset  INTEGER NOT NULL,
      end_offset    INTEGER NOT NULL,
      heading_path  TEXT,
      page          INTEGER,
      line_start    INTEGER,
      line_end      INTEGER,
      text          TEXT NOT NULL,
      token_count   INTEGER,
      created_at    INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_rag_chunks_document
      ON rag_chunks(document_id, chunk_index);
    CREATE INDEX IF NOT EXISTS idx_rag_chunks_collection
      ON rag_chunks(collection_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_fts USING fts5(
      text,
      heading_path,
      content='rag_chunks',
      content_rowid='rowid',
      tokenize='porter unicode61 remove_diacritics 2'
    );

    CREATE TRIGGER IF NOT EXISTS rag_chunks_fts_ai
      AFTER INSERT ON rag_chunks BEGIN
        INSERT INTO rag_chunks_fts(rowid, text, heading_path)
        VALUES (new.rowid, new.text, new.heading_path);
      END;
    CREATE TRIGGER IF NOT EXISTS rag_chunks_fts_ad
      AFTER DELETE ON rag_chunks BEGIN
        INSERT INTO rag_chunks_fts(rag_chunks_fts, rowid, text, heading_path)
        VALUES ('delete', old.rowid, old.text, old.heading_path);
      END;
    CREATE TRIGGER IF NOT EXISTS rag_chunks_fts_au
      AFTER UPDATE ON rag_chunks BEGIN
        INSERT INTO rag_chunks_fts(rag_chunks_fts, rowid, text, heading_path)
        VALUES ('delete', old.rowid, old.text, old.heading_path);
        INSERT INTO rag_chunks_fts(rowid, text, heading_path)
        VALUES (new.rowid, new.text, new.heading_path);
      END;

    CREATE TABLE IF NOT EXISTS rag_retrievals (
      id              TEXT PRIMARY KEY,
      message_id      TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      query_text      TEXT NOT NULL,
      query_kind      TEXT NOT NULL,
      scopes_json     TEXT NOT NULL,
      results_json    TEXT NOT NULL,
      duration_ms     INTEGER,
      created_at      INTEGER NOT NULL,
      correlation_id  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_rag_retrievals_message
      ON rag_retrievals(message_id);
    CREATE INDEX IF NOT EXISTS idx_rag_retrievals_conversation
      ON rag_retrievals(conversation_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS conversation_rag_attachments (
      conversation_id TEXT NOT NULL,
      collection_id   TEXT,
      document_id     TEXT,
      attached_at     INTEGER NOT NULL,
      PRIMARY KEY (
        conversation_id,
        COALESCE(collection_id, ''),
        COALESCE(document_id, '')
      )
    );

    CREATE INDEX IF NOT EXISTS idx_conversation_rag_attachments_conv
      ON conversation_rag_attachments(conversation_id);

    -- E3: cross-session FTS5 over conversation titles + message bodies.
    CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
      source UNINDEXED,
      conversation_id UNINDEXED,
      message_id UNINDEXED,
      title,
      body,
      tokenize='porter unicode61 remove_diacritics 2'
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_archived
      ON conversations(archived, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conversations_pinned
      ON conversations(pinned_at DESC);

    -- Snip Phase K8.
    CREATE TABLE IF NOT EXISTS snip_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      command TEXT NOT NULL,
      filter_name TEXT NOT NULL,
      bytes_before INTEGER NOT NULL,
      bytes_after INTEGER NOT NULL,
      tokens_before INTEGER NOT NULL,
      tokens_after INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      conversation_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_snip_events_ts
      ON snip_events(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_snip_events_filter
      ON snip_events(filter_name, ts DESC);

    CREATE TABLE IF NOT EXISTS snip_command_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      command TEXT NOT NULL,
      command_head TEXT NOT NULL,
      tokens INTEGER NOT NULL,
      matched_filter TEXT,
      conversation_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_snip_command_log_ts
      ON snip_command_log(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_snip_command_log_head
      ON snip_command_log(command_head, ts DESC);
  `)
}

// ───────────────────────── Segment 6: message_stage_metrics (RT2) ─────────────────────────
// Reasoning-Trace Phase / RT2 — per-stage token + duration metrics for
// multi-agent pipelines. FK→messages.id with ON DELETE CASCADE means a
// deleted conversation cleans up its metrics transitively.
function initStageMetricsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_stage_metrics (
      id                TEXT PRIMARY KEY,
      message_id        TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      stage             TEXT NOT NULL CHECK(stage IN ('planner','coder','reviewer','single')),
      model             TEXT,
      prompt_tokens     INTEGER,
      completion_tokens INTEGER,
      duration_ms       INTEGER,
      created_at        INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_message_stage_metrics_message
      ON message_stage_metrics(message_id, created_at ASC);
  `)
}

// ───────────────────────── Segment 7: rag_chunk_vec (gated on sqlite-vec) ─────────────────────────
// The vec0 virtual table is created separately and is gated on the
// extension being available. When sqlite-vec failed to load, RAG vector
// search is disabled — the rest of the RAG schema still works for
// lexical-only retrieval (FTS5 is built into SQLite). The vec0 dimension
// matches the v1 default embedder (bge-small / MiniLM, both 384-dim).
// PS7's rag_embedder_meta + assertEmbedderDimensionMatch make a future
// embedder swap a structured error rather than a silent failure.
function initVecTable(db: Database.Database): void {
  if (isVecAvailable()) {
    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunk_vec USING vec0(
          chunk_rowid INTEGER PRIMARY KEY,
          embedding   FLOAT[384]
        );
      `)
    } catch (err) {
      console.warn('[db] rag_chunk_vec creation failed (continuing without vec):', err)
    }
  }
}

/**
 * PS6 — partitioned schema initializer. Dispatches each segment in
 * the same order as the pre-PS6 monolithic function. Order is
 * non-negotiable; future schema work lands as a Migration entry in
 * `db-migrations.ts`, NOT as a new segment here.
 */
export function initLegacySchema(db: Database.Database): void {
  initCoreDomainTables(db)
  applyLegacyColumnMigrationsBatchA(db)
  initChaptersAsyncEvents(db)
  applyLegacyColumnMigrationsBatchB(db)
  initGithubRagSessionsSnip(db)
  initStageMetricsTable(db)
  initVecTable(db)
}
