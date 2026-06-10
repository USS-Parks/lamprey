// CR-3 (Cogency Restore Phase, 2026-06-09) — in-memory ring buffer of the
// most recent router decisions. Surfaced via IPC for the /debug view so a
// user diagnosing a mis-route ("why did my prompt go multi?") can read the
// matched rule directly instead of speculating.
//
// Decisions are NOT persisted to disk — they are session-scoped (cleared on
// app restart). This is deliberate: the ring buffer is a diagnostic tool,
// not an audit trail. The chat-level structured event log (event-log.ts)
// keeps the historical record.

import type { RouterMatchedRule } from './agent-router'
import { createHash } from 'node:crypto'

export interface RouterDecisionTelemetryEntry {
  /** First 8 chars of sha256(promptText). Scrubbable, but identifies
   *  repeated identical prompts in the buffer. */
  promptHash: string
  /** Length of the original prompt in characters (before any flag strip). */
  promptLength: number
  /** Dispatch path chosen. */
  route: 'single' | 'multi'
  /** Machine-readable rule id from the router. */
  matchedRule: RouterMatchedRule
  /** Human-readable reason from the router. */
  reason: string
  /** Unix epoch ms when the decision was made. */
  timestamp: number
  /** Conversation id this decision was made for, when available. */
  conversationId?: string
}

const BUFFER_CAP = 50

const buffer: RouterDecisionTelemetryEntry[] = []
let enabled = true

/** Record a router decision. No-op if telemetry is disabled. */
export function recordRouterDecision(input: {
  promptText: string
  route: 'single' | 'multi'
  matchedRule: RouterMatchedRule
  reason: string
  conversationId?: string
  timestamp?: number
}): void {
  if (!enabled) return
  const entry: RouterDecisionTelemetryEntry = {
    promptHash: hashPrompt(input.promptText),
    promptLength: input.promptText.length,
    route: input.route,
    matchedRule: input.matchedRule,
    reason: input.reason,
    timestamp: input.timestamp ?? Date.now(),
    conversationId: input.conversationId
  }
  buffer.push(entry)
  if (buffer.length > BUFFER_CAP) {
    buffer.splice(0, buffer.length - BUFFER_CAP)
  }
}

/** Return a snapshot of recent decisions, oldest → newest. */
export function getRecentRouterDecisions(): readonly RouterDecisionTelemetryEntry[] {
  return [...buffer]
}

/** Clear the buffer. Useful for tests and the /debug "reset" affordance. */
export function clearRouterTelemetry(): void {
  buffer.length = 0
}

/** Disable / enable. When disabled, `recordRouterDecision` is a no-op and
 *  `getRecentRouterDecisions` returns whatever was buffered before the
 *  flip. Default: enabled. Wired to `settings.routerTelemetry`. */
export function setRouterTelemetryEnabled(value: boolean): void {
  enabled = value
}

export function isRouterTelemetryEnabled(): boolean {
  return enabled
}

function hashPrompt(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 8)
}
