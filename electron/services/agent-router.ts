// L8 (Lampshade Phase, 2026-06-09) — adaptive routing primitive.
//
// User direction (2026-06-09): "I want the multi-agent/single agent question
// to solve itself; if the task is large, deploy more agents and sub agents.
// If it's manageable, do it alone as a single agent."
//
// This file holds the pure, fast, deterministic heuristic that decides per
// turn whether `agentMode: 'auto'` dispatches the user's request through the
// single-agent path (`runChatRound`) or the multi-agent pipeline
// (`runAgentPipeline`). It is intentionally a heuristic (no LLM call) so it
// is cheap, predictable, easy to test, and never blocks the turn.
//
// The signals it watches are split into two groups: explicit flags the user
// (or a skill) can include in the prompt (`--single` / `--multi`), and
// implicit signals from the prompt shape and content. Explicit flags always
// win, then implicit signals decide. Default is single.

/** What the router returns. The `reason` is shown back to the user as a
 *  one-line hint when auto-mode dispatches a multi-agent run, so users can
 *  understand why the harness chose to fan out. */
export interface RouteDecision {
  /** Which dispatch path to take. */
  mode: 'single' | 'multi'
  /** Short human-readable explanation, suitable for a chat metadata chip. */
  reason: string
  /** The user message with any explicit `--single` / `--multi` flag removed
   *  (so the model never sees the flag, only the substance). When the input
   *  had no flag, this is the original text unchanged. */
  cleanedText: string
}

/** Hard upper bound on prompt length that always promotes to multi. */
const LONG_PROMPT_BYTES = 800

/** Number of sequential-step markers required to promote (≥ 2 hits). */
const MIN_SEQUENTIAL_HITS = 2

/** Number of comma-separated deliverables or list items required to promote. */
const MIN_DELIVERABLE_ITEMS = 3

/** Explicit `--single` / `--multi` override flag matcher. Case-insensitive,
 *  word-bounded, captures the first such flag. The flag is stripped from
 *  the message before dispatch so the model never sees it. */
const FLAG_RE = /(^|\s)--(single|multi)\b/i

/** Build-from-scratch phrases: "build me a full game", "implement a
 *  complete system", "scaffold an entire pipeline". */
const BUILD_FROM_SCRATCH_RE =
  /\b(build|create|scaffold|implement)\b[^.!?]{0,80}\b(full|complete|entire|whole|app|application|game|tool|system|harness|pipeline|service)\b/i

/** Multi-file refactor / audit / migrate phrases. */
const MULTI_FILE_RE =
  /\b(refactor|audit|rewrite|migrate|sweep)\b[^.!?]{0,60}\b(across|entire|all|every)\b/i

/** Explicit phase phrases the harness already uses to mean "big". */
const PHASE_RE = /\b(P-?SPR|STS|stem[ -]to[ -]stern|Phase|phase wrap)\b/i

/** Sequential-step markers: "and then", "after that", "once X is done",
 *  "step 1 / step 2 / step 3". Two or more hits signal a multi-step task. */
const SEQUENTIAL_RE = /\b(and then|after that|once .{1,40} is done|step \d|step #?\d)\b/gi

/** List-item markers: bullet "- ", asterisk "* ", or three-or-more commas at
 *  a single nesting level. We only count those in the body of the prompt,
 *  not anything inside fenced code blocks (` ```...``` `). */
const BULLET_LINE_RE = /^[\s]*[-*]\s+\S/gm

/**
 * Decide which agent dispatch path to use for an `agentMode: 'auto'` turn.
 * Pure function — no I/O, no clock, no randomness — so it is fully testable
 * and predictable. Returns the cleaned message (flag stripped if present),
 * the decision, and a short reason.
 *
 * Order of precedence (first match wins):
 *   1. Explicit `--single` / `--multi` flag in the message
 *   2. Long prompt (> 800 bytes) → multi
 *   3. Explicit phase phrase (P-SPR, STS, stem to stern, Phase) → multi
 *   4. Build-from-scratch phrase → multi
 *   5. Multi-file refactor/audit/migrate phrase → multi
 *   6. ≥ 2 sequential-step markers → multi
 *   7. ≥ 3 deliverables (bullets or commas at top level) → multi
 *   8. Default → single
 */
export function routeAgentMode(userText: string): RouteDecision {
  const original = userText ?? ''

  // (1) Explicit flag.
  const flagMatch = FLAG_RE.exec(original)
  if (flagMatch) {
    const which = flagMatch[2].toLowerCase() as 'single' | 'multi'
    const cleanedText = original.replace(FLAG_RE, '').replace(/\s{2,}/g, ' ').trim()
    return {
      mode: which,
      reason: `explicit --${which} flag in the prompt`,
      cleanedText
    }
  }

  // For the implicit rules, strip fenced code blocks so a long ```bash ... ```
  // example doesn't accidentally trip the bullet or comma heuristics.
  const stripped = original.replace(/```[\s\S]*?```/g, '')

  // (2) Long prompt — measured on the original message, not the stripped one,
  //     because a long pasted code block is itself a multi-agent signal.
  if (original.length > LONG_PROMPT_BYTES) {
    return {
      mode: 'multi',
      reason: `long prompt (${original.length} chars > ${LONG_PROMPT_BYTES})`,
      cleanedText: original
    }
  }

  // (3) Explicit phase phrase.
  const phase = PHASE_RE.exec(stripped)
  if (phase) {
    return {
      mode: 'multi',
      reason: `phase phrase matched: "${phase[1]}"`,
      cleanedText: original
    }
  }

  // (4) Build-from-scratch.
  if (BUILD_FROM_SCRATCH_RE.test(stripped)) {
    return {
      mode: 'multi',
      reason: 'build-from-scratch phrase (build/create/scaffold + full/app/system/etc)',
      cleanedText: original
    }
  }

  // (5) Multi-file refactor / audit / migrate.
  if (MULTI_FILE_RE.test(stripped)) {
    return {
      mode: 'multi',
      reason: 'multi-file phrase (refactor/audit/rewrite + across/entire/all)',
      cleanedText: original
    }
  }

  // (6) Sequential-step markers (≥ 2).
  const seq = stripped.match(SEQUENTIAL_RE)
  if (seq && seq.length >= MIN_SEQUENTIAL_HITS) {
    return {
      mode: 'multi',
      reason: `sequential-step markers (${seq.length} ≥ ${MIN_SEQUENTIAL_HITS})`,
      cleanedText: original
    }
  }

  // (7) ≥ 3 deliverables — count bullet-line starts and (separately) commas
  //     in the top-level prose. We use the larger of the two so either
  //     shape suffices.
  const bullets = (stripped.match(BULLET_LINE_RE) ?? []).length
  // Comma-separated items: a useful heuristic ignores commas inside
  // parenthesised asides. Strip parens content first, then count commas.
  const prose = stripped.replace(/\([^)]*\)/g, '')
  const commas = (prose.match(/,/g) ?? []).length
  const deliverables = Math.max(bullets, commas)
  if (deliverables >= MIN_DELIVERABLE_ITEMS) {
    return {
      mode: 'multi',
      reason: `${deliverables} deliverables (bullets/commas ≥ ${MIN_DELIVERABLE_ITEMS})`,
      cleanedText: original
    }
  }

  // (8) Default — single agent.
  return {
    mode: 'single',
    reason: 'short, single-deliverable ask',
    cleanedText: original
  }
}
