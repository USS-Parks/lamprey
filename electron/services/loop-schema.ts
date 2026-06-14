// Loop Phase — the loops / loop_backlog / loop_runs DDL, as a standalone
// constant with NO imports so it can be shared by:
//   1. migration v17 (db-migrations.ts) — the production schema, and
//   2. loop-db-integration.test.ts — a node:sqlite run of the EXACT same DDL
//      (node:sqlite is built into Node, so it loads under vitest's ABI where
//      the Electron-built better-sqlite3 cannot — these tests never skip).
// Keeping the DDL in one place means the test can't drift from production.

export const LOOP_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS loops (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    mode TEXT NOT NULL CHECK(mode IN ('interval','self_paced','autonomous')),
    status TEXT NOT NULL CHECK(status IN ('running','paused','stopped','done','error')),
    instruction TEXT,
    model TEXT,
    interval_seconds INTEGER,
    max_iterations INTEGER,
    max_wallclock_ms INTEGER,
    token_budget INTEGER,
    iteration INTEGER NOT NULL DEFAULT 0,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER,
    last_iteration_at INTEGER,
    next_fire_at INTEGER,
    stop_reason TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_loops_due
    ON loops(status, next_fire_at ASC);

  CREATE TABLE IF NOT EXISTS loop_backlog (
    id TEXT PRIMARY KEY,
    loop_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    task TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','in_progress','done','skipped','error')),
    result TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_loop_backlog_next
    ON loop_backlog(loop_id, status, position ASC);

  CREATE TABLE IF NOT EXISTS loop_runs (
    id TEXT PRIMARY KEY,
    loop_id TEXT NOT NULL,
    iteration INTEGER NOT NULL,
    backlog_id TEXT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    status TEXT NOT NULL CHECK(status IN ('running','done','error','timeout')),
    tokens_used INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_loop_runs_loop
    ON loop_runs(loop_id, iteration ASC);
`
