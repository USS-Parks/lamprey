import { describe, expect, it } from 'vitest'
import {
  COMPOSER_DRAFT_CAP,
  COMPOSER_TOOL_RESULT_CAP,
  MAX_REASONING_BYTES,
  buildComposerPrompt,
  composeFinalResponse,
  concatReasoningTrail,
  shouldComposeFinalResponse,
  summarizeRun,
  truncateForComposer
} from './final-response-composer'
import type { LampreyToolCall } from './tool-registry'
import type { PlanSnapshot } from './plan-goal-store'

function call(overrides: Partial<LampreyToolCall>): LampreyToolCall {
  return {
    id: overrides.id ?? 'call-1',
    toolId: overrides.toolId ?? 'shell_command',
    name: overrides.name ?? 'shell_command',
    conversationId: 'conv-1',
    args: {},
    startedAt: overrides.startedAt ?? 10,
    status: overrides.status ?? 'done',
    result: overrides.result,
    error: overrides.error
  }
}

describe('shouldComposeFinalResponse', () => {
  it('skips pure chat turns and composes post-tool turns', () => {
    expect(shouldComposeFinalResponse(0)).toBe(false)
    expect(shouldComposeFinalResponse(1)).toBe(true)
  })
})

describe('summarizeRun', () => {
  it('extracts the latest user goal and includes a non-empty plan snapshot', () => {
    const plan: PlanSnapshot = {
      conversationId: 'conv-1',
      steps: [
        { id: 's1', text: 'Read the file', status: 'done' },
        { id: 's2', text: 'Run tests', status: 'pending' }
      ],
      totals: { pending: 1, in_progress: 0, done: 1, total: 2 }
    }
    const summary = summarizeRun(
      [
        { role: 'user', content: 'older' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'ship it' }
      ],
      plan,
      [],
      'draft'
    )
    expect(summary.userGoal).toBe('ship it')
    expect(summary.plan?.steps.map((s) => s.text)).toEqual(['Read the file', 'Run tests'])
  })

  it('maps audit statuses to PASS, FAIL, and SKIPPED in chronological order', () => {
    const summary = summarizeRun(
      [{ role: 'user', content: 'go' }],
      null,
      [
        call({ id: 'b', name: 'second', status: 'error', error: 'boom', startedAt: 20 }),
        call({ id: 'a', name: 'first', status: 'done', result: 'ok', startedAt: 10 }),
        call({ id: 'c', name: 'third', status: 'denied', startedAt: 30 })
      ],
      'draft'
    )
    expect(summary.toolCalls.map((c) => `${c.name}:${c.status}`)).toEqual([
      'first:PASS',
      'second:FAIL',
      'third:SKIPPED'
    ])
    expect(summary.toolCalls[2].statusDetail).toBe('denied')
  })

  it('caps long draft and tool result previews', () => {
    const summary = summarizeRun(
      [{ role: 'user', content: 'go' }],
      null,
      [call({ result: 'r'.repeat(COMPOSER_TOOL_RESULT_CAP + 100) })],
      'd'.repeat(COMPOSER_DRAFT_CAP + 100)
    )
    expect(summary.draftReply.length).toBeLessThanOrEqual(COMPOSER_DRAFT_CAP + 24)
    expect(summary.draftReply).toContain('[truncated for composer]')
    expect(summary.toolCalls[0].resultPreview?.length).toBeLessThanOrEqual(
      COMPOSER_TOOL_RESULT_CAP + 24
    )
    expect(summary.toolCalls[0].resultPreview).toContain('[truncated for composer]')
  })
})

describe('buildComposerPrompt', () => {
  it('carries the section template in system and plan plus audit in user', () => {
    const prompt = buildComposerPrompt({
      userGoal: 'fix the thing',
      plan: {
        steps: [{ text: 'Run check', status: 'done' }],
        totals: { done: 1, total: 1 }
      },
      toolCalls: [
        {
          id: 'tc-1',
          toolId: 'verify_workspace',
          name: 'verify_workspace',
          status: 'PASS',
          resultPreview: 'tests passed'
        }
      ],
      draftReply: 'Done'
    })
    expect(prompt.system).toContain('## What I did')
    expect(prompt.system).toContain("## What's left")
    expect(prompt.user).toContain('fix the thing')
    expect(prompt.user).toContain('Run check')
    expect(prompt.user).toContain('PASS: verify_workspace')
    expect(prompt.user).toContain('tests passed')
  })
})

describe('composeFinalResponse', () => {
  it('passes composer messages to the supplied runner and trims the reply', async () => {
    const seen: string[] = []
    const out = await composeFinalResponse({
      model: 'model-a',
      summary: {
        userGoal: 'goal',
        toolCalls: [],
        draftReply: 'draft'
      },
      runner: async (messages, model) => {
        seen.push(model)
        seen.push(String(messages[0].content))
        seen.push(String(messages[1].content))
        return { content: '  composed  ' }
      }
    })
    expect(out.content).toBe('composed')
    expect(out.reasoning).toBeUndefined()
    expect(seen[0]).toBe('model-a')
    expect(seen[1]).toContain('final-response composer')
    expect(seen[2]).toContain('Model draft reply')
  })

  // R2 — composer's own reasoning is preserved on the result so R6 can
  // fold it into the cumulative round-trail. Trim happens on content
  // only; reasoning is passed through as-supplied by chatOnce (which
  // already trimmed it at the SDK boundary).
  it('preserves composer reasoning on the result', async () => {
    const out = await composeFinalResponse({
      model: 'model-b',
      summary: { userGoal: 'goal', toolCalls: [], draftReply: 'draft' },
      runner: async () => ({
        content: 'composed body',
        reasoning: 'rewrote the draft to lead with the answer'
      })
    })
    expect(out.content).toBe('composed body')
    expect(out.reasoning).toBe('rewrote the draft to lead with the answer')
  })
})

describe('truncateForComposer', () => {
  it('leaves short strings unchanged', () => {
    expect(truncateForComposer('abc', 10)).toBe('abc')
  })
})

// Reasoning Audit Phase R6 — cumulative per-round reasoning concat helper.
describe('concatReasoningTrail', () => {
  it('returns undefined when no rounds and no composer reasoning', () => {
    expect(concatReasoningTrail([], undefined)).toBeUndefined()
    expect(concatReasoningTrail([undefined, undefined], undefined)).toBeUndefined()
    expect(concatReasoningTrail(['', '  ', ''], undefined)).toBeUndefined()
  })

  it('emits a single round with no composer section', () => {
    const out = concatReasoningTrail(['thought A'], undefined)
    expect(out).toBe('--- round 1 ---\nthought A')
  })

  it('renumbers surviving rounds when some are empty / undefined', () => {
    const out = concatReasoningTrail(
      ['thought A', undefined, '', 'thought B'],
      undefined
    )
    // Empty entries skipped BEFORE numbering; surviving rounds renumbered.
    expect(out).toBe(
      '--- round 1 ---\nthought A\n\n--- round 2 ---\nthought B'
    )
  })

  it('appends composer section at the bottom with the same separator', () => {
    const out = concatReasoningTrail(
      ['round-A thought', 'round-B thought'],
      'composer rewrote it'
    )
    expect(out).toBe(
      '--- round 1 ---\nround-A thought' +
        '\n\n--- round 2 ---\nround-B thought' +
        '\n\n--- composer ---\ncomposer rewrote it'
    )
  })

  it('emits only the composer section when no rounds have reasoning', () => {
    const out = concatReasoningTrail([undefined, ''], 'composer alone')
    expect(out).toBe('--- composer ---\ncomposer alone')
  })

  it('truncates with an honest marker when over MAX_REASONING_BYTES', () => {
    // Build a single round that on its own is bigger than the cap so the
    // truncation path is hit deterministically.
    const oversized = 'x'.repeat(MAX_REASONING_BYTES + 5_000)
    const out = concatReasoningTrail([oversized], undefined)
    expect(out).toBeDefined()
    expect(out!.length).toBeLessThanOrEqual(MAX_REASONING_BYTES)
    // Honest marker present, with a kb-count >= 1.
    expect(out).toMatch(/\[truncated for length — \d+ kb omitted\]$/)
    // The pre-truncation prefix made it in.
    expect(out!.startsWith('--- round 1 ---\nxxx')).toBe(true)
  })
})
