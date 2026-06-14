import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const TEST_USER_DATA = join(tmpdir(), `lamprey-loop-store-test-${process.pid}-${Date.now()}`)

vi.mock('electron', () => ({
  app: { getPath: () => TEST_USER_DATA },
  BrowserWindow: { getAllWindows: () => [] }
}))

import { createConversation } from './conversation-store'
import { __resetDbForTests, getDb } from './database'
import {
  nextPosition,
  createLoop,
  getLoop,
  listLoops,
  listDueLoops,
  updateLoop,
  deleteLoop,
  enqueueBacklog,
  nextBacklogItem,
  listBacklog,
  countBacklog,
  updateBacklogItem,
  reorderBacklog,
  removeBacklogItem,
  recordLoopRun,
  finishLoopRun,
  listLoopRuns
} from './loop-store'

function nativeOk(): boolean {
  try {
    getDb()
    return true
  } catch {
    return false
  }
}

beforeEach(() => {
  __resetDbForTests()
  if (existsSync(TEST_USER_DATA)) rmSync(TEST_USER_DATA, { recursive: true, force: true })
  mkdirSync(TEST_USER_DATA, { recursive: true })
})

afterAll(() => {
  __resetDbForTests()
  if (existsSync(TEST_USER_DATA)) rmSync(TEST_USER_DATA, { recursive: true, force: true })
})

// Pure — runs everywhere, no DB needed.
describe('nextPosition (pure)', () => {
  it('returns 0 for an empty queue', () => {
    expect(nextPosition([])).toBe(0)
  })
  it('returns one past the max, tolerating gaps', () => {
    expect(nextPosition([0, 1, 2])).toBe(3)
    expect(nextPosition([0, 5, 2])).toBe(6)
  })
})

describe('LP-2 loop-store CRUD', () => {
  it.skipIf(!nativeOk())('migration v17 brings the schema to user_version 17', () => {
    const v = getDb().pragma('user_version', { simple: true })
    expect(v).toBe(17)
  })

  it.skipIf(!nativeOk())('creates, reads, updates, and lists loops', () => {
    const conv = createConversation('deepseek-chat')
    const loop = createLoop({
      conversationId: conv.id,
      mode: 'interval',
      instruction: 'Watch the build',
      model: 'deepseek-chat',
      intervalSeconds: 300,
      maxIterations: 10
    })
    expect(loop.status).toBe('running')
    expect(getLoop(loop.id)?.instruction).toBe('Watch the build')

    updateLoop(loop.id, { iteration: 2, tokensUsed: 1500, status: 'paused' })
    const after = getLoop(loop.id)
    expect(after?.iteration).toBe(2)
    expect(after?.tokensUsed).toBe(1500)
    expect(after?.status).toBe('paused')

    expect(listLoops({ conversationId: conv.id }).map((l) => l.id)).toEqual([loop.id])
    expect(listLoops({ status: 'paused' })).toHaveLength(1)
  })

  it.skipIf(!nativeOk())('lists only due running loops', () => {
    const conv = createConversation('deepseek-chat')
    const due = createLoop({ conversationId: conv.id, mode: 'interval', nextFireAt: Date.now() - 1000 })
    const future = createLoop({ conversationId: conv.id, mode: 'interval', nextFireAt: Date.now() + 60_000 })
    const paused = createLoop({ conversationId: conv.id, mode: 'interval', nextFireAt: Date.now() - 1000 })
    updateLoop(paused.id, { status: 'paused' })

    const ids = listDueLoops().map((l) => l.id)
    expect(ids).toContain(due.id)
    expect(ids).not.toContain(future.id)
    expect(ids).not.toContain(paused.id)
  })

  it.skipIf(!nativeOk())('drains the backlog in position order and tracks counts', () => {
    const conv = createConversation('deepseek-chat')
    const loop = createLoop({ conversationId: conv.id, mode: 'autonomous' })
    const items = enqueueBacklog(loop.id, ['task A', 'task B', 'task C'])
    expect(items.map((i) => i.position)).toEqual([0, 1, 2])
    expect(countBacklog(loop.id, 'pending')).toBe(3)

    const first = nextBacklogItem(loop.id)
    expect(first?.task).toBe('task A')
    updateBacklogItem(first!.id, { status: 'done', result: 'ok', finishedAt: Date.now() })
    expect(countBacklog(loop.id, 'pending')).toBe(2)
    expect(nextBacklogItem(loop.id)?.task).toBe('task B')

    // enqueue more (autonomous self-growth) — appends past the max position
    const more = enqueueBacklog(loop.id, ['task D'])
    expect(more[0].position).toBe(3)
  })

  it.skipIf(!nativeOk())('reorders and removes backlog items', () => {
    const conv = createConversation('deepseek-chat')
    const loop = createLoop({ conversationId: conv.id, mode: 'autonomous' })
    const [a, b, c] = enqueueBacklog(loop.id, ['A', 'B', 'C'])
    reorderBacklog(loop.id, [c.id, a.id, b.id])
    expect(listBacklog(loop.id).map((i) => i.task)).toEqual(['C', 'A', 'B'])
    expect(removeBacklogItem(b.id)).toBe(true)
    expect(listBacklog(loop.id).map((i) => i.task)).toEqual(['C', 'A'])
  })

  it.skipIf(!nativeOk())('records and finishes run audit rows', () => {
    const conv = createConversation('deepseek-chat')
    const loop = createLoop({ conversationId: conv.id, mode: 'self_paced' })
    const run = recordLoopRun({ loopId: loop.id, iteration: 1 })
    expect(run.status).toBe('running')
    finishLoopRun(run.id, { status: 'done', tokensUsed: 2200 })
    const runs = listLoopRuns(loop.id)
    expect(runs[0].status).toBe('done')
    expect(runs[0].tokensUsed).toBe(2200)
  })

  it.skipIf(!nativeOk())('deleteLoop cascades backlog + runs', () => {
    const conv = createConversation('deepseek-chat')
    const loop = createLoop({ conversationId: conv.id, mode: 'autonomous' })
    enqueueBacklog(loop.id, ['x', 'y'])
    recordLoopRun({ loopId: loop.id, iteration: 1 })
    expect(deleteLoop(loop.id)).toBe(true)
    expect(getLoop(loop.id)).toBeNull()
    expect(listBacklog(loop.id)).toEqual([])
    expect(listLoopRuns(loop.id)).toEqual([])
  })
})
