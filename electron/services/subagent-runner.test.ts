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
  forkAgent,
  resolveAllowedTools,
  validateAgainstSchema,
  buildForkAgentMessages,
  SubagentSchemaError,
  SubagentTypeNotFoundError,
  SubagentAbortError,
  SubagentContextTooLargeError,
  SUBAGENT_MAX_CONTEXT_BYTES,
  SUBAGENT_SCHEMA_TOOL_NAME,
  type ForkAgentDeps,
  type ForkAgentRunner,
  type SubagentTypeResolver
} from './subagent-runner'
import { BUILT_IN_SUBAGENT_TYPES, type SubagentTypeDef } from './subagent-types'

// -- Helpers --------------------------------------------------------------

function makeDeps(overrides: Partial<ForkAgentDeps> & { runner: ForkAgentRunner }): ForkAgentDeps {
  return {
    defaultModel: 'test-model',
    ...overrides
  }
}

function builtinResolver(): SubagentTypeResolver {
  return (name) =>
    Object.prototype.hasOwnProperty.call(BUILT_IN_SUBAGENT_TYPES, name)
      ? BUILT_IN_SUBAGENT_TYPES[name]
      : null
}

// -- resolveAllowedTools --------------------------------------------------

describe('resolveAllowedTools', () => {
  it('returns the intersection of all named layers', () => {
    expect(resolveAllowedTools(['a', 'b', 'c'], ['a', 'b'], ['b', 'c'])).toEqual(['b'])
  })

  it("treats '*' on the type layer as 'no narrowing'", () => {
    expect(resolveAllowedTools(['a', 'b', 'c'], '*', ['a', 'b'])).toEqual(['a', 'b'])
  })

  it("treats '*' on the override layer as 'no narrowing'", () => {
    expect(resolveAllowedTools(['a', 'b', 'c'], ['a', 'b'], '*')).toEqual(['a', 'b'])
  })

  it("returns the parent's full list when every layer is '*'", () => {
    expect(resolveAllowedTools(['a', 'b'], '*', '*')).toEqual(['a', 'b'])
  })

  it('returns [] when intersection is empty', () => {
    expect(resolveAllowedTools(['a'], ['b'], undefined)).toEqual([])
  })

  it('returns sorted output deterministically', () => {
    expect(resolveAllowedTools(null, ['z', 'a', 'm'], undefined)).toEqual(['a', 'm', 'z'])
  })

  it('returns [] when parent is null and every layer is wildcard', () => {
    expect(resolveAllowedTools(null, '*', '*')).toEqual([])
  })
})

// -- buildForkAgentMessages ----------------------------------------------

describe('buildForkAgentMessages', () => {
  it('places the type system prompt in the system message and the user prompt in the user message', () => {
    const msgs = buildForkAgentMessages(BUILT_IN_SUBAGENT_TYPES.Explore, {
      prompt: 'find foo',
      agentType: 'Explore'
    })
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('system')
    expect(String(msgs[0].content)).toMatch(/Explore agent/i)
    expect(msgs[1].role).toBe('user')
    expect(String(msgs[1].content)).toBe('find foo')
  })

  it('injects context + outputFormat when provided', () => {
    const msgs = buildForkAgentMessages(BUILT_IN_SUBAGENT_TYPES.Explore, {
      prompt: 'go',
      agentType: 'Explore',
      context: 'CTX',
      outputFormat: 'FMT'
    })
    const user = String(msgs[1].content)
    expect(user).toMatch(/<context>\nCTX\n<\/context>/)
    expect(user).toMatch(/<output_format>\nFMT\n<\/output_format>/)
  })

  it('appends a schema instruction to the system prompt when schema is set', () => {
    const msgs = buildForkAgentMessages(BUILT_IN_SUBAGENT_TYPES.Explore, {
      prompt: 'go',
      agentType: 'Explore',
      schema: { type: 'object', properties: { found: { type: 'array' } }, required: ['found'] }
    })
    const sys = String(msgs[0].content)
    expect(sys).toMatch(/JSON object/)
    expect(sys).toMatch(SUBAGENT_SCHEMA_TOOL_NAME)
    expect(sys).toMatch(/<schema>/)
    expect(sys).toMatch(/"required":/)
  })
})

// -- validateAgainstSchema -----------------------------------------------

describe('validateAgainstSchema', () => {
  it('accepts an object with required keys present', () => {
    expect(() =>
      validateAgainstSchema(
        { found: ['x'] },
        { type: 'object', properties: { found: { type: 'array' } }, required: ['found'] }
      )
    ).not.toThrow()
  })

  it('throws when a required key is missing', () => {
    expect(() =>
      validateAgainstSchema(
        {},
        { type: 'object', properties: { found: { type: 'array' } }, required: ['found'] }
      )
    ).toThrow(SubagentSchemaError)
  })

  it('throws when the declared type is array but the value is not', () => {
    expect(() => validateAgainstSchema({ x: 1 }, { type: 'array' })).toThrow(SubagentSchemaError)
  })

  it('checks declared property types when present', () => {
    expect(() =>
      validateAgainstSchema(
        { count: 'not-a-number' },
        { type: 'object', properties: { count: { type: 'number' } } }
      )
    ).toThrow(/should be number/)
  })

  it('treats integer as a number with Number.isInteger', () => {
    expect(() =>
      validateAgainstSchema({ n: 3 }, { type: 'object', properties: { n: { type: 'integer' } } })
    ).not.toThrow()
    expect(() =>
      validateAgainstSchema({ n: 3.5 }, { type: 'object', properties: { n: { type: 'integer' } } })
    ).toThrow(/integer/)
  })
})

// -- forkAgent — happy paths ---------------------------------------------

describe('forkAgent — happy paths', () => {
  it('forks Explore with a tool subset and returns a raw string result', async () => {
    let seenInput: { allowedTools: unknown; modelId: string } | null = null
    const runner: ForkAgentRunner = async (input) => {
      seenInput = { allowedTools: input.allowedTools, modelId: input.modelId }
      return 'foo lives at src/foo.ts:12'
    }
    const handle = forkAgent(
      { prompt: 'where is foo?', agentType: 'Explore' },
      makeDeps({ runner, loadType: builtinResolver() })
    )
    const result = await handle.promise
    expect(result.runId).toBeTruthy()
    expect(typeof result.output).toBe('string')
    expect(result.output).toBe('foo lives at src/foo.ts:12')
    expect(result.rawOutput).toBe('foo lives at src/foo.ts:12')
    expect(seenInput).not.toBeNull()
    expect(seenInput!.modelId).toBe('test-model')
    // Explore's allowedTools sorted alphabetically.
    expect(seenInput!.allowedTools).toEqual(
      [...BUILT_IN_SUBAGENT_TYPES.Explore.allowedTools as string[]].sort()
    )
  })

  it('forks with a schema and returns a parsed, validated object', async () => {
    const runner: ForkAgentRunner = async () =>
      JSON.stringify({ found: ['a.ts', 'b.ts'], count: 2 })
    const handle = forkAgent(
      {
        prompt: 'find foo files',
        agentType: 'Explore',
        schema: {
          type: 'object',
          properties: { found: { type: 'array' }, count: { type: 'integer' } },
          required: ['found']
        }
      },
      makeDeps({ runner, loadType: builtinResolver() })
    )
    const result = await handle.promise
    expect(result.output).toEqual({ found: ['a.ts', 'b.ts'], count: 2 })
    // rawOutput preserves the original string for journaling/resume use.
    expect(result.rawOutput).toContain('"found"')
  })

  it("doesn't expose the parent's added tool to the child if the type doesn't allow it", async () => {
    let observedAllowed: string[] | '*' = '*'
    const runner: ForkAgentRunner = async (input) => {
      observedAllowed = input.allowedTools
      return 'ok'
    }
    // Parent has a tool that's NOT in Explore's allowedTools — should not leak.
    const parentTools = ['read_file', 'grep_search', 'glob_search', 'shell_command', 'apply_patch']
    const handle = forkAgent(
      { prompt: 'go', agentType: 'Explore' },
      makeDeps({
        runner,
        loadType: builtinResolver(),
        parentTools: { listTools: () => parentTools }
      })
    )
    await handle.promise
    expect(observedAllowed).not.toContain('apply_patch')
    expect(observedAllowed).toContain('read_file')
    expect(observedAllowed).toContain('grep_search')
  })

  it('honours a user-registered subagent type by name', async () => {
    let observedSystem = ''
    let observedAllowed: string[] | '*' = '*'
    const custom: SubagentTypeDef = {
      name: 'security-auditor',
      description: 'Adversarial security auditor',
      allowedTools: ['read_file', 'grep_search'],
      systemPrompt: 'You are the Security Auditor. Flag injection bugs.',
      source: '/tmp/security-auditor.md'
    }
    const loadType: SubagentTypeResolver = (name) =>
      name === custom.name ? custom : builtinResolver()(name)
    const runner: ForkAgentRunner = async (input) => {
      observedSystem = String(input.messages[0]?.content ?? '')
      observedAllowed = input.allowedTools
      return 'audited; SHIP'
    }
    const handle = forkAgent(
      { prompt: 'audit src/auth.ts', agentType: 'security-auditor' },
      makeDeps({ runner, loadType })
    )
    const result = await handle.promise
    expect(result.output).toBe('audited; SHIP')
    expect(observedSystem).toContain('Security Auditor')
    expect(observedAllowed).toEqual(['grep_search', 'read_file'])
  })
})

// -- forkAgent — error paths ---------------------------------------------

describe('forkAgent — error paths', () => {
  it('throws SubagentTypeNotFoundError for an unknown agent type', async () => {
    const handle = forkAgent(
      { prompt: 'x', agentType: 'no-such-type' },
      makeDeps({ runner: async () => 'never', loadType: () => null })
    )
    await expect(handle.promise).rejects.toBeInstanceOf(SubagentTypeNotFoundError)
  })

  it('throws SubagentContextTooLargeError when context overflows', async () => {
    const handle = forkAgent(
      {
        prompt: 'x',
        agentType: 'Explore',
        context: 'a'.repeat(SUBAGENT_MAX_CONTEXT_BYTES + 1)
      },
      makeDeps({ runner: async () => 'never', loadType: builtinResolver() })
    )
    await expect(handle.promise).rejects.toBeInstanceOf(SubagentContextTooLargeError)
  })

  it('throws SubagentSchemaError when the response is unparseable JSON', async () => {
    const handle = forkAgent(
      {
        prompt: 'go',
        agentType: 'Explore',
        schema: { type: 'object', required: ['x'] }
      },
      makeDeps({
        runner: async () => 'not-json-at-all',
        loadType: builtinResolver()
      })
    )
    await expect(handle.promise).rejects.toBeInstanceOf(SubagentSchemaError)
  })

  it('throws SubagentSchemaError when the parsed object misses a required key', async () => {
    const handle = forkAgent(
      {
        prompt: 'go',
        agentType: 'Explore',
        schema: { type: 'object', required: ['found'] }
      },
      makeDeps({
        runner: async () => JSON.stringify({ other: 1 }),
        loadType: builtinResolver()
      })
    )
    await expect(handle.promise).rejects.toThrow(/found/)
  })

  it('aborts when the parent signal fires', async () => {
    const controller = new AbortController()
    const runner: ForkAgentRunner = (input) =>
      new Promise<string>((_resolve, reject) => {
        input.signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    const handle = forkAgent(
      { prompt: 'x', agentType: 'Explore', signal: controller.signal },
      makeDeps({ runner, loadType: builtinResolver() })
    )
    setTimeout(() => controller.abort(), 10)
    await expect(handle.promise).rejects.toBeInstanceOf(SubagentAbortError)
  })

  it('aborts on timeout', async () => {
    const runner: ForkAgentRunner = (input) =>
      new Promise<string>((_resolve, reject) => {
        input.signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    const handle = forkAgent(
      { prompt: 'x', agentType: 'Explore', timeoutMs: 20 },
      makeDeps({ runner, loadType: builtinResolver() })
    )
    await expect(handle.promise).rejects.toMatchObject({ message: /timed out after 20 ms/ })
  })

  it('handle.abort() rejects an in-flight fork with SubagentAbortError', async () => {
    const runner: ForkAgentRunner = (input) =>
      new Promise<string>((_resolve, reject) => {
        input.signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    const handle = forkAgent(
      { prompt: 'x', agentType: 'Explore' },
      makeDeps({ runner, loadType: builtinResolver() })
    )
    setTimeout(() => handle.abort('user-cancelled'), 10)
    await expect(handle.promise).rejects.toBeInstanceOf(SubagentAbortError)
  })
})
