import { describe, it, expect, vi } from 'vitest'
import { AskUserRuntime, type AskUserAwaitingEvent } from './ask-user-runtime'

function makeRuntime() {
  const emitted: AskUserAwaitingEvent[] = []
  let idCounter = 0
  let now = 1_000_000
  const timers: Array<{ cb: () => void; ms: number; cancelled: boolean }> = []
  const runtime = new AskUserRuntime({
    emit: (e) => emitted.push(e),
    clock: () => now,
    genId: () => `req-${++idCounter}`,
    schedule: (cb, ms) => {
      const entry = { cb, ms, cancelled: false }
      timers.push(entry)
      return { cancel: () => (entry.cancelled = true) }
    }
  })
  return {
    runtime,
    emitted,
    setNow: (t: number) => (now = t),
    fireTimer: (idx = 0) => {
      const t = timers[idx]
      if (!t || t.cancelled) return false
      t.cb()
      return true
    },
    timers
  }
}

describe('AskUserRuntime', () => {
  it('emits awaiting event and resolves on respond', async () => {
    const { runtime, emitted } = makeRuntime()
    const p = runtime.ask({
      question: 'Pick a color?',
      header: 'Color',
      options: [
        { label: 'red' },
        { label: 'blue' }
      ]
    })
    expect(emitted).toHaveLength(1)
    const req = emitted[0]!
    expect(req.options).toHaveLength(2)
    expect(req.header).toBe('Color')
    expect(req.multiSelect).toBe(false)
    const matched = runtime.respond(req.requestId, {
      kind: 'single',
      label: 'red',
      header: 'Color'
    })
    expect(matched).toBe(true)
    const answer = await p
    expect(answer).toEqual({ kind: 'single', label: 'red', header: 'Color' })
    expect(runtime.size()).toBe(0)
  })

  it('rejects bad input shapes', async () => {
    const { runtime } = makeRuntime()
    await expect(runtime.ask({} as any)).rejects.toThrow(/question/)
    await expect(
      runtime.ask({ question: 'q', header: '', options: [{ label: 'a' }, { label: 'b' }] } as any)
    ).rejects.toThrow(/header/)
    await expect(
      runtime.ask({ question: 'q', header: 'h', options: [{ label: 'a' }] } as any)
    ).rejects.toThrow(/2 and 4/)
    await expect(
      runtime.ask({
        question: 'q',
        header: 'h',
        options: [{ label: '' }, { label: 'b' }]
      } as any)
    ).rejects.toThrow(/label/)
  })

  it('resolves with timeout sentinel when the scheduled timer fires', async () => {
    const { runtime, fireTimer, timers } = makeRuntime()
    const p = runtime.ask({
      question: 'Color?',
      header: 'Color',
      options: [{ label: 'red' }, { label: 'blue' }],
      timeoutMs: 5000
    })
    expect(timers[0]?.ms).toBe(5000)
    fireTimer(0)
    const answer = await p
    expect(answer).toEqual({ kind: 'timeout' })
    expect(runtime.size()).toBe(0)
  })

  it('clamps timeout to the max', () => {
    const { runtime, timers } = makeRuntime()
    void runtime.ask({
      question: 'q',
      header: 'h',
      options: [{ label: 'a' }, { label: 'b' }],
      timeoutMs: 60 * 60 * 1000 // 1h, above the 10m cap
    })
    expect(timers[0]?.ms).toBe(10 * 60_000)
  })

  it('respond returns false for an unknown id', () => {
    const { runtime } = makeRuntime()
    expect(runtime.respond('nope', { kind: 'cancelled' })).toBe(false)
  })

  it('cancelAll resolves every pending entry with the cancelled sentinel', async () => {
    const { runtime } = makeRuntime()
    const p1 = runtime.ask({
      question: 'Q1',
      header: 'A',
      options: [{ label: 'a' }, { label: 'b' }]
    })
    const p2 = runtime.ask({
      question: 'Q2',
      header: 'B',
      options: [{ label: 'a' }, { label: 'b' }]
    })
    expect(runtime.size()).toBe(2)
    expect(runtime.cancelAll()).toBe(2)
    expect(runtime.size()).toBe(0)
    await expect(p1).resolves.toEqual({ kind: 'cancelled' })
    await expect(p2).resolves.toEqual({ kind: 'cancelled' })
  })

  it('list returns the in-flight entries with header/question/askedAt', async () => {
    const { runtime, setNow } = makeRuntime()
    setNow(123_000)
    void runtime.ask({
      question: 'Pick?',
      header: 'X',
      options: [{ label: 'a' }, { label: 'b' }]
    })
    const list = runtime.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.header).toBe('X')
    expect(list[0]?.askedAt).toBe(123_000)
  })

  it('supports multi-select responses', async () => {
    const { runtime, emitted } = makeRuntime()
    const p = runtime.ask({
      question: 'Pick more than one',
      header: 'Pick',
      multiSelect: true,
      options: [
        { label: 'a' },
        { label: 'b' },
        { label: 'c' }
      ]
    })
    expect(emitted[0]?.multiSelect).toBe(true)
    runtime.respond(emitted[0]!.requestId, {
      kind: 'multi',
      labels: ['a', 'c'],
      header: 'Pick'
    })
    await expect(p).resolves.toEqual({
      kind: 'multi',
      labels: ['a', 'c'],
      header: 'Pick'
    })
  })
})
