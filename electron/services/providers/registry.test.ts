import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the OpenAI SDK with a controllable stream so we can simulate the
// "provider opened a socket then stopped sending chunks" case without a
// real network call. The mock has to live ABOVE the registry import so
// vi.mock hoisting catches it before the module under test loads.
const mockCreate = vi.fn()
vi.mock('openai', () => {
  return {
    default: class FakeOpenAI {
      chat = {
        completions: {
          create: mockCreate
        }
      }
    }
  }
})

// Keychain returns a non-empty key so getClientForProvider doesn't throw.
vi.mock('../keychain', () => ({
  getKey: () => 'test-key'
}))

// event-log is a pure-side-effect module; stub it to no-op.
vi.mock('../event-log', () => ({
  recordEvent: vi.fn(),
  boundedJsonPreview: (s: unknown) => String(s ?? '')
}))

import {
  chatStream,
  chatOnce,
  StreamInactivityError,
  __setStreamInactivityForTesting,
  resetProviderClients
} from './registry'

// A controllable async-iterable stream: pushes chunks the test code feeds it,
// honors AbortSignal, and lets the test "stall" by simply never pushing.
function makeControllableStream() {
  const queue: any[] = []
  let resolveNext: ((v: { value: any; done: boolean }) => void) | null = null
  let rejectNext: ((e: Error) => void) | null = null
  let closed = false

  const push = (chunk: any) => {
    if (closed) return
    if (resolveNext) {
      const r = resolveNext
      resolveNext = null
      rejectNext = null
      r({ value: chunk, done: false })
    } else {
      queue.push(chunk)
    }
  }
  const end = () => {
    closed = true
    if (resolveNext) {
      const r = resolveNext
      resolveNext = null
      rejectNext = null
      r({ value: undefined, done: true })
    }
  }
  const fail = (err: Error) => {
    closed = true
    if (rejectNext) {
      const rj = rejectNext
      resolveNext = null
      rejectNext = null
      rj(err)
    }
  }

  let signalHandler: (() => void) | null = null
  const stream = {
    [Symbol.asyncIterator]() {
      return this
    },
    async next() {
      if (queue.length > 0) {
        return { value: queue.shift(), done: false }
      }
      if (closed) {
        return { value: undefined, done: true }
      }
      return new Promise<{ value: any; done: boolean }>((res, rej) => {
        resolveNext = res
        rejectNext = rej
      })
    },
    attachSignal(signal: AbortSignal) {
      signalHandler = () => {
        const err: any = new Error('Request was aborted.')
        err.name = 'AbortError'
        fail(err)
      }
      if (signal.aborted) signalHandler()
      else signal.addEventListener('abort', signalHandler, { once: true })
    }
  }

  return { stream, push, end, fail }
}

function makeChunk(content: string) {
  return {
    choices: [
      {
        delta: { content },
        index: 0,
        finish_reason: null
      }
    ]
  }
}

beforeEach(() => {
  mockCreate.mockReset()
  resetProviderClients()
})

describe('chatStream — SSE inactivity watchdog (T1)', () => {
  it('fires StreamInactivityError when the provider stops sending chunks', async () => {
    // 50 ms watchdog so the test stays fast.
    __setStreamInactivityForTesting(50)

    // Fresh stalling stream per attempt — the watchdog will retry up to 3
    // times with exponential backoff (2/4/8s), so we cap the test wait by
    // shrinking the backoff via fake timers. Instead of fake timers, just
    // accept the real backoff but keep the test runtime bounded with a
    // generous-but-not-infinite vitest timeout.
    mockCreate.mockImplementation((_req: unknown, opts: { signal: AbortSignal }) => {
      const fresh = makeControllableStream()
      fresh.stream.attachSignal(opts.signal)
      return Promise.resolve(fresh.stream)
    })

    let errorMessage: string | null = null
    let onDoneCalled = false

    const start = Date.now()
    await chatStream(
      [{ role: 'user', content: 'hi' }],
      'deepseek-v4-pro',
      undefined,
      {
        onChunk: () => {
          /* no-op */
        },
        onDone: () => {
          onDoneCalled = true
        },
        onError: (msg) => {
          errorMessage = msg
        }
      }
    )
    const elapsed = Date.now() - start

    expect(onDoneCalled).toBe(false)
    expect(errorMessage).toMatch(/Stream stalled|provider sent no chunks/i)
    expect(elapsed).toBeLessThan(20_000)

    __setStreamInactivityForTesting(null)
  }, 25_000)

  it('does NOT fire when chunks arrive within the watchdog window', async () => {
    __setStreamInactivityForTesting(200)

    const controllable = makeControllableStream()
    mockCreate.mockImplementation((_req: unknown, opts: { signal: AbortSignal }) => {
      controllable.stream.attachSignal(opts.signal)
      // Feed a chunk every 50ms (well inside 200ms watchdog) and finish.
      const t1 = setTimeout(() => controllable.push(makeChunk('hello ')), 30)
      const t2 = setTimeout(() => controllable.push(makeChunk('world')), 80)
      const t3 = setTimeout(() => controllable.end(), 130)
      void t1
      void t2
      void t3
      return Promise.resolve(controllable.stream)
    })

    let received = ''
    let errored = false
    let done = false
    await chatStream(
      [{ role: 'user', content: 'hi' }],
      'deepseek-v4-pro',
      undefined,
      {
        onChunk: (c) => {
          received += c
        },
        onDone: (full) => {
          done = true
          received = full
        },
        onError: () => {
          errored = true
        }
      }
    )

    expect(errored).toBe(false)
    expect(done).toBe(true)
    expect(received).toBe('hello world')

    __setStreamInactivityForTesting(null)
  })

  it('can be disabled by setting threshold to 0', async () => {
    __setStreamInactivityForTesting(0)

    const controllable = makeControllableStream()
    mockCreate.mockImplementation((_req: unknown, opts: { signal: AbortSignal }) => {
      controllable.stream.attachSignal(opts.signal)
      // Stall briefly then finish — the watchdog should NOT fire.
      setTimeout(() => controllable.push(makeChunk('ok')), 50)
      setTimeout(() => controllable.end(), 100)
      return Promise.resolve(controllable.stream)
    })

    let errored = false
    let done = false
    await chatStream(
      [{ role: 'user', content: 'hi' }],
      'deepseek-v4-pro',
      undefined,
      {
        onChunk: () => {},
        onDone: () => {
          done = true
        },
        onError: () => {
          errored = true
        }
      }
    )

    expect(errored).toBe(false)
    expect(done).toBe(true)

    __setStreamInactivityForTesting(null)
  })

  it('user-signal abort wins over the inactivity watchdog', async () => {
    __setStreamInactivityForTesting(500)

    const controllable = makeControllableStream()
    mockCreate.mockImplementation((_req: unknown, opts: { signal: AbortSignal }) => {
      controllable.stream.attachSignal(opts.signal)
      // Never send a chunk; rely on the user signal to break out.
      return Promise.resolve(controllable.stream)
    })

    const userAbort = new AbortController()
    let doneContent = ''
    let errored = false

    const p = chatStream(
      [{ role: 'user', content: 'hi' }],
      'deepseek-v4-pro',
      undefined,
      {
        onChunk: () => {},
        onDone: (full) => {
          doneContent = full
        },
        onError: () => {
          errored = true
        }
      },
      userAbort.signal
    )

    // Fire the user abort before the watchdog can.
    setTimeout(() => userAbort.abort(), 50)
    await p

    expect(errored).toBe(false)
    expect(doneContent).toContain('[cancelled]')

    __setStreamInactivityForTesting(null)
  })

  it('StreamInactivityError carries the configured threshold', () => {
    const e = new StreamInactivityError(45_000)
    expect(e.name).toBe('StreamInactivityError')
    expect(e.inactivityMs).toBe(45_000)
    expect(e.message).toMatch(/45s/)
  })
})

describe('chatStream — streaming-vitals heartbeat (T4)', () => {
  it('fires onVitals while the stream is active and stops when it ends', async () => {
    __setStreamInactivityForTesting(0)

    const controllable = makeControllableStream()
    mockCreate.mockImplementation((_req: unknown, opts: { signal: AbortSignal }) => {
      controllable.stream.attachSignal(opts.signal)
      // Drip chunks across a window long enough for at least one heartbeat
      // (provider fires every 2s; we tick out chunks slowly).
      setTimeout(() => controllable.push(makeChunk('a')), 100)
      setTimeout(() => controllable.push(makeChunk('b')), 2_200)
      setTimeout(() => controllable.end(), 2_400)
      return Promise.resolve(controllable.stream)
    })

    const vitalsCalls: Array<{ lastChunkAt: number; chunkCount: number }> = []
    let done = false
    await chatStream(
      [{ role: 'user', content: 'hi' }],
      'deepseek-v4-pro',
      undefined,
      {
        onChunk: () => {},
        onVitals: (v) =>
          vitalsCalls.push({ lastChunkAt: v.lastChunkAt, chunkCount: v.chunkCount }),
        onDone: () => {
          done = true
        },
        onError: () => {}
      }
    )

    expect(done).toBe(true)
    // At least one heartbeat fired in the ~2.4s window. Provider lifts the
    // 2s heartbeat regardless of chunk arrival so the renderer can show a
    // staleness indicator on slow providers.
    expect(vitalsCalls.length).toBeGreaterThanOrEqual(1)
    const last = vitalsCalls[vitalsCalls.length - 1]
    expect(last.chunkCount).toBeGreaterThanOrEqual(1)
    expect(last.lastChunkAt).toBeGreaterThan(0)

    __setStreamInactivityForTesting(null)
  }, 10_000)
})

// Reasoning Audit Phase R2 — chatOnce now returns BOTH the visible body
// and any chain-of-thought the provider emitted alongside it. These tests
// pin the SDK response-shape contract: both `message.reasoning` and
// `message.reasoning_content` (the two field names different OpenAI-
// compatible APIs use) must be picked up. Without this pin, a future
// refactor could silently drop reasoning at the boundary again.
describe('chatOnce — reasoning channel extraction (R2)', () => {
  it('returns body only when neither reasoning field is set', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: { content: 'plain body' },
          finish_reason: 'stop'
        }
      ]
    })
    const result = await chatOnce(
      [{ role: 'user', content: 'q' }],
      'deepseek-v4-pro'
    )
    expect(result.content).toBe('plain body')
    expect(result.reasoning).toBeUndefined()
  })

  it('extracts reasoning from message.reasoning (OpenRouter shape)', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: 'final answer',
            reasoning: 'I thought through it like this'
          },
          finish_reason: 'stop'
        }
      ]
    })
    const result = await chatOnce(
      [{ role: 'user', content: 'q' }],
      'deepseek-v4-pro'
    )
    expect(result.content).toBe('final answer')
    expect(result.reasoning).toBe('I thought through it like this')
  })

  it('extracts reasoning from message.reasoning_content (DashScope / DeepSeek shape)', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: 'final answer',
            reasoning_content: 'CoT on the other field name'
          },
          finish_reason: 'stop'
        }
      ]
    })
    const result = await chatOnce(
      [{ role: 'user', content: 'q' }],
      'deepseek-v4-pro'
    )
    expect(result.content).toBe('final answer')
    expect(result.reasoning).toBe('CoT on the other field name')
  })

  it('prefers message.reasoning when both fields are populated', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: 'final answer',
            reasoning: 'primary CoT',
            reasoning_content: 'duplicate CoT'
          },
          finish_reason: 'stop'
        }
      ]
    })
    const result = await chatOnce(
      [{ role: 'user', content: 'q' }],
      'deepseek-v4-pro'
    )
    expect(result.reasoning).toBe('primary CoT')
  })

  it('treats whitespace-only reasoning as absent', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: { content: 'body', reasoning: '   \n  ' },
          finish_reason: 'stop'
        }
      ]
    })
    const result = await chatOnce(
      [{ role: 'user', content: 'q' }],
      'deepseek-v4-pro'
    )
    expect(result.reasoning).toBeUndefined()
  })

  it('trims surrounding whitespace from preserved reasoning', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: 'body',
            reasoning: '  actual reasoning  \n'
          },
          finish_reason: 'stop'
        }
      ]
    })
    const result = await chatOnce(
      [{ role: 'user', content: 'q' }],
      'deepseek-v4-pro'
    )
    expect(result.reasoning).toBe('actual reasoning')
  })
})
