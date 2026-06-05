import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import type Database from 'better-sqlite3'

vi.mock('electron', () => ({
  app: { getPath: () => '.tmp-snip-apply-test' },
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))
vi.mock('../database', () => ({
  getDb: () => {
    throw new Error('test injects DB via __setDbForTests')
  }
}))

// Replace listActiveFilters with a controlled set per test.
const filtersBox: { filters: import('./types').Filter[] } = { filters: [] }
vi.mock('./filter-loader', () => ({
  listActiveFilters: () => filtersBox.filters
}))

import { __setDbForTests } from './tracking'
import { applySnip } from './apply'
import type { Filter } from './types'

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
  CREATE TABLE snip_command_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    command TEXT NOT NULL,
    command_head TEXT NOT NULL,
    tokens INTEGER NOT NULL,
    matched_filter TEXT,
    conversation_id TEXT
  );
`

let db: Database.Database

const mkResult = (overrides: Partial<import('../shell-tool').ShellResult>): import('../shell-tool').ShellResult => ({
  command: 'test',
  cwd: '/tmp',
  exitCode: 0,
  signal: null,
  stdout: '',
  stderr: '',
  stdoutTruncated: false,
  stderrTruncated: false,
  durationMs: 0,
  timedOut: false,
  ...overrides
})

const gitStatusFilter: Filter = {
  name: 'git-status',
  description: 'compress git status',
  match: { command: 'git', subcommand: 'status' },
  pipeline: [{ action: 'head', n: 1 }]
}

beforeEach(() => {
  db = new BetterSqlite3(':memory:')
  db.exec(SCHEMA)
  __setDbForTests(db)
  filtersBox.filters = []
})

afterEach(() => {
  __setDbForTests(null)
  db.close()
})

describe('snip applySnip', () => {
  it('master switch off → pass-through with no DB writes', () => {
    filtersBox.filters = [gitStatusFilter]
    const r = mkResult({ stdout: 'verbose\noutput\nhere' })
    const o = applySnip('git status', r, {
      snipEnabled: false,
      bypassThisCall: false,
      nowMs: 1
    })
    expect(o.result.stdout).toBe('verbose\noutput\nhere')
    expect(o.event).toBe(null)
    expect(o.bypassed).toBe(false)
    expect(o.matchedFilter).toBe(null)
    // Zero rows in either table.
    expect(db.prepare('SELECT COUNT(*) AS c FROM snip_events').get() as { c: number }).toEqual({
      c: 0
    })
    expect(
      db.prepare('SELECT COUNT(*) AS c FROM snip_command_log').get() as { c: number }
    ).toEqual({ c: 0 })
  })

  it('per-call bypass → pass-through but logs to snip_command_log', () => {
    filtersBox.filters = [gitStatusFilter]
    const r = mkResult({ stdout: 'long stuff' })
    const o = applySnip('git status', r, {
      snipEnabled: true,
      bypassThisCall: true,
      nowMs: 100
    })
    expect(o.bypassed).toBe(true)
    expect(o.result.stdout).toBe('long stuff')
    expect(o.event).toBe(null)
    const log = db
      .prepare('SELECT command_head, matched_filter FROM snip_command_log')
      .all() as Array<{ command_head: string; matched_filter: string | null }>
    expect(log).toEqual([{ command_head: 'git', matched_filter: null }])
  })

  it('no matching filter → pass-through + command_log with null filter', () => {
    filtersBox.filters = []
    const r = mkResult({ stdout: 'something' })
    const o = applySnip('mystery cmd', r, {
      snipEnabled: true,
      bypassThisCall: false,
      nowMs: 50
    })
    expect(o.matchedFilter).toBe(null)
    expect(o.result.stdout).toBe('something')
    const log = db
      .prepare('SELECT command_head, matched_filter FROM snip_command_log')
      .all() as Array<{ command_head: string; matched_filter: string | null }>
    expect(log).toEqual([{ command_head: 'mystery', matched_filter: null }])
  })

  it('failure exit code → pass-through (failure detail is the signal)', () => {
    filtersBox.filters = [gitStatusFilter]
    const r = mkResult({ stdout: 'fatal: not a git repository', exitCode: 128 })
    const o = applySnip('git status', r, {
      snipEnabled: true,
      bypassThisCall: false,
      nowMs: 10
    })
    expect(o.event).toBe(null)
    expect(o.matchedFilter).toBe(null) // not recorded as matched because exit code gate failed
    expect(o.result.stdout).toContain('fatal:')
  })

  it('successful match → transforms stdout, records event, preserves exit code', () => {
    filtersBox.filters = [gitStatusFilter]
    const verbose = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n')
    const r = mkResult({ stdout: verbose })
    const o = applySnip('git status', r, {
      snipEnabled: true,
      bypassThisCall: false,
      conversationId: 'conv-1',
      nowMs: 999
    })
    expect(o.matchedFilter).toBe('git-status')
    expect(o.result.stdout).toBe('line 0')
    expect(o.result.exitCode).toBe(0) // preserved
    expect(o.event).not.toBe(null)
    expect(o.event?.tokensBefore).toBeGreaterThan(o.event!.tokensAfter)
    const rows = db.prepare('SELECT filter_name, conversation_id FROM snip_events').all() as Array<{
      filter_name: string
      conversation_id: string | null
    }>
    expect(rows).toEqual([{ filter_name: 'git-status', conversation_id: 'conv-1' }])
  })

  it('filter that would grow output → fall back to raw, no event row', () => {
    // Construct a filter that, fed empty input, grows it via on_empty.
    const growsFilter: Filter = {
      name: 'grows',
      description: 'grows on empty',
      match: { command: 'tsc' },
      pipeline: [
        { action: 'on_empty', message: 'A'.repeat(500) },
        { action: 'format_template', template: '{{.lines}} extra extra extra' }
      ]
    }
    filtersBox.filters = [growsFilter]
    const r = mkResult({ stdout: '' })
    const o = applySnip('tsc', r, {
      snipEnabled: true,
      bypassThisCall: false,
      nowMs: 1
    })
    // event is null because filter would have grown the output above
    // the empty input's token count.
    expect(o.event).toBe(null)
    expect(o.result.stdout).toBe('') // raw preserved
    // matched_filter still recorded so the dashboard knows the filter
    // fired (coverage signal), just no savings event.
    const log = db
      .prepare('SELECT matched_filter FROM snip_command_log')
      .all() as Array<{ matched_filter: string | null }>
    expect(log).toEqual([{ matched_filter: 'grows' }])
  })

  it('chain command → pass-through (matcher returns null for chains)', () => {
    filtersBox.filters = [gitStatusFilter]
    const r = mkResult({ stdout: 'shouldnt change' })
    const o = applySnip('cd foo && git status', r, {
      snipEnabled: true,
      bypassThisCall: false,
      nowMs: 1
    })
    expect(o.matchedFilter).toBe(null)
    expect(o.result.stdout).toBe('shouldnt change')
  })
})
