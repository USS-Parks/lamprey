import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  appendJournalRecord,
  hashOpts,
  hashPrompt,
  journalPathFor,
  readAgentRecords,
  readJournal,
  sha256,
  stableStringify,
  type AgentJournalRecord
} from './workflow-journal'

let workdir: string

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'lamprey-wf-journal-'))
})

afterEach(() => {
  try {
    rmSync(workdir, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

describe('sha256 + hashPrompt + hashOpts', () => {
  it('produces a 64-char hex digest', () => {
    const h = sha256('hello')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('hashPrompt is content-addressable', () => {
    expect(hashPrompt('find foo')).toBe(hashPrompt('find foo'))
    expect(hashPrompt('find foo')).not.toBe(hashPrompt('find bar'))
  })

  it('hashOpts is order-insensitive (stable JSON keys)', () => {
    const a = { schema: { type: 'object' }, model: 'm1', label: 'L' }
    const b = { label: 'L', model: 'm1', schema: { type: 'object' } }
    expect(hashOpts(a)).toBe(hashOpts(b))
  })
})

describe('stableStringify', () => {
  it('sorts object keys recursively', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
    expect(stableStringify({ b: { y: 1, x: 2 }, a: 0 })).toBe('{"a":0,"b":{"x":2,"y":1}}')
  })

  it('preserves array order', () => {
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]')
  })

  it('handles primitives + null', () => {
    expect(stableStringify(null)).toBe('null')
    expect(stableStringify(42)).toBe('42')
    expect(stableStringify('x')).toBe('"x"')
    expect(stableStringify(true)).toBe('true')
  })
})

describe('appendJournalRecord + readJournal', () => {
  it('round-trips a single record', () => {
    const path = join(workdir, 'r1.jsonl')
    appendJournalRecord(path, {
      type: 'meta',
      runId: 'r1',
      metaName: 'test',
      argsHash: 'x',
      startedAt: 100
    })
    const records = readJournal(path)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ type: 'meta', metaName: 'test' })
  })

  it('appends multiple records preserving order', () => {
    const path = join(workdir, 'r1.jsonl')
    const a: AgentJournalRecord = {
      type: 'agent',
      seq: 0,
      promptHash: 'pA',
      optsHash: 'oA',
      agentType: 'Explore',
      startedAt: 100,
      finishedAt: 200,
      resultJson: '"a"',
      rawOutput: 'a',
      tokensUsedEstimate: 1
    }
    const b: AgentJournalRecord = { ...a, seq: 1, promptHash: 'pB' }
    appendJournalRecord(path, a)
    appendJournalRecord(path, b)
    const out = readAgentRecords(path)
    expect(out.map((r) => r.seq)).toEqual([0, 1])
    expect(out[1].promptHash).toBe('pB')
  })

  it('returns [] when the file is missing', () => {
    expect(readJournal(join(workdir, 'missing.jsonl'))).toEqual([])
    expect(readAgentRecords(join(workdir, 'missing.jsonl'))).toEqual([])
  })

  it('skips malformed lines without throwing', () => {
    const path = join(workdir, 'malformed.jsonl')
    writeFileSync(
      path,
      `{"type":"meta","runId":"r","metaName":"x","argsHash":"a","startedAt":1}\nnot json\n{"type":"meta","runId":"r2","metaName":"y","argsHash":"a","startedAt":2}\n`,
      'utf-8'
    )
    const records = readJournal(path)
    expect(records).toHaveLength(2)
  })

  it('creates the directory on first append', () => {
    const path = join(workdir, 'nested', 'deep', 'r1.jsonl')
    appendJournalRecord(path, {
      type: 'meta',
      runId: 'r1',
      metaName: 'x',
      argsHash: 'a',
      startedAt: 1
    })
    expect(existsSync(path)).toBe(true)
  })
})

describe('journalPathFor', () => {
  it('joins runId + dir with .jsonl extension', () => {
    expect(journalPathFor('abc-123', '/wf')).toBe(join('/wf', 'abc-123.jsonl'))
  })
})
