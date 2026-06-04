import { describe, expect, it, vi } from 'vitest'
import { join } from 'path'

vi.mock('electron', () => ({
  app: { getPath: () => join(process.cwd(), '.tmp-test-user-data') },
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: true }
}))

import {
  approximateTokenCount,
  buildSubAgentMessages,
  classifyMultiAgentRunResult,
  detectSubAgentToolUseAttempt,
  executeMultiAgentRun,
  MULTI_AGENT_DEFAULT_TIMEOUT_MS,
  MULTI_AGENT_MAX_CONTEXT_BYTES,
  MULTI_AGENT_MAX_TASKS,
  validateMultiAgentArgs,
  type MonotonicClock,
  type SubAgentRunner,
  type SubAgentTask
} from './multi-agent-run-tool'

function makeClockSequence(values: number[]): MonotonicClock {
  let i = 0
  return () => {
    if (i >= values.length) return values[values.length - 1]
    return values[i++]
  }
}

function fixedDelayRunner(delays: Record<string, number>): SubAgentRunner {
  return async (messages, _model, signal) => {
    const role = (() => {
      const sys = messages[0]?.content
      if (typeof sys === 'string') {
        const match = sys.match(/<role>(\w+)<\/role>/)
        if (match) return match[1]
      }
      return 'unknown'
    })()
    const delay = delays[role] ?? 10
    return await new Promise<string>((resolve, reject) => {
      const id = setTimeout(() => resolve(`${role}:ok`), delay)
      signal.addEventListener('abort', () => {
        clearTimeout(id)
        reject(new Error('aborted'))
      })
    })
  }
}

describe('validateMultiAgentArgs', () => {
  it('rejects non-object args', () => {
    expect(() => validateMultiAgentArgs(null)).toThrow(/object/)
    expect(() => validateMultiAgentArgs(7 as unknown)).toThrow(/object/)
  })

  it('rejects empty or missing tasks array', () => {
    expect(() => validateMultiAgentArgs({})).toThrow(/non-empty/)
    expect(() => validateMultiAgentArgs({ tasks: [] })).toThrow(/non-empty/)
  })

  it('rejects more than the max number of tasks', () => {
    const oversized = Array.from({ length: MULTI_AGENT_MAX_TASKS + 1 }, () => ({
      role: 'reader',
      prompt: 'x',
      context: ''
    }))
    expect(() => validateMultiAgentArgs({ tasks: oversized })).toThrow(/too many tasks/)
  })

  it('rejects an unknown role', () => {
    expect(() =>
      validateMultiAgentArgs({ tasks: [{ role: 'genius', prompt: 'go', context: '' }] })
    ).toThrow(/not supported/)
  })

  it('rejects an empty prompt', () => {
    expect(() =>
      validateMultiAgentArgs({ tasks: [{ role: 'reader', prompt: '   ', context: '' }] })
    ).toThrow(/non-empty/)
  })

  it('rejects an oversized context', () => {
    const big = 'a'.repeat(MULTI_AGENT_MAX_CONTEXT_BYTES + 1)
    expect(() =>
      validateMultiAgentArgs({ tasks: [{ role: 'reader', prompt: 'p', context: big }] })
    ).toThrow(/exceeds the/)
  })

  it('accepts a well-formed args object and normalises optional fields', () => {
    const out = validateMultiAgentArgs({
      tasks: [
        { role: 'planner', prompt: 'plan it', context: 'ctx', outputFormat: 'markdown' },
        { role: 'verifier', prompt: 'verify it', context: 'ctx2' }
      ],
      timeoutMs: 5_000
    })
    expect(out.tasks.length).toBe(2)
    expect(out.timeoutMs).toBe(5_000)
    expect(out.tasks[1].outputFormat).toBeUndefined()
  })

  it('ignores modelOverride so sub-agents always use the active chat model', () => {
    const out = validateMultiAgentArgs({
      tasks: [{ role: 'reader', prompt: 'read it', context: '' }],
      modelOverride: 'other-model'
    })
    expect('modelOverride' in out).toBe(false)
  })
})

describe('buildSubAgentMessages', () => {
  it('emits a system + user message with the role-prompt embedded', () => {
    const task: SubAgentTask = {
      role: 'reader',
      prompt: 'Summarise the function',
      context: 'export function foo() {}',
      outputFormat: 'bullet list'
    }
    const msgs = buildSubAgentMessages(task)
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('system')
    expect(String(msgs[0].content)).toContain('<role>reader</role>')
    expect(String(msgs[1].content)).toContain('<context>')
    expect(String(msgs[1].content)).toContain('<output_format>')
    expect(String(msgs[1].content)).toContain('Summarise the function')
  })
})

describe('detectSubAgentToolUseAttempt', () => {
  it('returns false for plain prose', () => {
    expect(detectSubAgentToolUseAttempt('PASS: looks good')).toBe(false)
  })
  it('catches an OpenAI-style tool_calls fragment', () => {
    expect(detectSubAgentToolUseAttempt('{"tool_calls":[{"id":"x"}]}')).toBe(true)
  })
  it('catches an Anthropic-style invoke tag', () => {
    expect(detectSubAgentToolUseAttempt('<invoke name="memory_add">')).toBe(true)
  })
})

describe('approximateTokenCount', () => {
  it('returns 0 for empty input', () => {
    expect(approximateTokenCount('')).toBe(0)
    expect(approximateTokenCount(null)).toBe(0)
  })
  it('approximates roughly 4 chars per token', () => {
    expect(approximateTokenCount('abcdefgh')).toBe(2)
    expect(approximateTokenCount('a')).toBe(1)
  })
})

describe('executeMultiAgentRun', () => {
  it('rejects recursive calls outright', async () => {
    await expect(
      executeMultiAgentRun({
        args: { tasks: [{ role: 'reader', prompt: 'x', context: '' }] },
        defaultModel: 'm',
        runner: async () => 'never',
        insideSubAgent: true
      })
    ).rejects.toThrow(/recursion/)
  })

  it('runs sub-agents concurrently — wall clock matches the slowest task, not the sum', async () => {
    const start = Date.now()
    const out = await executeMultiAgentRun({
      args: {
        tasks: [
          { role: 'planner', prompt: 'p', context: '' },
          { role: 'reader', prompt: 'r', context: '' },
          { role: 'verifier', prompt: 'v', context: '' }
        ]
      },
      defaultModel: 'm',
      runner: fixedDelayRunner({ planner: 80, reader: 80, verifier: 80 })
    })
    const wallClock = Date.now() - start
    expect(out.results.length).toBe(3)
    // Each task sleeps 80ms. Sequential would be ≥240ms; concurrent should be
    // closer to 80ms. Use a generous ceiling so we don't flake on slow CI.
    expect(wallClock).toBeLessThan(220)
  })

  it('keeps result order matched to input order regardless of completion timing', async () => {
    const out = await executeMultiAgentRun({
      args: {
        tasks: [
          { role: 'reader', prompt: 'fast', context: '' },
          { role: 'planner', prompt: 'slow', context: '' },
          { role: 'verifier', prompt: 'fast', context: '' }
        ]
      },
      defaultModel: 'm',
      runner: fixedDelayRunner({ reader: 5, planner: 60, verifier: 5 })
    })
    expect(out.results.map((r) => r.role)).toEqual(['reader', 'planner', 'verifier'])
  })

  it('surfaces a partial failure without taking down the rest of the run', async () => {
    const out = await executeMultiAgentRun({
      args: {
        tasks: [
          { role: 'reader', prompt: 'ok', context: '' },
          { role: 'planner', prompt: 'crash', context: '' }
        ]
      },
      defaultModel: 'm',
      runner: async (messages) => {
        const sys = String(messages[0]?.content ?? '')
        if (sys.includes('<role>planner</role>')) throw new Error('boom')
        return 'reader:ok'
      }
    })
    expect(out.results[0].error).toBeUndefined()
    expect(out.results[0].output).toBe('reader:ok')
    expect(out.results[1].error).toBe('boom')
    expect(out.results[1].output).toBeNull()
  })

  it('marks a timed-out sub-agent and lets the others return', async () => {
    const out = await executeMultiAgentRun({
      args: {
        tasks: [
          { role: 'reader', prompt: 'ok', context: '' },
          { role: 'verifier', prompt: 'slow', context: '' }
        ],
        timeoutMs: 30
      },
      defaultModel: 'm',
      runner: fixedDelayRunner({ reader: 5, verifier: 250 })
    })
    expect(out.results[0].output).toBe('reader:ok')
    expect(out.results[1].error).toMatch(/timed out/)
  })

  it('propagates a parent abort to every in-flight sub-agent', async () => {
    const controller = new AbortController()
    const promise = executeMultiAgentRun({
      args: {
        tasks: [
          { role: 'reader', prompt: 'r', context: '' },
          { role: 'verifier', prompt: 'v', context: '' }
        ]
      },
      defaultModel: 'm',
      parentSignal: controller.signal,
      runner: fixedDelayRunner({ reader: 250, verifier: 250 })
    })
    setTimeout(() => controller.abort(), 30)
    const out = await promise
    expect(out.results.every((r) => r.error !== undefined)).toBe(true)
  })

  it('flags a sub-agent that tried to emit a tool call', async () => {
    const out = await executeMultiAgentRun({
      args: { tasks: [{ role: 'reader', prompt: 'p', context: '' }] },
      defaultModel: 'm',
      runner: async () => '{"tool_calls":[{"id":"x"}]}'
    })
    expect(out.results[0].output).toBeNull()
    expect(out.results[0].error).toMatch(/tool call/)
  })

  it('attaches synthetic call ids that reference the parent id when supplied', async () => {
    const out = await executeMultiAgentRun({
      args: { tasks: [{ role: 'reader', prompt: 'p', context: '' }] },
      defaultModel: 'm',
      parentCallId: 'parent-xyz',
      runner: async () => 'ok'
    })
    expect(out.results[0].callId.startsWith('parent-xyz:')).toBe(true)
  })

  it('uses the supplied clock for total elapsed reporting', async () => {
    const clock = makeClockSequence([100, 100, 130])
    const out = await executeMultiAgentRun({
      args: { tasks: [{ role: 'reader', prompt: 'p', context: '' }] },
      defaultModel: 'm',
      runner: async () => 'ok',
      clock
    })
    expect(out.totalElapsedMs).toBe(30)
  })

  it('routes every sub-agent to the active chat model', async () => {
    let seenModel: string | null = null
    await executeMultiAgentRun({
      args: {
        tasks: [{ role: 'reader', prompt: 'p', context: '' }]
      },
      defaultModel: 'default-model',
      runner: async (_msgs, modelId) => {
        seenModel = modelId
        return 'ok'
      }
    })
    expect(seenModel).toBe('default-model')
  })

  it('falls back to the default timeout when none is supplied', async () => {
    const out = await executeMultiAgentRun({
      args: { tasks: [{ role: 'reader', prompt: 'p', context: '' }] },
      defaultModel: 'm',
      runner: async () => 'ok'
    })
    // Default timeout is large; the call should still succeed quickly. This
    // is mostly a smoke check that the path doesn't reject when timeoutMs is
    // absent.
    expect(out.results[0].output).toBe('ok')
    expect(MULTI_AGENT_DEFAULT_TIMEOUT_MS).toBeGreaterThan(1000)
  })
})

describe('classifyMultiAgentRunResult', () => {
  it('marks the outer tool call as done when every sub-agent returned output', () => {
    expect(
      classifyMultiAgentRunResult({
        results: [
          { role: 'reader', output: 'ok', elapsedMs: 1, callId: 'a' },
          { role: 'verifier', output: 'PASS', elapsedMs: 1, callId: 'b' }
        ],
        totalElapsedMs: 1,
        synthesisNotes: 'ok'
      })
    ).toBe('done')
  })

  it('marks the outer tool call as error when any sub-agent failed', () => {
    expect(
      classifyMultiAgentRunResult({
        results: [
          { role: 'reader', output: 'ok', elapsedMs: 1, callId: 'a' },
          { role: 'verifier', output: null, error: 'timed out', elapsedMs: 1, callId: 'b' }
        ],
        totalElapsedMs: 1,
        synthesisNotes: 'partial'
      })
    ).toBe('error')
  })
})
