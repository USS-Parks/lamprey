import { describe, it, expect } from 'vitest'
import {
  checkCeilings,
  computeNextFire,
  estimateTokens,
  buildIterationPrompt,
  runLoopIteration,
  MIN_INTERVAL_SECONDS,
  DEFAULT_INTERVAL_SECONDS,
  type LoopStoreSeam,
  type LoopIterationDeps
} from './loop-controller'
import type { Loop, BacklogItem, LoopRun } from './loop-store'

// LP-3 — these tests inject a fake store + runTurn + clock, so the ceiling /
// stop-authority / backlog-drain logic runs WITHOUT a DB. No native binding,
// no skip — this is real coverage of the controller core.

function makeLoop(over: Partial<Loop> = {}): Loop {
  return {
    id: 'loop-1',
    conversationId: 'conv-1',
    mode: 'interval',
    status: 'running',
    instruction: 'Keep the build green',
    model: 'deepseek-chat',
    intervalSeconds: 300,
    maxIterations: null,
    maxWallclockMs: null,
    tokenBudget: null,
    iteration: 0,
    tokensUsed: 0,
    startedAt: 1000,
    lastIterationAt: null,
    nextFireAt: 0,
    stopReason: null,
    createdAt: 1000,
    updatedAt: 1000,
    ...over
  }
}

function makeItem(over: Partial<BacklogItem> = {}): BacklogItem {
  return {
    id: 'b1',
    loopId: 'loop-1',
    position: 0,
    task: 'do a thing',
    status: 'pending',
    result: null,
    createdAt: 0,
    startedAt: null,
    finishedAt: null,
    ...over
  }
}

function makeFakeStore(loop: Loop, backlogItems: BacklogItem[]) {
  const loops = new Map<string, Loop>([[loop.id, { ...loop }]])
  let backlog = backlogItems.map((b) => ({ ...b }))
  const runs: LoopRun[] = []
  const seam: LoopStoreSeam = {
    getLoop: (id) => loops.get(id) ?? null,
    updateLoop: (id, patch) => {
      const cur = loops.get(id)
      if (!cur) return null
      const next = { ...cur, ...patch } as Loop
      loops.set(id, next)
      return next
    },
    nextBacklogItem: (loopId) =>
      backlog
        .filter((b) => b.loopId === loopId && b.status === 'pending')
        .sort((a, b) => a.position - b.position)[0] ?? null,
    updateBacklogItem: (id, patch) => {
      backlog = backlog.map((b) => (b.id === id ? ({ ...b, ...patch } as BacklogItem) : b))
      return backlog.find((b) => b.id === id) ?? null
    },
    countBacklog: (loopId, status) =>
      backlog.filter((b) => b.loopId === loopId && (status ? b.status === status : true)).length,
    listRecentDone: (loopId, limit) =>
      backlog
        .filter((b) => b.loopId === loopId && b.status === 'done')
        .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
        .slice(0, limit),
    recordLoopRun: (input) => {
      const run: LoopRun = {
        id: `run-${runs.length}`,
        loopId: input.loopId,
        iteration: input.iteration,
        backlogId: input.backlogId ?? null,
        startedAt: input.startedAt ?? 0,
        finishedAt: null,
        status: 'running',
        tokensUsed: null,
        createdAt: 0
      }
      runs.push(run)
      return run
    },
    finishLoopRun: (id, patch) => {
      const run = runs.find((r) => r.id === id)
      if (run) Object.assign(run, patch)
      return run ?? null
    },
    listDueLoops: (now) =>
      [...loops.values()].filter(
        (l) => l.status === 'running' && (l.nextFireAt == null || l.nextFireAt <= now)
      )
  }
  const appendPending = (tasks: string[]): void => {
    const base = backlog.length
    tasks.forEach((task, i) =>
      backlog.push(makeItem({ id: `g${base + i}`, position: base + i, task, status: 'pending' }))
    )
  }
  return { seam, loops, runs, getBacklog: () => backlog, appendPending }
}

describe('checkCeilings (pure)', () => {
  it('continues when no caps set', () => {
    expect(checkCeilings(makeLoop(), 5000).stop).toBe(false)
  })
  it('stops at max iterations', () => {
    const d = checkCeilings(makeLoop({ iteration: 5, maxIterations: 5 }), 5000)
    expect(d).toMatchObject({ stop: true, reason: 'max-iterations', status: 'done' })
  })
  it('stops at max wall-clock', () => {
    const d = checkCeilings(makeLoop({ startedAt: 1000, maxWallclockMs: 500 }), 1600)
    expect(d).toMatchObject({ stop: true, reason: 'max-wallclock' })
  })
  it('stops at token budget', () => {
    const d = checkCeilings(makeLoop({ tokensUsed: 200, tokenBudget: 150 }), 5000)
    expect(d).toMatchObject({ stop: true, reason: 'token-budget' })
  })
  it('ignores a zero/null token budget', () => {
    expect(checkCeilings(makeLoop({ tokensUsed: 9999, tokenBudget: 0 }), 5000).stop).toBe(false)
    expect(checkCeilings(makeLoop({ tokensUsed: 9999, tokenBudget: null }), 5000).stop).toBe(false)
  })
})

describe('computeNextFire (pure)', () => {
  it('interval = now + interval seconds', () => {
    expect(computeNextFire({ mode: 'interval', intervalSeconds: 120 }, 1000)).toBe(1000 + 120_000)
  })
  it('interval clamps to the runaway floor', () => {
    expect(computeNextFire({ mode: 'interval', intervalSeconds: 1 }, 1000)).toBe(
      1000 + MIN_INTERVAL_SECONDS * 1000
    )
  })
  it('interval falls back to the default when unset', () => {
    expect(computeNextFire({ mode: 'interval', intervalSeconds: null }, 0)).toBe(
      DEFAULT_INTERVAL_SECONDS * 1000
    )
  })
  it('autonomous fires at the floor', () => {
    expect(computeNextFire({ mode: 'autonomous', intervalSeconds: null }, 0, 30)).toBe(30_000)
  })
})

describe('estimateTokens / buildIterationPrompt (pure)', () => {
  it('estimates ~4 chars/token', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
  })
  it('prompt includes instruction, task, iteration, and remaining count', () => {
    const p = buildIterationPrompt(makeLoop(), makeItem({ task: 'ship it' }), {
      iteration: 3,
      remaining: 2
    })
    expect(p).toContain('Keep the build green')
    expect(p).toContain('ship it')
    expect(p).toContain('iteration 3')
    expect(p).toContain('2 task(s) remain')
    expect(p).toContain('loop_complete_task')
  })
})

describe('runLoopIteration (injected seam, runs fully)', () => {
  function deps(store: ReturnType<typeof makeFakeStore>, over: Partial<LoopIterationDeps> = {}): LoopIterationDeps {
    return {
      store: store.seam,
      runTurn: async () => ({ tokensUsed: 10 }),
      clock: () => 5000,
      ...over
    }
  }

  it('drains a 3-item backlog over 3 iterations, then stops backlog-empty', async () => {
    const store = makeFakeStore(makeLoop({ iteration: 0 }), [
      makeItem({ id: 'b1', position: 0, task: 'A' }),
      makeItem({ id: 'b2', position: 1, task: 'B' }),
      makeItem({ id: 'b3', position: 2, task: 'C' })
    ])
    const d = deps(store)
    const outcomes: string[] = []
    for (let i = 0; i < 5; i++) {
      const loop = store.seam.getLoop('loop-1')!
      if (loop.status !== 'running') break
      const o = await runLoopIteration(loop, d)
      outcomes.push(o.reason ?? (o.stopped ? 'stopped' : 'continue'))
    }
    const final = store.seam.getLoop('loop-1')!
    expect(final.status).toBe('done')
    expect(final.stopReason).toBe('backlog-empty')
    expect(final.iteration).toBe(3)
    expect(store.getBacklog().every((b) => b.status === 'done')).toBe(true)
    expect(outcomes[outcomes.length - 1]).toBe('backlog-empty')
  })

  it('stops pre-flight at max iterations without running a turn', async () => {
    const store = makeFakeStore(makeLoop({ iteration: 3, maxIterations: 3 }), [makeItem()])
    let ran = false
    const o = await runLoopIteration(store.seam.getLoop('loop-1')!, deps(store, { runTurn: async () => { ran = true; return {} } }))
    expect(ran).toBe(false)
    expect(o).toMatchObject({ ran: false, stopped: true, reason: 'max-iterations' })
    expect(store.seam.getLoop('loop-1')!.status).toBe('done')
  })

  it('stops post-iteration at the token budget', async () => {
    const store = makeFakeStore(makeLoop({ tokensUsed: 0, tokenBudget: 15 }), [
      makeItem({ id: 'b1', position: 0 }),
      makeItem({ id: 'b2', position: 1 })
    ])
    const o = await runLoopIteration(store.seam.getLoop('loop-1')!, deps(store, { runTurn: async () => ({ tokensUsed: 20 }) }))
    expect(o).toMatchObject({ ran: true, stopped: true, reason: 'token-budget' })
    const final = store.seam.getLoop('loop-1')!
    expect(final.status).toBe('done')
    expect(final.tokensUsed).toBe(20)
  })

  it('marks the item error and keeps the loop running when a turn throws', async () => {
    const store = makeFakeStore(makeLoop(), [
      makeItem({ id: 'b1', position: 0 }),
      makeItem({ id: 'b2', position: 1 })
    ])
    const o = await runLoopIteration(
      store.seam.getLoop('loop-1')!,
      deps(store, { runTurn: async () => { throw new Error('provider 500') } })
    )
    expect(o).toMatchObject({ ran: true, stopped: false, error: 'provider 500' })
    const item = store.getBacklog().find((b) => b.id === 'b1')!
    expect(item.status).toBe('error')
    expect(item.result).toContain('provider 500')
    const loop = store.seam.getLoop('loop-1')!
    expect(loop.status).toBe('running')
    expect(loop.iteration).toBe(1)
    expect(loop.nextFireAt).not.toBeNull()
  })

  it('schedules the next fire on a continuing iteration', async () => {
    const store = makeFakeStore(makeLoop({ intervalSeconds: 120 }), [
      makeItem({ id: 'b1', position: 0 }),
      makeItem({ id: 'b2', position: 1 })
    ])
    const o = await runLoopIteration(store.seam.getLoop('loop-1')!, deps(store))
    expect(o).toMatchObject({ ran: true, stopped: false })
    expect(store.seam.getLoop('loop-1')!.nextFireAt).toBe(5000 + 120_000)
  })
})

describe('LP-4 self-paced cadence + mid-turn model control', () => {
  it('honours a next-fire the model set during the turn (self_paced)', async () => {
    const store = makeFakeStore(makeLoop({ mode: 'self_paced', intervalSeconds: null }), [
      makeItem({ id: 'b1', position: 0 }),
      makeItem({ id: 'b2', position: 1 })
    ])
    const runTurn = async (): Promise<{ tokensUsed: number }> => {
      store.seam.updateLoop('loop-1', { nextFireAt: 5000 + 999_000 })
      return { tokensUsed: 1 }
    }
    const o = await runLoopIteration(store.seam.getLoop('loop-1')!, {
      store: store.seam,
      runTurn,
      clock: () => 5000
    })
    expect(o).toMatchObject({ ran: true, stopped: false })
    expect(store.seam.getLoop('loop-1')!.nextFireAt).toBe(5000 + 999_000)
  })

  it('terminates when the model stops the loop during the turn', async () => {
    const store = makeFakeStore(makeLoop({ mode: 'self_paced' }), [
      makeItem({ id: 'b1', position: 0 }),
      makeItem({ id: 'b2', position: 1 })
    ])
    const runTurn = async (): Promise<Record<string, never>> => {
      store.seam.updateLoop('loop-1', { status: 'stopped', stopReason: 'model-stop' })
      return {}
    }
    const o = await runLoopIteration(store.seam.getLoop('loop-1')!, {
      store: store.seam,
      runTurn,
      clock: () => 5000
    })
    expect(o).toMatchObject({ ran: true, stopped: true, reason: 'model-stop' })
    expect(store.seam.getLoop('loop-1')!.status).toBe('stopped')
  })
})

describe('LP-5 autonomous backlog mode', () => {
  function deps2(
    store: ReturnType<typeof makeFakeStore>,
    over: Partial<LoopIterationDeps> = {}
  ): LoopIterationDeps {
    return {
      store: store.seam,
      runTurn: async () => ({ tokensUsed: 1 }),
      clock: () => 5000,
      ...over
    }
  }

  it('grows the backlog mid-turn (loop_enqueue) then drains to done', async () => {
    const store = makeFakeStore(makeLoop({ mode: 'autonomous', intervalSeconds: null }), [
      makeItem({ id: 'b1', position: 0, task: 'seed' })
    ])
    let grew = false
    const runTurn = async (): Promise<{ tokensUsed: number }> => {
      if (!grew) {
        grew = true
        store.appendPending(['discovered-1', 'discovered-2'])
      }
      return { tokensUsed: 1 }
    }
    for (let i = 0; i < 10; i++) {
      const loop = store.seam.getLoop('loop-1')!
      if (loop.status !== 'running') break
      await runLoopIteration(loop, deps2(store, { runTurn }))
    }
    const final = store.seam.getLoop('loop-1')!
    expect(final.status).toBe('done')
    expect(final.stopReason).toBe('backlog-empty')
    expect(final.iteration).toBe(3) // seed + 2 discovered
    expect(store.getBacklog().every((b) => b.status === 'done')).toBe(true)
  })

  it('injects a progress ledger so settled work is visible to the model', async () => {
    const store = makeFakeStore(makeLoop({ mode: 'autonomous', intervalSeconds: null }), [
      makeItem({ id: 'b1', position: 0, task: 'first task' }),
      makeItem({ id: 'b2', position: 1, task: 'second task' })
    ])
    const prompts: string[] = []
    const runTurn = async (input: { promptBody: string }): Promise<{ tokensUsed: number }> => {
      prompts.push(input.promptBody)
      return { tokensUsed: 1 }
    }
    await runLoopIteration(store.seam.getLoop('loop-1')!, deps2(store, { runTurn }))
    await runLoopIteration(store.seam.getLoop('loop-1')!, deps2(store, { runTurn }))
    expect(prompts[0]).toContain('first task')
    expect(prompts[0]).not.toContain('Already done')
    expect(prompts[1]).toContain('Already done')
    expect(prompts[1]).toContain('first task')
  })

  it('runaway clamp: a continuing autonomous iteration fires no sooner than the floor', async () => {
    const store = makeFakeStore(makeLoop({ mode: 'autonomous', intervalSeconds: null }), [
      makeItem({ id: 'b1', position: 0 }),
      makeItem({ id: 'b2', position: 1 })
    ])
    const o = await runLoopIteration(store.seam.getLoop('loop-1')!, deps2(store, { minIntervalSeconds: 30 }))
    expect(o).toMatchObject({ ran: true, stopped: false })
    expect(store.seam.getLoop('loop-1')!.nextFireAt).toBe(5000 + 30_000)
  })
})

describe('LP-6 per-iteration stall watchdog', () => {
  it('aborts a stalled iteration without wedging the loop', async () => {
    const store = makeFakeStore(makeLoop({ mode: 'interval', intervalSeconds: 60 }), [
      makeItem({ id: 'b1', position: 0 }),
      makeItem({ id: 'b2', position: 1 })
    ])
    const runTurn = (input: { signal?: AbortSignal }): Promise<never> =>
      new Promise((_resolve, reject) => {
        input.signal?.addEventListener('abort', () => reject(new Error('aborted by watchdog')))
      })
    const o = await runLoopIteration(store.seam.getLoop('loop-1')!, {
      store: store.seam,
      runTurn,
      clock: () => 5000,
      iterationTimeoutMs: 20
    })
    expect(o).toMatchObject({ ran: true, stopped: false, timedOut: true })
    const item = store.getBacklog().find((b) => b.id === 'b1')!
    expect(item.status).toBe('error')
    expect(item.result).toContain('timed out')
    const loop = store.seam.getLoop('loop-1')!
    expect(loop.status).toBe('running')
    expect(loop.iteration).toBe(1)
    expect(loop.nextFireAt).toBe(5000 + 60_000)
  })

  it('a fast turn under the budget is unaffected', async () => {
    const store = makeFakeStore(makeLoop({ mode: 'interval', intervalSeconds: 60 }), [
      makeItem({ id: 'b1', position: 0 }),
      makeItem({ id: 'b2', position: 1 })
    ])
    const o = await runLoopIteration(store.seam.getLoop('loop-1')!, {
      store: store.seam,
      runTurn: async () => ({ tokensUsed: 5 }),
      clock: () => 5000,
      iterationTimeoutMs: 10_000
    })
    expect(o).toMatchObject({ ran: true, stopped: false })
    expect(o.timedOut).toBeUndefined()
    expect(store.getBacklog().find((b) => b.id === 'b1')!.status).toBe('done')
  })
})
