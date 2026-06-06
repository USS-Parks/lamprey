import { describe, it, expect } from 'vitest'
import {
  toCsv,
  toMarkdown,
  type ExportInput,
  type StageMetricInput,
  type TurnInput
} from './reasoning-trace-exporter'

function turn(
  id: string,
  role: TurnInput['role'],
  content: string,
  opts: Partial<TurnInput> = {}
): TurnInput {
  return {
    id,
    conversationId: 'conv-A',
    role,
    content,
    timestamp: 1_700_000_000_000,
    ...opts
  }
}

function metric(
  id: string,
  messageId: string,
  stage: StageMetricInput['stage'],
  opts: Partial<StageMetricInput> = {}
): StageMetricInput {
  return {
    id,
    messageId,
    stage,
    model: 'deepseek-v4-pro',
    promptTokens: null,
    completionTokens: 100,
    durationMs: 1000,
    createdAt: 1_700_000_000_000,
    ...opts
  }
}

function basicInput(): ExportInput {
  const u1 = turn('u1', 'user', 'first prompt')
  const a1 = turn('a1', 'assistant', 'first reply', {
    model: 'deepseek-v4-pro',
    reasoning: 'thinking about it'
  })
  return {
    conversationId: 'conv-A',
    conversationTitle: 'Test Convo',
    generatedAt: 1_700_000_001_000,
    turns: [u1, a1],
    stageMetrics: {
      a1: [metric('m1', 'a1', 'single', { completionTokens: 320, durationMs: 4200 })]
    }
  }
}

describe('toMarkdown', () => {
  it('includes a header block with title + conversation + count', () => {
    const out = toMarkdown(basicInput())
    expect(out).toContain('# Lamprey Reasoning Trace')
    expect(out).toContain('Conversation: `conv-A`')
    expect(out).toContain('Title: Test Convo')
    expect(out).toContain('Turns: 2')
  })

  it('emits one ## Turn heading per turn', () => {
    const out = toMarkdown(basicInput())
    expect(out.match(/^## Turn \d+/gm) ?? []).toHaveLength(2)
  })

  it('renders stage subsection with model + tokens + duration', () => {
    const out = toMarkdown(basicInput())
    expect(out).toContain('### Stage: single')
    expect(out).toContain('**Model:** deepseek-v4-pro')
    expect(out).toContain('**Tokens:** – in / 320 out')
    expect(out).toContain('**Duration:** 4200ms')
  })

  it('wraps reasoning + content in fenced blocks', () => {
    const out = toMarkdown(basicInput())
    expect(out).toContain('#### Reasoning')
    expect(out).toContain('thinking about it')
    expect(out).toContain('#### Content')
    expect(out).toContain('first reply')
  })

  it('renders multi-stage on one turn', () => {
    const a1 = turn('a1', 'assistant', 'coder body', { model: 'coder-m' })
    const out = toMarkdown({
      conversationId: 'conv-A',
      generatedAt: 1,
      turns: [a1],
      stageMetrics: {
        a1: [
          metric('m1', 'a1', 'planner', { model: 'planner-m', completionTokens: 50 }),
          metric('m2', 'a1', 'coder', { model: 'coder-m', completionTokens: 200 })
        ]
      }
    })
    expect(out).toContain('### Stage: planner')
    expect(out).toContain('### Stage: coder')
    expect(out.indexOf('### Stage: planner')).toBeLessThan(out.indexOf('### Stage: coder'))
  })

  it('ends with a trailing newline', () => {
    const out = toMarkdown(basicInput())
    expect(out.endsWith('\n')).toBe(true)
  })
})

describe('toCsv', () => {
  it('emits the canonical header row', () => {
    const out = toCsv(basicInput())
    const header = out.split('\n')[0]
    expect(header).toBe(
      'turn_index,stage,role,model,prompt_tokens,completion_tokens,duration_ms,timestamp,content_excerpt,reasoning_excerpt'
    )
  })

  it('emits one row per (turn, stage)', () => {
    const a1 = turn('a1', 'assistant', 'reply', { model: 'm' })
    const out = toCsv({
      conversationId: 'conv-A',
      generatedAt: 1,
      turns: [a1],
      stageMetrics: {
        a1: [
          metric('m1', 'a1', 'planner'),
          metric('m2', 'a1', 'coder'),
          metric('m3', 'a1', 'reviewer')
        ]
      }
    })
    const lines = out.trim().split('\n')
    expect(lines).toHaveLength(4) // header + 3 stage rows
    expect(lines[1]).toContain(',planner,')
    expect(lines[2]).toContain(',coder,')
    expect(lines[3]).toContain(',reviewer,')
  })

  it('emits a synthetic empty-stage row for turns with no metrics', () => {
    const u1 = turn('u1', 'user', 'hi')
    const out = toCsv({
      conversationId: 'conv-A',
      generatedAt: 1,
      turns: [u1],
      stageMetrics: {}
    })
    const lines = out.trim().split('\n')
    expect(lines).toHaveLength(2) // header + 1 synthetic row
    // stage cell is empty when there's no metric
    expect(lines[1].startsWith('0,,user,')).toBe(true)
  })

  it('CSV-escapes commas, quotes, and newlines in excerpts', () => {
    const a1 = turn('a1', 'assistant', 'has, a "comma" and\nnewline', { model: 'm' })
    const out = toCsv({
      conversationId: 'conv-A',
      generatedAt: 1,
      turns: [a1],
      stageMetrics: { a1: [metric('m1', 'a1', 'single')] }
    })
    const rows = out.split('\n')
    const row = rows[1]
    // Should contain a quoted, escaped excerpt — quotes doubled, no raw newline in cell
    expect(row).toMatch(/"has, a ""comma"" and newline"/)
    // The CSV should still split cleanly on row boundary (one body row only).
    expect(rows.filter((r) => r.length > 0)).toHaveLength(2)
  })

  it('truncates excerpts past 200 chars with an ellipsis', () => {
    const long = 'x'.repeat(500)
    const a1 = turn('a1', 'assistant', long, { model: 'm' })
    const out = toCsv({
      conversationId: 'conv-A',
      generatedAt: 1,
      turns: [a1],
      stageMetrics: { a1: [metric('m1', 'a1', 'single')] }
    })
    const row = out.split('\n')[1]
    // Excerpt cell is the 9th column (0-indexed 8). Just confirm an ellipsis
    // landed in the row and the row is not 500+ chars from the body alone.
    expect(row).toContain('…')
    expect(row.length).toBeLessThan(long.length)
  })

  it('ends with a trailing newline', () => {
    const out = toCsv(basicInput())
    expect(out.endsWith('\n')).toBe(true)
  })
})
