// The pipeline runner. Threads a single `ActionContext` through every
// step so an `aggregate` action can leave counters that a later
// `format_template` step picks up. Wraps each step in try/catch — a
// throw inside an action falls back to the previous step's output so
// one bad regex doesn't poison the whole pipeline (Invariant 1: filter
// pipelines never throw upward).

import type { PipelineAction } from './types'
import { applyAction, newActionContext } from './actions'

/**
 * Run a pipeline against `input`. Returns the transformed string. Never
 * throws — on a step failure, returns the result of the previous step.
 */
export function runPipeline(input: string, pipeline: PipelineAction[]): string {
  const ctx = newActionContext()
  let current = input
  for (const step of pipeline) {
    const prev = current
    try {
      const next = applyAction(current, step, ctx)
      // Guard: an action that returns undefined / non-string (which
      // shouldn't happen on the typed union but can from a hand-built
      // fixture) must not corrupt the next step's input.
      current = typeof next === 'string' ? next : prev
    } catch (err) {
      // Log to stderr — main-process console — but never rethrow.
      // The pre-throw `current` is what the next step (if any) sees,
      // which is the same passthrough semantics as `onError: 'passthrough'`.
      console.error('[snip] pipeline action threw, passing through:', err)
      current = prev
    }
  }
  return current
}

/**
 * Rough token estimator. Mirrors snip's and rtk's `len/4` heuristic.
 * Used for the dashboard's "tokens saved" math AND for the Discover
 * panel's "estimated tokens" ranking. Not exact — the harness's real
 * tokenizer disagrees by a few percent — but consistent across before
 * vs. after so the savings ratio is meaningful.
 */
export function estimateTokens(s: string): number {
  if (s.length === 0) return 0
  return Math.ceil(s.length / 4)
}
