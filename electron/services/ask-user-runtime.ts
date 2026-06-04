import { randomUUID } from 'crypto'

// H6 — Ask-user runtime.
//
// Holds a Map<requestId, pending entry> so a subagent / workflow / native tool
// handler can `await` a structured answer from the renderer. The renderer
// surfaces a modal (AskUserModal.tsx) when an `ask-user:awaiting` event fires
// and posts the user's selection back via `ask-user:respond`. A default 30s
// timeout (overridable per-call, never longer than the cap) resolves with
// `null` so a non-interactive run never deadlocks.
//
// Pure module — no electron coupling. The IPC bridge wraps it; tests inject a
// fake bus. Same pattern subagent-runner.ts uses.

export const ASK_USER_DEFAULT_TIMEOUT_MS = 30_000
export const ASK_USER_MAX_TIMEOUT_MS = 10 * 60_000

export interface AskUserOption {
  label: string
  description?: string
  /** Optional markdown preview shown when the option is focused. */
  preview?: string
}

export interface AskUserQuestion {
  question: string
  /** Short chip label, max 12 chars per parity plan. */
  header: string
  options: AskUserOption[]
  multiSelect?: boolean
  /** Caller-supplied timeout in ms. Clamped to ASK_USER_MAX_TIMEOUT_MS. */
  timeoutMs?: number
}

export interface AskUserAwaitingEvent {
  requestId: string
  question: string
  header: string
  options: AskUserOption[]
  multiSelect: boolean
  timeoutMs: number
  askedAt: number
}

/** Renderer-supplied answer payload. `label` mirrors the chosen option's label
 *  (or labels[] when `multiSelect`). `null` is the timeout/cancel sentinel. */
export type AskUserAnswer =
  | { kind: 'single'; label: string; header: string; notes?: string }
  | { kind: 'multi'; labels: string[]; header: string; notes?: string }
  | { kind: 'cancelled' }
  | { kind: 'timeout' }

export interface AskUserRuntimeDeps {
  emit: (event: AskUserAwaitingEvent) => void
  /** Test seam — defaults to Date.now() and setTimeout. */
  clock?: () => number
  schedule?: (cb: () => void, ms: number) => { cancel: () => void }
  genId?: () => string
}

interface PendingEntry {
  requestId: string
  question: string
  header: string
  resolve: (answer: AskUserAnswer) => void
  cancelTimer: () => void
  askedAt: number
}

export class AskUserRuntime {
  private pending = new Map<string, PendingEntry>()

  constructor(private deps: AskUserRuntimeDeps) {}

  /** Number of in-flight asks. Used by tests + the renderer to refuse stacking. */
  size(): number {
    return this.pending.size
  }

  list(): Array<{ requestId: string; question: string; header: string; askedAt: number }> {
    return Array.from(this.pending.values()).map((e) => ({
      requestId: e.requestId,
      question: e.question,
      header: e.header,
      askedAt: e.askedAt
    }))
  }

  /** Spawn a question, emit `ask-user:awaiting`, return a promise. */
  ask(input: AskUserQuestion): Promise<AskUserAnswer> {
    if (typeof input.question !== 'string' || !input.question.trim()) {
      return Promise.reject(new TypeError('askUser: question must be a non-empty string'))
    }
    if (typeof input.header !== 'string' || !input.header.trim()) {
      return Promise.reject(new TypeError('askUser: header must be a non-empty string'))
    }
    if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 4) {
      return Promise.reject(new TypeError('askUser: options must have between 2 and 4 entries'))
    }
    for (const opt of input.options) {
      if (!opt || typeof opt.label !== 'string' || !opt.label.trim()) {
        return Promise.reject(new TypeError('askUser: each option needs a non-empty label'))
      }
    }

    const genId = this.deps.genId ?? randomUUID
    const clock = this.deps.clock ?? (() => Date.now())
    const schedule =
      this.deps.schedule ??
      ((cb, ms) => {
        const t = setTimeout(cb, ms)
        return { cancel: () => clearTimeout(t) }
      })

    const requestId = genId()
    const timeoutMs = Math.min(
      Math.max(1000, input.timeoutMs ?? ASK_USER_DEFAULT_TIMEOUT_MS),
      ASK_USER_MAX_TIMEOUT_MS
    )
    const askedAt = clock()

    return new Promise<AskUserAnswer>((resolve) => {
      const timer = schedule(() => {
        const entry = this.pending.get(requestId)
        if (!entry) return
        this.pending.delete(requestId)
        entry.resolve({ kind: 'timeout' })
      }, timeoutMs)

      this.pending.set(requestId, {
        requestId,
        question: input.question,
        header: input.header,
        resolve,
        cancelTimer: timer.cancel,
        askedAt
      })

      this.deps.emit({
        requestId,
        question: input.question,
        header: input.header,
        options: input.options,
        multiSelect: !!input.multiSelect,
        timeoutMs,
        askedAt
      })
    })
  }

  /** Renderer posts a response. Returns true if the entry was matched. */
  respond(requestId: string, answer: AskUserAnswer): boolean {
    const entry = this.pending.get(requestId)
    if (!entry) return false
    entry.cancelTimer()
    this.pending.delete(requestId)
    entry.resolve(answer)
    return true
  }

  /** Bulk-resolve every pending entry with `{kind: 'cancelled'}`. Called on
   *  conversation abort and renderer teardown so awaiting workflows do not
   *  leak. */
  cancelAll(): number {
    const ids = Array.from(this.pending.keys())
    for (const id of ids) {
      const entry = this.pending.get(id)
      if (!entry) continue
      entry.cancelTimer()
      this.pending.delete(id)
      entry.resolve({ kind: 'cancelled' })
    }
    return ids.length
  }
}

let runtimeSingleton: AskUserRuntime | null = null

/** Production singleton. Wired in `electron/ipc/ask-user.ts` after the
 *  webContents emitter is available. Tests instantiate their own. */
export function setAskUserRuntime(runtime: AskUserRuntime): void {
  runtimeSingleton = runtime
}

export function getAskUserRuntime(): AskUserRuntime | null {
  return runtimeSingleton
}
