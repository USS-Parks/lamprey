// HY1 — Lazy model tool-surface.
//
// The Claude-Code-style differentiator: do NOT ship every tool's full JSON
// Schema to the model on every turn. Send a small always-on CORE set (full
// schemas) plus one meta-tool, `tool_search`. The model calls `tool_search`
// to discover and UNLOCK additional tools; once unlocked (per conversation),
// their full schemas are included on subsequent rounds so the model can call
// them natively.
//
// OpenAI-compatible tool calling needs the full schema to emit valid args, so
// "lazy" here is a search -> resolve -> unlock round-trip, NOT stub schemas
// sent to the model. This module is pure (no I/O, no registry coupling beyond
// the tool array shape) so it is fully unit-testable. The registry method
// `getModelToolSurface()` and the chat dispatch wiring (HY2) build on it.

import type { ChatCompletionTool } from 'openai/resources/chat/completions'

/**
 * Always-on core tools — the surface every coding turn needs without a
 * search. Kept deliberately small; everything else is one `tool_search` away.
 * Tuned in HY1; revisit if telemetry shows the model searching for the same
 * tool every turn (promote it) or never touching a core tool (demote it).
 */
export const CORE_TOOL_NAMES: readonly string[] = [
  'shell_command',
  'apply_patch',
  'workspace_context',
  'view_image',
  'web_search',
  'ask_user_question',
  'update_plan',
  'enter_plan_mode',
  'exit_plan_mode',
  'get_goal',
  // HY3 — always available so the model can page back into any spilled result.
  'read_tool_result',
  // HY4 — always available so the model can load a skill stub's full body.
  'skill_open'
]

export const TOOL_SEARCH_TOOL_NAME = 'tool_search'

/**
 * The meta-tool descriptor injected into the lazy surface. Its handler lives
 * in the chat dispatch (HY2): it resolves matches, unlocks them for the
 * conversation, and returns the match list as the tool result.
 */
export const TOOL_SEARCH_TOOL: ChatCompletionTool = {
  type: 'function',
  function: {
    name: TOOL_SEARCH_TOOL_NAME,
    description:
      'Search for and unlock additional tools by capability. A small core tool set ' +
      '(shell, file edit, workspace, plan, web search, etc.) is always available. Every ' +
      'other capability — browser automation, image generation, document creation, ' +
      'verification, sub-agent fan-out, and any connected MCP connector (Gmail, Drive, ' +
      'GitHub, Chrome, …) — must be unlocked with this tool before you can call it. ' +
      'Returns the matching tool names and descriptions; the matched tools become ' +
      'callable on your next turn. Search by what you want to do, e.g. "take a screenshot", ' +
      '"generate an image", "send an email", "run sub-agents in parallel".',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description:
            'A capability or task description, or "select:name1,name2" to unlock tools by exact name.'
        }
      },
      required: ['query']
    }
  }
}

/** Extract a tool entry's function name (defensive against malformed entries). */
export function toolEntryName(t: ChatCompletionTool): string {
  return (t as { function?: { name?: string } }).function?.name ?? ''
}

/**
 * Build the lazy model surface from the full provider-normalized tool array.
 *
 * Keeps tools whose name is in `coreNames` (default `CORE_TOOL_NAMES`) or in
 * `unlockedNames`, and always appends the `tool_search` meta-tool (unless the
 * underlying catalog already registered one). Order is preserved from the
 * input, with `tool_search` last. Pure — same inputs always yield the same
 * output.
 */
export function buildModelToolSurface(
  allProviderTools: ChatCompletionTool[],
  opts: { unlockedNames?: Iterable<string>; coreNames?: Iterable<string> } = {}
): ChatCompletionTool[] {
  const core = new Set(opts.coreNames ?? CORE_TOOL_NAMES)
  const unlocked = new Set(opts.unlockedNames ?? [])

  const kept = allProviderTools.filter((t) => {
    const n = toolEntryName(t)
    return core.has(n) || unlocked.has(n)
  })

  if (!kept.some((t) => toolEntryName(t) === TOOL_SEARCH_TOOL_NAME)) {
    kept.push(TOOL_SEARCH_TOOL)
  }
  return kept
}

/**
 * Names that `tool_search` results should never include: the always-on core
 * (already callable) and the meta-tool itself. Used by the resolve path so a
 * search doesn't waste the model's turn surfacing tools it already has.
 */
export function isAlreadyAvailable(
  name: string,
  coreNames: Iterable<string> = CORE_TOOL_NAMES
): boolean {
  return name === TOOL_SEARCH_TOOL_NAME || new Set(coreNames).has(name)
}
