import { createHash } from 'crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync
} from 'fs'
import { dirname, join } from 'path'

// Workflow journal — append-only JSONL per run. Each agent() call produces
// one record so a re-run with `resumeFromRunId` can replay the longest
// unchanged prefix from cache.
//
// One record per line; first line is a `meta` record carrying the script
// hash + start timestamp; subsequent lines are `agent` records.
//
// Path convention: `<journalDir>/<runId>.jsonl`. Production sets
// `journalDir` to `userData/workflows/runs/`; tests pass a temp dir.

export interface MetaJournalRecord {
  type: 'meta'
  runId: string
  metaName: string
  argsHash: string
  startedAt: number
}

export interface AgentJournalRecord {
  type: 'agent'
  seq: number
  promptHash: string
  optsHash: string
  label?: string
  phase?: string
  agentType: string
  startedAt: number
  finishedAt: number
  // The serialised result (string for raw, JSON.stringify-able for objects).
  // Stored as a string so reads don't re-parse non-JSON results.
  resultJson: string
  rawOutput: string
  tokensUsedEstimate: number
}

export interface FinishJournalRecord {
  type: 'finished' | 'errored' | 'aborted'
  finishedAt: number
  agentCount: number
  // For errored/aborted, the error message; for finished, the JSON-encoded output.
  payload: string
}

export type JournalRecord = MetaJournalRecord | AgentJournalRecord | FinishJournalRecord

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

/** Stable JSON: keys sorted recursively, no whitespace. `undefined` is
 *  serialised as the literal string `undefined` so callers can hash absent
 *  values deterministically (JSON.stringify(undefined) returns undefined). */
export function stableStringify(v: unknown): string {
  if (v === undefined) return 'undefined'
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'undefined'
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x)).join(',')}]`
  const obj = v as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`
}

export function hashPrompt(prompt: string): string {
  return sha256(prompt)
}

export function hashOpts(opts: unknown): string {
  return sha256(stableStringify(opts))
}

export function journalPathFor(runId: string, journalDir: string): string {
  return join(journalDir, `${runId}.jsonl`)
}

export function ensureJournalDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export function appendJournalRecord(path: string, record: JournalRecord): void {
  ensureJournalDir(dirname(path))
  appendFileSync(path, JSON.stringify(record) + '\n', { encoding: 'utf-8' })
}

/** Read all records from the journal. Returns `[]` if the file doesn't exist. */
export function readJournal(path: string): JournalRecord[] {
  if (!existsSync(path)) return []
  const raw = readFileSync(path, 'utf-8')
  const out: JournalRecord[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed) as JournalRecord)
    } catch (err) {
      console.warn('[workflow-journal] skipped malformed line:', err)
    }
  }
  return out
}

/**
 * Extract just the agent records, sorted by seq. Useful for replay.
 */
export function readAgentRecords(path: string): AgentJournalRecord[] {
  const records = readJournal(path)
  return records
    .filter((r): r is AgentJournalRecord => r.type === 'agent')
    .sort((a, b) => a.seq - b.seq)
}
