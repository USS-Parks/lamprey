import type Database from 'better-sqlite3'

// sqlite-vec loader. Wraps the `load()` export from the npm package in a
// try/catch so the app boots even if the native binary is unavailable on
// this target (a particularly old glibc, a corp-locked /tmp, an arch we
// don't ship a binary for). The RAG IPC handlers consult `isVecAvailable()`
// and return a clear error to the renderer when retrieval is requested
// without the extension loaded — the user sees a banner explaining what's
// missing rather than a silent failure.

let vecAvailable = false
let vecLoadError: string | null = null

/**
 * Try to load the sqlite-vec extension into the given database handle.
 * Records the outcome in module state so subsequent calls to
 * `isVecAvailable()` / `vecLoadError()` can report back without re-running
 * the load attempt. Safe to call on a DB where the extension is already
 * loaded — the underlying call is idempotent.
 */
export function loadSqliteVec(db: Database.Database): void {
  try {
    // Late-require so a missing module (broken install) doesn't prevent the
    // module from being imported elsewhere — the database initializer is the
    // only consumer and it handles the failure path explicitly.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqliteVec = require('sqlite-vec') as {
      load: (db: Database.Database) => void
    }
    sqliteVec.load(db)
    // Sanity probe — confirms the extension is actually present, not just
    // that load() didn't throw on a broken stub.
    const row = db.prepare('SELECT vec_version() AS v').get() as
      | { v: string }
      | undefined
    if (!row || typeof row.v !== 'string') {
      throw new Error('vec_version() returned no result')
    }
    vecAvailable = true
    vecLoadError = null
    console.log(`[db] sqlite-vec loaded (vec_version=${row.v})`)
  } catch (err) {
    vecAvailable = false
    vecLoadError = err instanceof Error ? err.message : String(err)
    console.warn(`[db] sqlite-vec UNAVAILABLE: ${vecLoadError}`)
  }
}

export function isVecAvailable(): boolean {
  return vecAvailable
}

export function getVecLoadError(): string | null {
  return vecLoadError
}

/** Test-only: reset the module flags so tests can exercise both branches. */
export function __resetVecLoaderState(): void {
  vecAvailable = false
  vecLoadError = null
}
