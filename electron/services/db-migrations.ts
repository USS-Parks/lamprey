import type { Database } from 'better-sqlite3'
import { applyChangeContractSchema } from './change-contract-schema'
import { applyProofReceiptSchema } from './proof-receipt-schema'
import { applyFailureLedgerSchema } from './failure-ledger-schema'

// Persistence Phase / PS1 — migration ledger gated by PRAGMA user_version.
//
// Rationale: until v0.9.0 the schema evolved via `safeAddColumn` alone — a
// regex-guarded ALTER TABLE that swallows "duplicate column name" and lets
// every other failure bubble. That worked while every change was idempotent
// (column adds with NULL-friendly defaults). The moment we need a non-
// idempotent step — data backfill, FTS rebuild, vec0 dimension swap — we
// have no way to know whether a previous launch ran it. A partial migration
// on a crashed startup is invisible.
//
// `PRAGMA user_version` is SQLite's built-in single-integer ledger. It is
// atomic in WAL mode and costs nothing to read. We use it as the marker;
// the typed `MIGRATIONS` array below is the source of truth for what each
// version means.
//
// Discipline (per the phase plan §0.6):
//   - `safeAddColumn` stays for idempotent column adds INSIDE a migration's
//     `up(db)`.
//   - Non-idempotent steps (backfills, rebuilds, drops) MUST go through a
//     migration. They run exactly once per DB and gate on `user_version`.
//   - Each migration's `up(db)` runs INSIDE a single transaction wrapping
//     the user_version bump. A throw rolls back both the DDL/DML and the
//     version stamp — the next launch retries from the same version.
//   - Migrations are append-only and ordered by `version`. Renumbering is
//     forbidden; a typo is a new migration with a fix-forward `up`.
//
// Baseline: v0.8.x DBs come in stamped at user_version = 0 (SQLite default).
// Migration v1 is the "stamp existing schema" no-op — it just asserts the
// baseline tables exist and bumps the version. Future PS prompts (PS6, PS7,
// PS9, PS11) append entries with version 2, 3, … each guarded by the same
// transaction discipline.

export interface Migration {
  /** Monotonic version this migration upgrades the DB TO. */
  version: number
  /** One-line description, surfaced in logs + the Persistence Settings panel. */
  description: string
  /**
   * Apply the migration. Runs inside a transaction with the user_version
   * bump. Throw to abort the whole migration; the rollback restores both
   * the schema and the version stamp atomically.
   */
  up(db: Database): void
}

/**
 * Migration registry. Ordered by `version`. Append-only.
 *
 * IMPORTANT: never renumber. Never delete. If a migration was wrong, add a
 * fix-forward migration with the next version number.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'PS1 baseline: stamp the v0.8.x schema as version 1',
    up(db) {
      // No DDL. The baseline tables are produced by `initSchema` (which runs
      // before us on every startup) + the historical `safeAddColumn` calls.
      // This migration's only job is to bump user_version from 0 to 1 so
      // subsequent versioned migrations have a known floor to gate against.
      //
      // We still sanity-check that the canonical baseline tables exist —
      // a DB that's been corrupted to the point of missing them is a
      // recovery case, not a migration case, and we want to fail loudly
      // rather than mark it migrated.
      const required = ['conversations', 'messages', 'events']
      const stmt = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
      )
      for (const name of required) {
        const row = stmt.get(name)
        if (!row) {
          throw new Error(
            `db-migrations v1: baseline table ${JSON.stringify(name)} is missing — ` +
              `cannot stamp user_version. Run initSchema first.`
          )
        }
      }
    }
  },
  {
    version: 2,
    description:
      'PS7 embedder meta — record active embedder + dimensions for vec0 dim-guard',
    up(db) {
      // Singleton table. The PRIMARY KEY constraint on `id` + the
      // hard-coded 'singleton' value means there is at most one row,
      // ever. stamp/read helpers in rag/embedder-meta.ts enforce that.
      //
      // No backfill: a DB that already has rag_chunk_vec rows but no
      // meta row is treated as "unknown embedder, assume default";
      // assertEmbedderDimensionMatch stamps the first row on first
      // post-PS7 ingest. That's safe because the only dims-in-use up
      // to this point are 384 (both catalogue entries).
      db.exec(`
        CREATE TABLE IF NOT EXISTS rag_embedder_meta (
          id          TEXT PRIMARY KEY CHECK(id = 'singleton'),
          embedder_id TEXT NOT NULL,
          dimensions  INTEGER NOT NULL,
          stamped_at  INTEGER NOT NULL
        );
      `)
    }
  },
  {
    version: 11,
    description: 'PS11 fork lineage and seed metadata columns',
    up(db) {
      // Idempotent column adds via local safeAddColumn helper —
      // db-migrations.ts owns its own safeAddColumn since schema-init.ts
      // (PS6's owner) is the legacy bootstrap and migrations are the
      // canonical path for new columns going forward.
      const safeAddColumn = (table: string, ddl: string): void => {
        try {
          db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`)
        } catch (err: any) {
          const msg = String(err?.message ?? err)
          if (!/duplicate column name/i.test(msg)) throw err
        }
      }
      safeAddColumn('conversations', 'forked_from_id TEXT')
      safeAddColumn('conversations', 'forked_from_message_id TEXT')
      safeAddColumn('conversations', 'seed_blob TEXT')
      safeAddColumn(
        'conversations',
        "seed_source_kind TEXT NOT NULL DEFAULT 'none' CHECK(seed_source_kind IN ('none','message','block','transcript-range','custom'))"
      )
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_conversations_forked_from
          ON conversations(forked_from_id, created_at DESC);
      `)
    }
  },
  {
    version: 12,
    description: 'Mechanical proof M1 receipt and artifact tables',
    up(db) {
      applyProofReceiptSchema(db)
    }
  },
  {
    version: 13,
    description: 'Mechanical proof M2 scoped change contracts',
    up(db) {
      applyChangeContractSchema(db)
    }
  },
  {
    version: 14,
    description: 'Mechanical proof M11 failure ledger and replay seeds',
    up(db) {
      applyFailureLedgerSchema(db)
    }
  },
  {
    version: 15,
    description: 'PRJ-2 project model extension — slug, description, updated_at, last_opened_at',
    up(db) {
      const safeAdd = (table: string, ddl: string): void => {
        try {
          db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`)
        } catch (err: any) {
          if (!/duplicate column name/i.test(String(err?.message ?? err))) throw err
        }
      }
      safeAdd('projects', "slug TEXT NOT NULL DEFAULT ''")
      safeAdd('projects', 'description TEXT')
      safeAdd('projects', 'updated_at INTEGER NOT NULL DEFAULT 0')
      safeAdd('projects', 'last_opened_at INTEGER')
    }
  }
]

/**
 * Most recent migration version. Computed from the registry so it stays in
 * sync with appends.
 */
export const LATEST_VERSION: number = MIGRATIONS.reduce(
  (acc, m) => (m.version > acc ? m.version : acc),
  0
)

/** Result reported by `runMigrations` — for tests + the Persistence panel. */
export interface MigrationResult {
  /** user_version before the call. */
  startVersion: number
  /** user_version after the call. Equals `startVersion` when nothing ran. */
  endVersion: number
  /** Versions that actually executed in this call. */
  applied: number[]
}

/**
 * Read `user_version`, run every migration whose `version > user_version` in
 * ascending order, each inside its own transaction that also bumps the
 * version stamp. Returns a structured report.
 *
 * Idempotent: calling twice in a row makes the second call a no-op.
 *
 * Crash-safe: a throw inside any `up(db)` rolls back that migration's
 * transaction (DDL + version bump together). The next launch retries from
 * the same version.
 */
export function runMigrations(db: Database): MigrationResult {
  // `PRAGMA user_version` returns a number in better-sqlite3.
  const start = readUserVersion(db)
  const applied: number[] = []

  // Defensive: a DB carrying a version higher than the code knows about
  // means the user downgraded the app. We refuse rather than risk running
  // older migrations against a newer schema.
  if (start > LATEST_VERSION) {
    throw new Error(
      `db-migrations: DB user_version is ${start} but this build only knows ` +
        `migrations up to v${LATEST_VERSION}. Did you downgrade Lamprey? ` +
        `Refusing to run — please launch the newer version or restore a backup.`
    )
  }

  for (const migration of MIGRATIONS) {
    if (migration.version <= start) continue

    // Each migration runs in its own transaction so a partial registry
    // application is still durable: if v3 throws, v2's changes stay.
    const tx = db.transaction(() => {
      migration.up(db)
      // Bump the version inside the same transaction. A throw above this
      // line rolls back the DDL; a throw here is theoretically impossible
      // (PRAGMA writes don't fail in practice) but the transaction still
      // covers it.
      writeUserVersion(db, migration.version)
    })

    try {
      tx()
      applied.push(migration.version)
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      throw new Error(
        `db-migrations v${migration.version} (${migration.description}) failed: ${msg}`,
        { cause: err }
      )
    }
  }

  return { startVersion: start, endVersion: readUserVersion(db), applied }
}

function readUserVersion(db: Database): number {
  // better-sqlite3's `pragma` returns either a primitive (when `simple: true`)
  // or an array of rows. We use `simple: true` to get the integer directly.
  const v = db.pragma('user_version', { simple: true })
  if (typeof v !== 'number') {
    throw new Error(
      `db-migrations: PRAGMA user_version returned a non-number: ${JSON.stringify(v)}`
    )
  }
  return v
}

function writeUserVersion(db: Database, value: number): void {
  // PRAGMA writes don't support parameter binding; we inline the integer
  // after asserting it's a safe value.
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`db-migrations: refusing to write invalid user_version ${value}`)
  }
  db.pragma(`user_version = ${value}`)
}

function safeAddColumn(db: Database, table: string, ddl: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`)
  } catch (err: any) {
    const msg = String(err?.message ?? err)
    if (!/duplicate column name/i.test(msg)) throw err
  }
}
