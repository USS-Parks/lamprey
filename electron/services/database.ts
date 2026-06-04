import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { isVecAvailable, loadSqliteVec } from './rag/vec-loader'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = join(app.getPath('userData'), 'lamprey.db')
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    // Load sqlite-vec BEFORE migrations: the RAG vec0 virtual table can only
    // be created after the extension is registered. When the extension fails
    // to load (missing native binary on this target), `initSchema` skips the
    // vec0 table and the rest of the schema continues. RAG IPC handlers
    // surface the disabled state through `isVecAvailable()`.
    loadSqliteVec(db)
    initSchema(db)
  }
  return db
}

function safeAddColumn(db: Database.Database, table: string, ddl: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`)
  } catch (err: any) {
    // SQLite throws on duplicate column add. Swallow that; rethrow anything else.
    const msg = String(err?.message ?? err)
    if (!/duplicate column name/i.test(msg)) throw err
  }
}

function initSchema(db: Database.Database): void {
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
      path TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_activity_at INTEGER NOT NULL
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
  `)

  // Migrations for older DBs that predate kind/worktree_path/project_id columns.
  safeAddColumn(db, 'conversations', "kind TEXT NOT NULL DEFAULT 'local'")
  safeAddColumn(db, 'conversations', 'worktree_path TEXT')
  safeAddColumn(db, 'conversations', 'project_id TEXT')

  // Persisted tool_calls on assistant messages. Without this, replaying a
  // conversation that includes a tool round drops the assistant's tool_calls
  // and the API rejects the next turn with "Messages with role 'tool' must
  // be a response to a preceding message with 'tool_calls'".
  safeAddColumn(db, 'messages', 'tool_calls TEXT')

  // R12: link an assistant message to the rag_retrievals row that produced
  // its <retrieved_context>. Nullable — turns with no attached collections
  // leave it NULL. The chat handler (R10) sets it after persisting the
  // rag_retrievals row for the turn.
  safeAddColumn(db, 'messages', 'retrieval_id TEXT')

  // Final-response composer preservation. When a tool-using run receives the
  // model's draft answer, the composer rewrites it into a structured wrap-up;
  // this column keeps the original draft available for future replay or
  // inspection while the visible message body stores the composed response.
  safeAddColumn(db, 'messages', 'draft TEXT')

  // Audit provenance for tool_calls. 'modal' = user answered the approval
  // dialog; 'policy:<id>' = a persisted policy matched; 'none' = the call
  // was not gated (no requiresApproval, no gating risks).
  safeAddColumn(db, 'tool_calls', 'approval_source TEXT')

  // Parent call id — set on synthetic rows spawned from another tool (e.g.
  // sub-agent calls under `multi_agent_run`). Null for top-level
  // model-initiated calls. Lets the audit log answer "which fanout was this
  // sub-agent part of?" without log-time joining.
  safeAddColumn(db, 'tool_calls', 'parent_call_id TEXT')

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversations_project
      ON conversations(project_id, updated_at DESC);

    -- One row per project that has a GitHub repo association. We treat the
    -- link as 1:1 (a project maps to a single GitHub repo) — multi-repo
    -- projects can be modelled later by promoting this to a join table.
    -- local_path is nullable: a repo can be associated before it's cloned.
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

    -- Persisted PR links for a conversation, so the PR list can show which
    -- PRs Lamprey opened from this thread. The PR itself lives on GitHub;
    -- we just keep enough to deep-link back.
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
    -- All RAG tables share the main DB so a delete-all is atomic and there's
    -- no second-db orphan risk. Migrations are forward-additive via
    -- CREATE TABLE IF NOT EXISTS, matching the project's migration primitive.

    -- Collections: user-facing grouping (e.g. "Project docs", "Tax 2025").
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

    -- Documents: one row per ingested source (file or pasted blob).
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

    -- Chunks: the indexable atoms. collection_id is denormalized for query
    -- speed (retrieval scopes by collection without a join through documents).
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

    -- FTS5 mirror for lexical retrieval. Uses external-content mode keyed on
    -- rag_chunks.rowid; the triggers below keep FTS in sync on every
    -- chunk INSERT/UPDATE/DELETE.
    CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_fts USING fts5(
      text,
      heading_path,
      content='rag_chunks',
      content_rowid='rowid',
      tokenize='porter unicode61 remove_diacritics 2'
    );

    -- FTS sync triggers (idempotent — CREATE TRIGGER IF NOT EXISTS).
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

    -- Per-message retrieval record. results_json holds the ranked chunk_ids
    -- + per-leg scores; the persisted rows let Activity Timeline + the
    -- Reviewer agent reconstruct exactly what context the assistant saw.
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

    -- Per-conversation RAG attachments (R11). Exactly one of collection_id
    -- or document_id is set per row; the COALESCE keys keep that constraint
    -- enforceable at the schema level (NULL participates in unique by
    -- substituting ''). FK cascade so deleting a collection / document
    -- automatically clears its attachments.
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
  `)

  // The sqlite-vec virtual table is created separately and is gated on the
  // extension being available. When sqlite-vec failed to load, RAG vector
  // search is disabled — the rest of the RAG schema still works for lexical-
  // only retrieval (FTS5 is built into SQLite). The vec0 dimension matches
  // the v1 default embedder (bge-small / MiniLM, both 384-dim). Swapping to
  // a different embedder dimension is a future migration (drop+rebuild),
  // documented in LAMPREY_RAG_PLAN §2.3.
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

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
