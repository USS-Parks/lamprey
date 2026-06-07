import type { Database } from 'better-sqlite3'

export function applyProofReceiptSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS proof_receipts (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('passed','failed','skipped')),
      conversation_id TEXT,
      correlation_id TEXT,
      contract_id TEXT,
      tool_call_id TEXT,
      workspace_path TEXT NOT NULL,
      cwd TEXT NOT NULL,
      git_head TEXT,
      git_dirty INTEGER NOT NULL DEFAULT 0,
      diff_hash TEXT,
      command TEXT NOT NULL,
      command_hash TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      exit_code INTEGER,
      timed_out INTEGER NOT NULL DEFAULT 0,
      stdout_hash TEXT NOT NULL,
      stderr_hash TEXT NOT NULL,
      stdout_preview TEXT NOT NULL DEFAULT '',
      stderr_preview TEXT NOT NULL DEFAULT '',
      stdout_truncated INTEGER NOT NULL DEFAULT 0,
      stderr_truncated INTEGER NOT NULL DEFAULT 0,
      stdout_bytes INTEGER NOT NULL DEFAULT 0,
      stderr_bytes INTEGER NOT NULL DEFAULT 0,
      parsed_metrics_json TEXT NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL CHECK(created_by IN ('agent','system','user','ci')),
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_proof_receipts_conversation
      ON proof_receipts(conversation_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_proof_receipts_correlation
      ON proof_receipts(correlation_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_proof_receipts_contract
      ON proof_receipts(contract_id, status, finished_at DESC);
    CREATE INDEX IF NOT EXISTS idx_proof_receipts_workspace
      ON proof_receipts(workspace_path, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_proof_receipts_tool_call
      ON proof_receipts(tool_call_id);

    CREATE TABLE IF NOT EXISTS proof_receipt_artifacts (
      id TEXT PRIMARY KEY,
      receipt_id TEXT NOT NULL REFERENCES proof_receipts(id) ON DELETE CASCADE,
      stream TEXT NOT NULL CHECK(stream IN ('stdout','stderr')),
      byte_count INTEGER NOT NULL,
      hash TEXT NOT NULL,
      content_preview TEXT NOT NULL,
      content_truncated INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_proof_receipt_artifacts_receipt
      ON proof_receipt_artifacts(receipt_id);

    CREATE TRIGGER IF NOT EXISTS proof_receipts_no_update
      BEFORE UPDATE ON proof_receipts
      BEGIN
        SELECT RAISE(ABORT, 'proof_receipts are append-only');
      END;

    CREATE TRIGGER IF NOT EXISTS proof_receipts_no_delete
      BEFORE DELETE ON proof_receipts
      BEGIN
        SELECT RAISE(ABORT, 'proof_receipts are append-only');
      END;

    CREATE TRIGGER IF NOT EXISTS proof_receipt_artifacts_no_update
      BEFORE UPDATE ON proof_receipt_artifacts
      BEGIN
        SELECT RAISE(ABORT, 'proof_receipt_artifacts are append-only');
      END;

    CREATE TRIGGER IF NOT EXISTS proof_receipt_artifacts_no_delete
      BEFORE DELETE ON proof_receipt_artifacts
      BEGIN
        SELECT RAISE(ABORT, 'proof_receipt_artifacts are append-only');
      END;
  `)
}
