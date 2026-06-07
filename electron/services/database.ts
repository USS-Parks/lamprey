import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { loadSqliteVec } from './rag/vec-loader'
import { runMigrations } from './db-migrations'
import { initLegacySchema } from './schema-init'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = join(app.getPath('userData'), 'lamprey.db')
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    // PS3 — back off on SQLITE_BUSY for up to 5 seconds before giving up.
    // The single-instance lock (HX1) covers most GUI-vs-GUI contention,
    // but headless CLI invocations are exempted from the lock and a
    // future feature might legitimately open the same DB from a side
    // process. busy_timeout is the standard pragma for that case; the
    // withWriteRetry() helper below adds a second guard so the rare
    // post-timeout SQLITE_BUSY still completes instead of dropping the
    // caller's write.
    db.pragma('busy_timeout = 5000')
    // Load sqlite-vec BEFORE migrations: the RAG vec0 virtual table can only
    // be created after the extension is registered. When the extension fails
    // to load (missing native binary on this target), `initSchema` skips the
    // vec0 table and the rest of the schema continues. RAG IPC handlers
    // surface the disabled state through `isVecAvailable()`.
    loadSqliteVec(db)
    // PS6 — partitioned legacy schema initializer. The pre-PS6 inline
    // 700-line initSchema is now `initLegacySchema` in `schema-init.ts`,
    // dispatched into named per-domain segments. Order is preserved by
    // construction; future schema work lands as a PS1 Migration entry in
    // `db-migrations.ts`, not as a new segment here.
    initLegacySchema(db)
    // PS1 — versioned migration ledger gated by PRAGMA user_version. Runs
    // after the legacy schema bootstrap so the baseline tables exist for
    // the v1 stamp.
    // Future schema work (PS6/PS7/PS9/PS11) appends Migration entries to
    // the registry in `db-migrations.ts` instead of editing `initSchema`.
    runMigrations(db)
    // PS4 — startup integrity check. Result is cached in module state +
    // surfaced via runIntegrityCheck()'s last-result accessor; the IPC
    // handler in electron/ipc/persistence.ts reads it so the renderer
    // banner can show the latest verdict without re-running the (linear-
    // time) scan on every render. A non-'ok' result here triggers the
    // IntegrityBanner in the renderer.
    try {
      runIntegrityCheck(db)
    } catch (err) {
      console.warn('[db] startup integrity_check failed:', err)
    }
  }
  return db
}

// PS2 — WAL checkpoint result. Exported so the Persistence Settings
// panel (PS10) can surface "last checkpoint" stats.
export interface CheckpointResult {
  /** True if better-sqlite3 reported the operation completed without busy. */
  ok: boolean
  /** Pages in the WAL before the checkpoint started. */
  pagesInWal: number
  /** Pages checkpointed (moved from WAL to main DB). */
  pagesCheckpointed: number
  /** Wall-clock duration. */
  durationMs: number
}

/**
 * PS2 — Force a WAL checkpoint in TRUNCATE mode. Used on graceful
 * shutdown and on the periodic timer.
 *
 * better-sqlite3's `pragma('wal_checkpoint(TRUNCATE)')` returns a row
 * `{ busy, log, checkpointed }` where:
 *   - busy:         0 = ok, non-zero = some other connection was holding
 *                   the wal lock and not all pages could be moved
 *   - log:          pages in the WAL at the time of the call
 *   - checkpointed: pages actually moved (only valid when busy === 0)
 *
 * TRUNCATE mode is the right choice for shutdown + periodic hygiene: it
 * not only moves WAL pages into the main DB but truncates the WAL file
 * to zero length afterwards. PASSIVE / FULL leave a large WAL file on
 * disk even after checkpointing.
 */
export function checkpoint(database?: Database.Database): CheckpointResult {
  const target = database ?? db
  if (!target) {
    return { ok: false, pagesInWal: 0, pagesCheckpointed: 0, durationMs: 0 }
  }
  const startedAt = performance.now()
  // better-sqlite3 returns the pragma row as an array; we read the first.
  const rows = target.pragma('wal_checkpoint(TRUNCATE)') as Array<{
    busy: number
    log: number
    checkpointed: number
  }>
  const durationMs = Math.round(performance.now() - startedAt)
  const row = rows?.[0] ?? { busy: 1, log: 0, checkpointed: 0 }
  return {
    ok: row.busy === 0,
    pagesInWal: row.log,
    pagesCheckpointed: row.checkpointed,
    durationMs
  }
}

// PS2 — periodic checkpoint state. Module-scoped so multiple callers
// can't accidentally double-schedule.
let checkpointTimer: NodeJS.Timeout | null = null
let lastCheckpointResult: CheckpointResult | null = null
const DEFAULT_CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * PS2 — start a recurring WAL checkpoint. Idempotent: a second call
 * with the same DB is a no-op. Returns a stop function that cancels the
 * timer.
 *
 * The interval default (5 min) is conservative — frequent enough to keep
 * the WAL bounded during long sessions, rare enough not to compete with
 * streaming writes. Configurable via the Persistence Settings panel
 * (PS10) once that ships.
 */
export function startPeriodicCheckpoint(
  intervalMs: number = DEFAULT_CHECKPOINT_INTERVAL_MS
): () => void {
  if (checkpointTimer) {
    // Already running; return a stop fn that cancels the live timer.
    const live = checkpointTimer
    return () => {
      if (checkpointTimer === live) {
        clearInterval(live)
        checkpointTimer = null
      }
    }
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error(`startPeriodicCheckpoint: invalid intervalMs ${intervalMs}`)
  }
  checkpointTimer = setInterval(() => {
    try {
      lastCheckpointResult = checkpoint()
    } catch (err) {
      // A failing checkpoint must not crash the timer; we log via console
      // here because the event-log spine isn't always ready in shutdown
      // edges. PS22 wires the formal event emission.
      console.warn('[db] periodic checkpoint failed:', err)
    }
  }, intervalMs)
  // Allow the process to exit while the timer is pending — important for
  // headless CLI runs that should not be held alive by this interval.
  checkpointTimer.unref?.()
  return () => {
    if (checkpointTimer) {
      clearInterval(checkpointTimer)
      checkpointTimer = null
    }
  }
}

/** PS10 surface — exposes the most recent periodic-checkpoint outcome. */
export function getLastCheckpointResult(): CheckpointResult | null {
  return lastCheckpointResult
}

/**
 * PS3 — retry a write that may transiently see SQLITE_BUSY despite the
 * 5-second busy_timeout pragma. better-sqlite3 raises the error
 * synchronously; we catch only that one code, sleep with exponential
 * backoff, and re-invoke. Anything else propagates.
 *
 * The retry contract is conservative: 3 retries max, with backoff
 * 50ms → 200ms → 800ms (total <= 1.05s on top of the underlying 5s
 * busy_timeout the connection already enforces). The intended use is
 * the highest-contention writers (saveMessage, recordToolCall) where
 * a dropped write would silently corrupt a chat or audit row.
 *
 * Every retry path logs via console.warn so the wild-occurrence rate
 * is visible during dev/QA. PS22 wires the event-spine emission.
 */
export interface WriteRetryOpts {
  /** Max retry attempts before giving up. Default 3. */
  maxRetries?: number
  /** Base backoff in ms; doubles each retry. Default 50. */
  baseDelayMs?: number
  /** Label for the warn line + (future) event payload. */
  label?: string
}

export function withWriteRetry<T>(fn: () => T, opts: WriteRetryOpts = {}): T {
  const maxRetries = opts.maxRetries ?? 3
  const baseDelayMs = opts.baseDelayMs ?? 50
  const label = opts.label ?? 'db-write'
  let attempt = 0
  // The synchronous-sleep approach matches better-sqlite3's sync API.
  // node 18+ has Atomics.wait but we use a busy-wait via a SharedArrayBuffer
  // to stay portable without a worker. The total sleep is bounded.
  const sleep = (ms: number): void => {
    const sab = new SharedArrayBuffer(4)
    const ia = new Int32Array(sab)
    Atomics.wait(ia, 0, 0, ms)
  }
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return fn()
    } catch (err: any) {
      const msg = String(err?.message ?? err)
      const code = err?.code as string | undefined
      const isBusy = code === 'SQLITE_BUSY' || /SQLITE_BUSY/i.test(msg)
      if (!isBusy || attempt >= maxRetries) {
        if (isBusy) {
          console.warn(
            `[db] ${label}: SQLITE_BUSY after ${attempt} retries — giving up`
          )
        }
        throw err
      }
      const delay = baseDelayMs * Math.pow(2, attempt)
      console.warn(
        `[db] ${label}: SQLITE_BUSY on attempt ${attempt + 1}; backing off ${delay}ms`
      )
      sleep(delay)
      attempt++
    }
  }
}

// PS4 — startup integrity check.
//
// `PRAGMA integrity_check` runs a full scan of the database (indexes,
// row data, FK references) and returns either the string 'ok' or a
// list of error rows describing the corruption. Cost on a healthy DB is
// linear in size (a few hundred ms for tens of MB); cost on a corrupt
// DB can be much higher. We run it at startup right after migrations
// land, cache the result in module state, and expose it via
// runIntegrityCheck() so PS10's Settings panel can re-run it on demand.
export interface IntegrityCheckResult {
  /** True iff PRAGMA integrity_check returned exactly 'ok'. */
  ok: boolean
  /** Raw rows from the pragma (joined by newline for display). */
  result: string
  /** When this check ran. */
  ranAt: number
  /** Wall-clock duration. */
  durationMs: number
}

let lastIntegrityResult: IntegrityCheckResult | null = null

export function runIntegrityCheck(
  database?: Database.Database
): IntegrityCheckResult {
  const target = database ?? db
  if (!target) {
    return {
      ok: false,
      result: 'no database handle available',
      ranAt: Date.now(),
      durationMs: 0
    }
  }
  const startedAt = performance.now()
  let result: IntegrityCheckResult
  try {
    const rows = target.pragma('integrity_check') as Array<{
      integrity_check: string
    }>
    const lines = rows
      .map((r) => r?.integrity_check ?? '')
      .filter((s) => s.length > 0)
    const ok = lines.length === 1 && lines[0] === 'ok'
    result = {
      ok,
      result: lines.join('\n'),
      ranAt: Date.now(),
      durationMs: Math.round(performance.now() - startedAt)
    }
  } catch (err: any) {
    result = {
      ok: false,
      result: `integrity_check threw: ${err?.message ?? String(err)}`,
      ranAt: Date.now(),
      durationMs: Math.round(performance.now() - startedAt)
    }
  }
  lastIntegrityResult = result
  return result
}

export function getLastIntegrityResult(): IntegrityCheckResult | null {
  return lastIntegrityResult
}

/**
 * PS8 — run `fn` inside a single SQLite transaction on the cached DB
 * connection. better-sqlite3 transactions are synchronous; nothing
 * inside `fn` may await. A throw rolls back the transaction;
 * the throw propagates to the caller.
 *
 * Use for the small group-of-writes case where dropping the second
 * write while keeping the first would leave a half-row state — e.g.
 * the planner+coder metric pair on a shared message id, or a future
 * "save message + write stage metric" handshake. The cross-stage
 * relationship in the multi-agent pipeline is NOT transactional
 * (awaits between stages); this helper covers the within-stage
 * row+metric pair.
 *
 * Returns whatever `fn` returns.
 */
export function transactional<T>(fn: () => T): T {
  const target = db
  if (!target) {
    // No cached DB means we're in a test that hasn't opened one, or
    // the pre-init startup window. In either case, falling back to
    // executing fn directly preserves the caller's contract without
    // requiring them to predict which case they're in.
    return fn()
  }
  let result!: T
  const tx = target.transaction(() => {
    result = fn()
  })
  tx()
  return result
}

export function closeDb(): void {
  if (db) {
    // PS2 — TRUNCATE the WAL before closing so the next launch starts
    // with a small WAL footprint. On an ungraceful exit we lose this,
    // and the WAL recovery on next open handles that case correctly —
    // the periodic checkpoint exists precisely to bound the worst case.
    try {
      checkpoint(db)
    } catch (err) {
      console.warn('[db] checkpoint on close failed:', err)
    }
    // Stop the periodic timer if it was running — closing the DB while
    // the interval is live would have the next tick fail.
    if (checkpointTimer) {
      clearInterval(checkpointTimer)
      checkpointTimer = null
    }
    db.close()
    db = null
  }
}

// Test-only escape hatch: drop the cached connection so the next
// `getDb()` re-opens against the current `app.getPath()` (which the
// test will have re-mocked to a fresh tmpdir). Not exposed via IPC.
export function __resetDbForTests(): void {
  closeDb()
}
