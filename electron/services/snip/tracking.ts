// SQLite-backed tracking for the K11 dashboard + K12 Discover panel.
// All functions are best-effort: a DB error (locked, disk full,
// schema drift) logs to stderr and returns — never throws. Invariant 5.
//
// Two tables:
//   • snip_events       — one row per SUCCESSFUL filter match
//   • snip_command_log  — one row per FOREGROUND shell command
//
// Discover (K12) joins the two: commands in snip_command_log whose
// matched_filter is NULL, ranked by total tokens descending, are the
// suggestions.

import type Database from 'better-sqlite3'
import { getDb } from '../database'
import type { SnipEvent, SnipRecentRow, SnipStats } from './types'

/**
 * Tests inject a `:memory:` DB via this hook to avoid pulling Electron
 * into the test process. Production calls leave it null → tracking
 * falls back to the lazy `getDb()` singleton.
 */
let dbOverride: Database.Database | null = null
export function __setDbForTests(db: Database.Database | null): void {
  dbOverride = db
}

function handle(): Database.Database {
  return dbOverride ?? (getDb() as Database.Database)
}

const SPARKLINE_DAYS = 14
const ONE_DAY_MS = 86_400_000

interface CommandLogRow {
  ts: number
  command: string
  commandHead: string
  tokens: number
  matchedFilter: string | null
  conversationId?: string
}

function safe<T>(fn: () => T, fallback: T, label: string): T {
  try {
    return fn()
  } catch (err) {
    console.error(`[snip-tracking] ${label} failed:`, err)
    return fallback
  }
}

export function recordEvent(evt: SnipEvent): void {
  safe(
    () => {
      const db = handle()
      db.prepare(
        `INSERT INTO snip_events
           (ts, command, filter_name, bytes_before, bytes_after,
            tokens_before, tokens_after, duration_ms, conversation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        evt.ts,
        evt.command,
        evt.filter,
        evt.bytesBefore,
        evt.bytesAfter,
        evt.tokensBefore,
        evt.tokensAfter,
        evt.durationMs,
        evt.conversationId ?? null
      )
    },
    undefined,
    'recordEvent'
  )
}

export function recordCommandLog(row: CommandLogRow): void {
  safe(
    () => {
      const db = handle()
      db.prepare(
        `INSERT INTO snip_command_log
           (ts, command, command_head, tokens, matched_filter, conversation_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        row.ts,
        row.command,
        row.commandHead,
        row.tokens,
        row.matchedFilter,
        row.conversationId ?? null
      )
    },
    undefined,
    'recordCommandLog'
  )
}

interface StatsTotalsRow {
  total_events: number | null
  total_before_bytes: number | null
  total_after_bytes: number | null
  total_before_tokens: number | null
  total_after_tokens: number | null
}

interface TopFilterRow {
  filter_name: string
  runs: number
  tokens_saved: number
  tokens_before: number
}

interface SparkRow {
  bucket: number
  saved: number
}

/**
 * Build the SnipStats payload. `enabled` is determined by the caller
 * (it's a settings flag, not a DB column).
 */
export function getStats(enabled: boolean, nowMs: number): SnipStats {
  return safe(
    () => {
      const db = handle()

      const totals =
        (db
          .prepare(
            `SELECT
               COUNT(*)         AS total_events,
               COALESCE(SUM(bytes_before), 0)  AS total_before_bytes,
               COALESCE(SUM(bytes_after), 0)   AS total_after_bytes,
               COALESCE(SUM(tokens_before), 0) AS total_before_tokens,
               COALESCE(SUM(tokens_after), 0)  AS total_after_tokens
             FROM snip_events`
          )
          .get() as StatsTotalsRow | undefined) ?? {
          total_events: 0,
          total_before_bytes: 0,
          total_after_bytes: 0,
          total_before_tokens: 0,
          total_after_tokens: 0
        }

      const totalEvents = totals.total_events ?? 0
      const totalBytesBefore = totals.total_before_bytes ?? 0
      const totalBytesAfter = totals.total_after_bytes ?? 0
      const totalTokensBefore = totals.total_before_tokens ?? 0
      const totalTokensAfter = totals.total_after_tokens ?? 0

      const avgSavings =
        totalTokensBefore > 0
          ? Math.max(0, (totalTokensBefore - totalTokensAfter) / totalTokensBefore)
          : 0

      const topRows = db
        .prepare(
          `SELECT
             filter_name,
             COUNT(*) AS runs,
             SUM(tokens_before - tokens_after) AS tokens_saved,
             SUM(tokens_before) AS tokens_before
           FROM snip_events
           GROUP BY filter_name
           ORDER BY tokens_saved DESC
           LIMIT 5`
        )
        .all() as TopFilterRow[]

      const topByTokens = topRows.map((r) => ({
        filter: r.filter_name,
        runs: r.runs,
        tokensSaved: Math.max(0, r.tokens_saved),
        savingsRatio: r.tokens_before > 0 ? Math.max(0, r.tokens_saved / r.tokens_before) : 0
      }))

      // 14-day sparkline. Bucket by floor(ts / day) - floor(now/day) + 13
      // so index 0 is 13 days ago and index 13 is today.
      const todayBucket = Math.floor(nowMs / ONE_DAY_MS)
      const sinceMs = (todayBucket - (SPARKLINE_DAYS - 1)) * ONE_DAY_MS

      const sparkRows = db
        .prepare(
          `SELECT
             CAST(ts / ${ONE_DAY_MS} AS INTEGER) AS bucket,
             SUM(tokens_before - tokens_after)   AS saved
           FROM snip_events
           WHERE ts >= ?
           GROUP BY bucket
           ORDER BY bucket ASC`
        )
        .all(sinceMs) as SparkRow[]

      const sparkline = new Array<number>(SPARKLINE_DAYS).fill(0)
      for (const r of sparkRows) {
        const idx = r.bucket - (todayBucket - (SPARKLINE_DAYS - 1))
        if (idx >= 0 && idx < SPARKLINE_DAYS) {
          sparkline[idx] = Math.max(0, r.saved)
        }
      }

      return {
        enabled,
        totalEvents,
        totalBytesBefore,
        totalBytesAfter,
        totalTokensBefore,
        totalTokensAfter,
        avgSavings,
        topByTokens,
        sparkline
      }
    },
    {
      enabled,
      totalEvents: 0,
      totalBytesBefore: 0,
      totalBytesAfter: 0,
      totalTokensBefore: 0,
      totalTokensAfter: 0,
      avgSavings: 0,
      topByTokens: [],
      sparkline: new Array<number>(SPARKLINE_DAYS).fill(0)
    },
    'getStats'
  )
}

interface RecentDbRow {
  ts: number
  filter_name: string
  command: string
  tokens_before: number
  tokens_after: number
  duration_ms: number
}

export function getRecent(limit: number): SnipRecentRow[] {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)))
  return safe(
    () => {
      const db = handle()
      const rows = db
        .prepare(
          `SELECT ts, filter_name, command, tokens_before, tokens_after, duration_ms
           FROM snip_events
           ORDER BY ts DESC
           LIMIT ?`
        )
        .all(safeLimit) as RecentDbRow[]
      return rows.map((r) => ({
        ts: r.ts,
        filter: r.filter_name,
        command: r.command,
        tokensBefore: r.tokens_before,
        tokensAfter: r.tokens_after,
        durationMs: r.duration_ms
      }))
    },
    [],
    'getRecent'
  )
}

interface UnfilteredRow {
  command_head: string
  runs: number
  total_tokens: number
  sample_command: string
}

/**
 * Top-K unfiltered commands by total token cost over the last
 * `sinceMs` window. Powers the K12 Discover panel.
 */
export function getUnfilteredCommands(
  sinceMs: number,
  limit: number
): Array<{
  commandPattern: string
  runs: number
  estimatedTokens: number
  sampleCommand: string
}> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)))
  return safe(
    () => {
      const db = handle()
      const rows = db
        .prepare(
          `SELECT
             command_head,
             COUNT(*) AS runs,
             SUM(tokens) AS total_tokens,
             (SELECT command FROM snip_command_log AS s2
                WHERE s2.command_head = s.command_head AND s2.matched_filter IS NULL
                ORDER BY s2.tokens DESC LIMIT 1) AS sample_command
           FROM snip_command_log AS s
           WHERE matched_filter IS NULL
             AND ts >= ?
           GROUP BY command_head
           ORDER BY total_tokens DESC
           LIMIT ?`
        )
        .all(sinceMs, safeLimit) as UnfilteredRow[]
      return rows.map((r) => ({
        commandPattern: r.command_head,
        runs: r.runs,
        estimatedTokens: r.total_tokens,
        sampleCommand: r.sample_command
      }))
    },
    [],
    'getUnfilteredCommands'
  )
}

/**
 * Wipe both tables. Used by the dashboard's "Reset history" action.
 */
export function clearAll(): void {
  safe(
    () => {
      const db = handle()
      db.exec(`DELETE FROM snip_events; DELETE FROM snip_command_log;`)
    },
    undefined,
    'clearAll'
  )
}
