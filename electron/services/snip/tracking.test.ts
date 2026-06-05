import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import type Database from 'better-sqlite3'

// The tracking module imports `../database` which imports `electron`.
// Mock both so the test process never touches the real Electron app.
vi.mock('electron', () => ({
  app: { getPath: () => '.tmp-snip-tracking-test' }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))
vi.mock('../database', () => ({
  getDb: () => {
    throw new Error('test must inject a DB via __setDbForTests before tracking.* runs')
  }
}))

import {
  __setDbForTests,
  recordEvent,
  recordCommandLog,
  getStats,
  getRecent,
  getUnfilteredCommands,
  clearAll
} from './tracking'

const SCHEMA = `
  CREATE TABLE snip_events (
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
  CREATE INDEX idx_snip_events_ts ON snip_events(ts DESC);
  CREATE INDEX idx_snip_events_filter ON snip_events(filter_name, ts DESC);

  CREATE TABLE snip_command_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    command TEXT NOT NULL,
    command_head TEXT NOT NULL,
    tokens INTEGER NOT NULL,
    matched_filter TEXT,
    conversation_id TEXT
  );
  CREATE INDEX idx_snip_command_log_ts ON snip_command_log(ts DESC);
  CREATE INDEX idx_snip_command_log_head ON snip_command_log(command_head, ts DESC);
`

let db: Database.Database

beforeEach(() => {
  db = new BetterSqlite3(':memory:')
  db.exec(SCHEMA)
  __setDbForTests(db)
})

afterEach(() => {
  __setDbForTests(null)
  db.close()
})

const NOW = 1_780_000_000_000 // arbitrary fixed ts in mid-2026
const ONE_DAY = 86_400_000

describe('snip tracking — recordEvent + getStats', () => {
  it('returns the empty-shape SnipStats on a fresh DB', () => {
    const s = getStats(true, NOW)
    expect(s.totalEvents).toBe(0)
    expect(s.totalTokensBefore).toBe(0)
    expect(s.totalTokensAfter).toBe(0)
    expect(s.avgSavings).toBe(0)
    expect(s.topByTokens).toEqual([])
    expect(s.sparkline).toHaveLength(14)
    expect(s.sparkline.every((v) => v === 0)).toBe(true)
    expect(s.enabled).toBe(true)
  })

  it('aggregates totals across 100 synthetic events', () => {
    for (let i = 0; i < 100; i++) {
      recordEvent({
        filter: i % 3 === 0 ? 'git-log' : i % 3 === 1 ? 'vitest' : 'tsc',
        command: `cmd ${i}`,
        bytesBefore: 1000,
        bytesAfter: 100,
        tokensBefore: 250,
        tokensAfter: 25,
        durationMs: 5,
        ts: NOW - i * 60_000
      })
    }
    const s = getStats(true, NOW)
    expect(s.totalEvents).toBe(100)
    expect(s.totalTokensBefore).toBe(25000)
    expect(s.totalTokensAfter).toBe(2500)
    expect(s.avgSavings).toBeCloseTo(0.9, 5)
    expect(s.topByTokens).toHaveLength(3)
    // Verify top entries sum to total saved.
    const summed = s.topByTokens.reduce((acc, r) => acc + r.tokensSaved, 0)
    expect(summed).toBe(s.totalTokensBefore - s.totalTokensAfter)
  })

  it('orders topByTokens by tokens saved descending', () => {
    recordEvent(mkEvt({ filter: 'a', tokensBefore: 100, tokensAfter: 10, ts: NOW }))
    recordEvent(mkEvt({ filter: 'b', tokensBefore: 200, tokensAfter: 50, ts: NOW }))
    recordEvent(mkEvt({ filter: 'c', tokensBefore: 50, tokensAfter: 5, ts: NOW }))
    const s = getStats(true, NOW)
    // saved: a=90, b=150, c=45 — order: b, a, c
    expect(s.topByTokens.map((r) => r.filter)).toEqual(['b', 'a', 'c'])
  })
})

describe('snip tracking — sparkline', () => {
  it('returns exactly 14 entries with newest at index 13', () => {
    recordEvent(mkEvt({ ts: NOW, tokensBefore: 1000, tokensAfter: 100 }))
    const s = getStats(true, NOW)
    expect(s.sparkline).toHaveLength(14)
    expect(s.sparkline[13]).toBe(900) // today's bucket
    for (let i = 0; i < 13; i++) expect(s.sparkline[i]).toBe(0)
  })

  it('zero-fills quiet days', () => {
    // Put a sample 7 days ago and another today.
    recordEvent(mkEvt({ ts: NOW - 7 * ONE_DAY, tokensBefore: 200, tokensAfter: 50 }))
    recordEvent(mkEvt({ ts: NOW, tokensBefore: 500, tokensAfter: 100 }))
    const s = getStats(true, NOW)
    expect(s.sparkline[13]).toBe(400)
    expect(s.sparkline[6]).toBe(150)
    // Everything between should be zero.
    expect(s.sparkline.filter((v) => v === 0).length).toBe(12)
  })

  it('drops events older than 14 days', () => {
    recordEvent(mkEvt({ ts: NOW - 30 * ONE_DAY, tokensBefore: 1000, tokensAfter: 0 }))
    const s = getStats(true, NOW)
    expect(s.sparkline.every((v) => v === 0)).toBe(true)
  })
})

describe('snip tracking — getRecent', () => {
  it('returns newest-first, capped by limit', () => {
    for (let i = 0; i < 30; i++) {
      recordEvent(mkEvt({ ts: NOW - i, command: `cmd${i}`, filter: 'tsc' }))
    }
    const rows = getRecent(10)
    expect(rows).toHaveLength(10)
    expect(rows[0].command).toBe('cmd0')
    expect(rows[9].command).toBe('cmd9')
  })

  it('caps limit to a sane upper bound', () => {
    for (let i = 0; i < 5; i++) {
      recordEvent(mkEvt({ ts: NOW - i, filter: 'x' }))
    }
    expect(getRecent(10_000)).toHaveLength(5)
  })
})

describe('snip tracking — getUnfilteredCommands', () => {
  it('returns top-K unmatched commands by total tokens, ignoring matched ones', () => {
    // 3 runs of `foo` (unmatched, 100 tokens each = 300 total)
    for (let i = 0; i < 3; i++) {
      recordCommandLog({
        ts: NOW - i,
        command: `foo --arg${i}`,
        commandHead: 'foo',
        tokens: 100,
        matchedFilter: null
      })
    }
    // 5 runs of `bar` (unmatched, 50 each = 250)
    for (let i = 0; i < 5; i++) {
      recordCommandLog({
        ts: NOW - i,
        command: `bar`,
        commandHead: 'bar',
        tokens: 50,
        matchedFilter: null
      })
    }
    // 10 runs of `git` (matched, should be excluded)
    for (let i = 0; i < 10; i++) {
      recordCommandLog({
        ts: NOW - i,
        command: 'git status',
        commandHead: 'git',
        tokens: 80,
        matchedFilter: 'git-status'
      })
    }
    const out = getUnfilteredCommands(NOW - ONE_DAY, 10)
    expect(out).toHaveLength(2)
    expect(out[0].commandPattern).toBe('foo')
    expect(out[0].estimatedTokens).toBe(300)
    expect(out[1].commandPattern).toBe('bar')
    expect(out[1].estimatedTokens).toBe(250)
  })

  it('respects the since window', () => {
    recordCommandLog({
      ts: NOW - 30 * ONE_DAY,
      command: 'old',
      commandHead: 'old',
      tokens: 999,
      matchedFilter: null
    })
    expect(getUnfilteredCommands(NOW - ONE_DAY, 10)).toHaveLength(0)
  })
})

describe('snip tracking — clearAll', () => {
  it('wipes both tables', () => {
    recordEvent(mkEvt({ ts: NOW, filter: 'x' }))
    recordCommandLog({
      ts: NOW,
      command: 'y',
      commandHead: 'y',
      tokens: 5,
      matchedFilter: null
    })
    clearAll()
    expect(getStats(true, NOW).totalEvents).toBe(0)
    expect(getUnfilteredCommands(0, 10)).toHaveLength(0)
  })
})

describe('snip tracking — best-effort failure handling', () => {
  it('recordEvent does not throw when the DB is closed', () => {
    db.close()
    // Re-route the override to null so handle() falls back through to
    // the mocked getDb that throws. Tracking's safe() wrapper catches
    // and returns silently.
    __setDbForTests(null)
    expect(() => recordEvent(mkEvt({}))).not.toThrow()
  })

  it('getStats returns an empty payload on DB failure', () => {
    db.close()
    __setDbForTests(null)
    const s = getStats(true, NOW)
    expect(s.totalEvents).toBe(0)
    expect(s.sparkline).toHaveLength(14)
  })
})

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

interface EvtOverride {
  filter?: string
  command?: string
  bytesBefore?: number
  bytesAfter?: number
  tokensBefore?: number
  tokensAfter?: number
  durationMs?: number
  ts?: number
  conversationId?: string
}

function mkEvt(o: EvtOverride): import('./types').SnipEvent {
  return {
    filter: o.filter ?? 'test-filter',
    command: o.command ?? 'test cmd',
    bytesBefore: o.bytesBefore ?? 100,
    bytesAfter: o.bytesAfter ?? 10,
    tokensBefore: o.tokensBefore ?? 25,
    tokensAfter: o.tokensAfter ?? 3,
    durationMs: o.durationMs ?? 1,
    ts: o.ts ?? NOW,
    conversationId: o.conversationId
  }
}
