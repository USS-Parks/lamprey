import { beforeEach, describe, expect, it, vi } from 'vitest'

// Force getDb() to throw so the store engages its in-memory fallback. The DB
// path is the same code shape — better-sqlite3's native binding doesn't
// load under the host Node version used by vitest, so we exercise the
// fallback and trust the SQL path via the integration smoke at runtime.
vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('electron app not available in test environment')
    }
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

import {
  __forceMemoryFallback,
  __resetAgentRunStore,
  finishRun,
  getRun,
  getRunOutput,
  insertRun,
  listRuns,
  realAgentRunStore,
  updateRun
} from './agent-run-store'

beforeEach(() => {
  __resetAgentRunStore()
  __forceMemoryFallback()
})

describe('insertRun + getRun', () => {
  it('inserts a running row with all fields and defaults', () => {
    insertRun({
      id: 'r1',
      agentType: 'Explore',
      label: 'find foo',
      startedAt: 100
    })
    const row = getRun('r1')
    expect(row).not.toBeNull()
    expect(row!.id).toBe('r1')
    expect(row!.agentType).toBe('Explore')
    expect(row!.label).toBe('find foo')
    expect(row!.status).toBe('running')
    expect(row!.startedAt).toBe(100)
    expect(row!.finishedAt).toBeNull()
    expect(row!.resultText).toBeNull()
    expect(row!.error).toBeNull()
    expect(row!.background).toBe(false)
    expect(row!.parentConvId).toBeNull()
    expect(row!.parentRunId).toBeNull()
  })

  it('honors parent ids + background flag + worktree path', () => {
    insertRun({
      id: 'r2',
      parentConvId: 'conv-a',
      parentRunId: 'r-parent',
      agentType: 'Plan',
      label: 'plan it',
      startedAt: 200,
      background: true,
      worktreePath: '/wt/abc'
    })
    const row = getRun('r2')!
    expect(row.parentConvId).toBe('conv-a')
    expect(row.parentRunId).toBe('r-parent')
    expect(row.background).toBe(true)
    expect(row.worktreePath).toBe('/wt/abc')
  })
})

describe('finishRun', () => {
  it('marks status done + persists resultText', () => {
    insertRun({ id: 'r1', agentType: 'Explore', label: 'x', startedAt: 100 })
    finishRun({ id: 'r1', status: 'done', finishedAt: 500, resultText: 'foo lives at src/foo.ts:12' })
    const row = getRun('r1')!
    expect(row.status).toBe('done')
    expect(row.finishedAt).toBe(500)
    expect(row.resultText).toBe('foo lives at src/foo.ts:12')
    expect(row.error).toBeNull()
  })

  it('captures error message on error status', () => {
    insertRun({ id: 'r1', agentType: 'Explore', label: 'x', startedAt: 100 })
    finishRun({ id: 'r1', status: 'error', finishedAt: 500, error: 'boom' })
    const row = getRun('r1')!
    expect(row.status).toBe('error')
    expect(row.error).toBe('boom')
    expect(row.resultText).toBeNull()
  })

  it('captures aborted status', () => {
    insertRun({ id: 'r1', agentType: 'Explore', label: 'x', startedAt: 100 })
    finishRun({ id: 'r1', status: 'aborted', finishedAt: 500, error: 'user-stop' })
    expect(getRun('r1')!.status).toBe('aborted')
  })

  it('preserves worktree_path set at insert when not in finishRun', () => {
    insertRun({
      id: 'r1',
      agentType: 'Explore',
      label: 'x',
      startedAt: 100,
      worktreePath: '/wt/already-set'
    })
    finishRun({ id: 'r1', status: 'done', finishedAt: 500, resultText: 'ok' })
    expect(getRun('r1')!.worktreePath).toBe('/wt/already-set')
  })

  it('is a no-op for an unknown id', () => {
    finishRun({ id: 'missing', status: 'done', finishedAt: 500 })
    expect(getRun('missing')).toBeNull()
  })
})

describe('updateRun', () => {
  it('updates label without touching status/result', () => {
    insertRun({ id: 'r1', agentType: 'Explore', label: 'old', startedAt: 100 })
    updateRun('r1', { label: 'renamed' })
    const row = getRun('r1')!
    expect(row.label).toBe('renamed')
    expect(row.status).toBe('running')
  })

  it('is a no-op for an unknown id', () => {
    updateRun('missing', { label: 'whatever' })
    expect(getRun('missing')).toBeNull()
  })
})

describe('listRuns', () => {
  beforeEach(() => {
    insertRun({ id: 'a', agentType: 'Explore', label: 'a', startedAt: 100, parentConvId: 'c1' })
    insertRun({ id: 'b', agentType: 'Plan', label: 'b', startedAt: 200, parentConvId: 'c1', background: true })
    insertRun({ id: 'c', agentType: 'Explore', label: 'c', startedAt: 300, parentConvId: 'c2' })
    finishRun({ id: 'a', status: 'done', finishedAt: 150 })
    finishRun({ id: 'c', status: 'error', finishedAt: 350, error: 'boom' })
  })

  it('returns all runs sorted by started_at DESC when no filter', () => {
    const rows = listRuns({})
    expect(rows.map((r) => r.id)).toEqual(['c', 'b', 'a'])
  })

  it('filters by single status', () => {
    expect(listRuns({ status: 'running' }).map((r) => r.id)).toEqual(['b'])
    expect(listRuns({ status: 'done' }).map((r) => r.id)).toEqual(['a'])
    expect(listRuns({ status: 'error' }).map((r) => r.id)).toEqual(['c'])
  })

  it('filters by array of statuses', () => {
    expect(listRuns({ status: ['done', 'error'] }).map((r) => r.id).sort()).toEqual(['a', 'c'])
  })

  it('returns [] when filter.status is an empty array (no implicit match-all)', () => {
    expect(listRuns({ status: [] })).toEqual([])
  })

  it('filters by parentConvId', () => {
    expect(listRuns({ parentConvId: 'c1' }).map((r) => r.id)).toEqual(['b', 'a'])
    expect(listRuns({ parentConvId: 'c2' }).map((r) => r.id)).toEqual(['c'])
  })

  it('filters by background flag', () => {
    expect(listRuns({ background: true }).map((r) => r.id)).toEqual(['b'])
    expect(listRuns({ background: false }).map((r) => r.id).sort()).toEqual(['a', 'c'])
  })

  it('honors limit', () => {
    expect(listRuns({ limit: 2 }).map((r) => r.id)).toEqual(['c', 'b'])
  })
})

describe('getRunOutput', () => {
  it('returns resultText + error for a finished run', () => {
    insertRun({ id: 'r1', agentType: 'Explore', label: 'x', startedAt: 100 })
    finishRun({ id: 'r1', status: 'done', finishedAt: 500, resultText: 'hello world' })
    expect(getRunOutput('r1')).toEqual({ resultText: 'hello world', error: null })
  })

  it('returns null for an unknown id', () => {
    expect(getRunOutput('nope')).toBeNull()
  })
})

describe('realAgentRunStore', () => {
  it('exposes insertRun + finishRun bound to the persistence functions', () => {
    realAgentRunStore.insertRun({
      id: 'r1',
      agentType: 'Explore',
      label: 'x',
      startedAt: 100
    })
    realAgentRunStore.finishRun({
      id: 'r1',
      status: 'done',
      finishedAt: 500,
      resultText: 'ok'
    })
    expect(getRun('r1')!.status).toBe('done')
    expect(getRun('r1')!.resultText).toBe('ok')
  })
})
