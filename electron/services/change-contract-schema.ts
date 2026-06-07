import type { Database } from 'better-sqlite3'

export function applyChangeContractSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS change_contracts (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      correlation_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('active','closed','waived')),
      implicit INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL CHECK(source IN ('user','plan_goal','implicit','system')),
      goal TEXT NOT NULL,
      acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
      expected_files_json TEXT NOT NULL DEFAULT '[]',
      non_goals_json TEXT NOT NULL DEFAULT '[]',
      verification_commands_json TEXT NOT NULL DEFAULT '[]',
      required_receipt_kinds_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      closed_at INTEGER,
      waiver_reason TEXT,
      waived_by TEXT,
      waived_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_change_contracts_conversation
      ON change_contracts(conversation_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_change_contracts_correlation
      ON change_contracts(correlation_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_change_contracts_active
      ON change_contracts(conversation_id, status, updated_at DESC);
  `)
}
