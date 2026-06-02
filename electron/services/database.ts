import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = join(app.getPath('userData'), 'lamprey.db')
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
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
  `)
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
