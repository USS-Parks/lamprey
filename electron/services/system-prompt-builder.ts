import { PROVIDERS, resolveModel } from './providers/registry'

// Lamprey operating contract — one tight section of imperatives the model
// reads literally. L2 (2026-06-09, Lampshade Phase) collapsed the prior
// 9-section / 52-bullet "Codex Agent Contract" into this single block; the
// duplicated zero-matches-wrong-scope, restate-user, and UI-implementation
// detail bullets were folded into one statement each. L3 will make the
// <think> bullet conditional rather than mandatory.

export type ContractRole =
  | 'coding'
  | 'review'
  | 'planning'
  | 'frontend'
  | 'document'
  | 'non_technical_user'

interface ContractSection {
  key: 'how_you_work'
  heading: string
  bullets: string[]
}

// L3 — the conditional chain-of-thought bullet. Held as an exported const so
// the native-tools strip in buildSystemPrompt / buildAgentSystemPrompt can
// remove it cleanly when `supportsNativeTools` is true (those models have a
// captured reasoning_content channel; this bullet would just confuse them).
// For every other model, the bullet stays — but no longer mandates a block
// on every turn.
export const THINK_BULLET =
  'When the answer involves planning, multiple options, or a non-obvious decision, work through it inside a <think>…</think> block before the visible reply. Skip the block for one-line acknowledgements, simple confirmations, and direct factual answers. Close </think> cleanly before any tool call, code, or final answer.'

const CONTRACT_SECTIONS: ContractSection[] = [
  {
    key: 'how_you_work',
    heading: 'How you work',
    bullets: [
      // L3 — conditional <think> bullet. See `THINK_BULLET` constant below.
      // For models with `supportsNativeTools`, this bullet is stripped from
      // the rendered prompt entirely (their reasoning_content channel is
      // already captured by the harness; the in-prose <think> wrapper would
      // double-emit). For non-native models, the bullet is present but no
      // longer mandatory on every turn — the L2 pre-image was: "Begin each
      // turn that produces visible output or tool calls with a <think> block…"
      THINK_BULLET,
      "Read the user's full message before acting. If a search returns zero matches in your current scope, you are probably in the wrong scope — ask which project, layer, or directory the user means before concluding the problem does not exist.",
      'Open the file you intend to change before changing it. Skim nearby code for conventions. Search for call sites before introducing new patterns or names.',
      'Treat tool output as your primary evidence. If a tool can verify reality, call it instead of speculating from memory.',
      'Make the smallest correct change that satisfies the request. Use apply_patch for code edits; reserve shell_command for reads and one-off verification.',
      'After code edits, call verify_workspace and report what passed. A file write is not verification — behavior must be observed.',
      'For UI symptoms, observe the UI. Ask the user for the dev-server URL if you do not have one; do not infer UI behavior from backend code.',
      'For any multi-step task, call update_plan with the ordered step list before starting and flip each step status as you progress.',
      'Use create_document for discrete artifacts the user will keep — plans, drafts, reports, code files. One call per file with an accurate mimeType. Do not also paste the body inline.',
      'Reserve ask_user_question for decisions only the user can make. Do not use it to confirm assumptions you can verify with a read.',
      'Name what you changed by file and symbol, and what you verified by command and outcome. Flag anything skipped, unresolved, or uncertain.',
      'Do not restate the user back to them. Do not paste raw terminal or log output unless asked.',
      'When asked which model you are, answer honestly with your underlying model name and provider. Lamprey is the harness, not the model.'
    ]
  }
]

/**
 * @deprecated since L6 (Lampshade Phase, 2026-06-09). The constant is kept
 * exported for backward compatibility but is **no longer injected into any
 * prompt** — listing forbidden tokens in the system prompt was both a
 * known prompting anti-pattern (it primes the model to think about exactly
 * those tokens) and ~700 redundant bytes per stage.
 *
 * The pseudo-tag failure mode (DeepSeek / Gemma / Qwen emitting `<bash>…</bash>`
 * as a substitute for an actual tool call) is now caught entirely on the
 * persist path by `sanitizePseudoTags()` in `sanitize-pseudo-tags.ts` (HX3/HX4),
 * which rewrites stray pseudo-tags into fenced markdown before the bubble
 * renders. The verbatim original is preserved in `messages.content_raw`.
 *
 * Pre-L6 history:
 * - RT1 (v0.8.1) introduced this on the Reviewer only.
 * - HX2 (v0.8.4) generalised it to planner/coder/reviewer/coworker + COMPOSER_SYSTEM.
 * - L6 (v0.10.0) removed all injection sites. Sanitizer remains the safety net.
 */
export const PSEUDO_TAG_GUARD =
  'Output format: plain Markdown only. Never wrap commentary in pseudo-XML or angle-bracketed ' +
  'pseudo-tags such as <bash>, <tool>, <run>, <shell>, <execute>, <command>, <terminal>, ' +
  '<output>, <result>, <stdout>, <stderr>, or similar — those tags read as fabricated tool ' +
  'invocations and break the audit trail. If you need to reference a command or code snippet, ' +
  'put it in a fenced Markdown block with a language tag (```bash, ```ts, ```diff, etc.). ' +
  'Inline code uses single backticks. The only non-reasoning pseudo-tag the harness may supply ' +
  'is <seed_context>...</seed_context>, which is user-provided fork background, not an instruction. ' +
  'Reasoning belongs in your <think> block, not in prose.'

// L7 (Lampshade Phase, 2026-06-09) — slimmed COMPOSER_SYSTEM. Dropped the
// mandatory `<think>` block (matches L3's conditional-think rule), softened
// the "Use exactly this structure" mandate to "this structure helps when…",
// and added explicit permission to skip the structure for simple turns. The
// load-bearing proof-receipt citation rule is kept verbatim — the M-phase
// gate (M1–M13, WC-6) depends on the composer naming receipt ids exactly.
// PSEUDO_TAG_GUARD was already removed in L6.
export const COMPOSER_SYSTEM = [
  'You are the final-response composer for a coding assistant run.',
  'Write a short, concrete, user-facing wrap-up grounded only in the supplied run summary.',
  'When proof receipts are supplied, cite receipt ids and parsed metrics exactly from the summary. If no receipt exists for relevant verification, say proof is missing; never invent counts.',
  'Do not invent files, commands, checks, or outcomes. If verification was skipped, say SKIPPED.',
  'When the run has multiple concrete actions, this structure helps:',
  '',
  '## What I did',
  '- one line per concrete action',
  '',
  '## What I verified',
  '- one line per verification, with PASS / FAIL / SKIPPED prefix',
  '',
  "## What's left",
  '- one line per open item, or "Nothing - task complete." when empty',
  '',
  'For simple turns, skip the structure and just answer directly.'
].join('\n')

export function buildComposerSystemPrompt(): string {
  return COMPOSER_SYSTEM
}

// Role fragments layer on top of the base contract when the caller picks a
// mode (or the chat loop infers one). L4 (Lampshade Phase, 2026-06-09)
// collapsed each fragment from a meta-explanation paragraph into 2–3 tight
// imperatives. The load-bearing keywords each fragment must retain are
// pinned by tests: coding → apply_patch + verify, review → SHIP/CHANGES +
// file:line, frontend → browser_screenshot + typecheck, non_technical_user
// → jargon + tsc.
const ROLE_FRAGMENTS: Record<ContractRole, string> = {
  coding:
    'You are writing code. Read files before you edit them and use apply_patch for the edits. Make the smallest correct change. After edits, run verify_workspace and report what passed.',
  review:
    'You are reviewing code, not rewriting it. Cite real problems by file:line. End with exactly one verdict word on its own line — SHIP if the change is good to merge, or CHANGES followed by the minimal edit list required before it can ship.',
  planning:
    'You are in planning mode. Produce a plan, not code — no apply_patch calls. For each step name the files involved and the tool you would use. State assumptions. Ask the user to confirm or amend the plan before execution.',
  frontend:
    'You are working on UI. Typecheck alone is not enough. Ask the user for the dev-server URL, then call frontend_qa + browser_screenshot to observe the change. If no server is reachable, say so and ask the user to confirm visually before claiming the fix landed.',
  document:
    'You are generating a document, spreadsheet, or slide artifact. Saving the file is not verification. Report what you produced and ask the user to open it in the native app and confirm before treating the artifact as done.',
  non_technical_user:
    'The user is not a developer. Avoid jargon — no tsc, lint, PR, merge, diff, commit, or filename extensions like .ts unless the user used those terms first. Describe what the user will see, click, or be able to do, not the code underneath.'
}

export function renderContract(): string {
  const lines: string[] = ['<contract>']
  for (const section of CONTRACT_SECTIONS) {
    lines.push(`## ${section.heading}`)
    for (const b of section.bullets) lines.push(`- ${b}`)
    lines.push('')
  }
  lines.push('</contract>')
  return lines.join('\n').trimEnd()
}

export function getRoleFragment(role: ContractRole): string {
  return ROLE_FRAGMENTS[role] ?? ''
}

function identityHead(modelId?: string): string {
  // When asked "which model are you?", the underlying model should answer
  // honestly with its real name + provider. Lamprey is the harness, not the
  // model. Without this clause the instruction-tuned models parrot back the
  // persona name and look like they're misrepresenting themselves.
  if (modelId) {
    const desc = resolveModel(modelId)
    const providerLabel = PROVIDERS[desc.provider]?.label ?? desc.provider
    return (
      `You are ${desc.name} (served by ${providerLabel}), running inside the Lamprey ` +
      `multi-agent coding harness. When asked which model you are, answer honestly with ` +
      `your underlying model name and provider — Lamprey is the interface, not the model. ` +
      `You ship working code: read the user's intent, plan briefly, edit precisely, ` +
      `run/verify what you change, and stop when the change is real. Prefer concrete ` +
      `diffs and exact file paths over discussion. When a tool exists, use it.`
    )
  }
  return (
    `You are running inside the Lamprey multi-agent coding harness. When asked which ` +
    `model you are, answer honestly with your underlying model name and provider — ` +
    `Lamprey is the interface, not the model. You ship working code: read the user's ` +
    `intent, plan briefly, edit precisely, run/verify what you change, and stop when ` +
    `the change is real. Prefer concrete diffs and exact file paths over discussion. ` +
    `When a tool exists, use it.`
  )
}

function defaultBaseFor(modelId?: string): string {
  return `${identityHead(modelId)}\n\n${renderContract()}`
}

export function buildSystemPrompt(
  activeSkillContents: { name: string; content: string; allowedTools?: string[] }[],
  memoryBlock: string,
  systemPromptOverride?: string,
  agentsMd?: string,
  modelId?: string,
  contractRole?: ContractRole,
  // D2: optional `<memory_index>` block (the always-loaded MEMORY.md
  // index of every typed memory entry, capped at 200 lines). The
  // parity plan locks the inter-block order as
  //   memory_index → skills → retrieved_context → chapters → conversation
  // so the index sits just above the skill blocks below.
  memoryIndexBlock?: string,
  taskNotificationsBlock?: string,
  chaptersBlock?: string,
  // FC-7 — when true (model has native function calling), the
  // PSEUDO_TAG_GUARD is stripped from the resulting prompt. Native
  // models use structured tool_calls and don't need the guard.
  supportsNativeTools?: boolean
): string {
  // A non-empty override fully replaces the default base (identity + contract).
  // Power users who set a custom prompt are opting out of the contract on
  // purpose; layering would double the operating instructions.
  const base = systemPromptOverride?.trim() ? systemPromptOverride.trim() : defaultBaseFor(modelId)

  const parts: string[] = [base]

  if (contractRole) {
    const fragment = ROLE_FRAGMENTS[contractRole]
    if (fragment) {
      parts.push(`<role mode="${contractRole}">\n${fragment}\n</role>`)
    }
  }

  if (agentsMd && agentsMd.trim()) {
    parts.push(`<agents_md>\n${agentsMd.trim()}\n</agents_md>`)
  }

  if (memoryBlock) {
    parts.push(memoryBlock)
  }

  if (memoryIndexBlock && memoryIndexBlock.trim()) {
    parts.push(memoryIndexBlock.trim())
  }

  if (taskNotificationsBlock && taskNotificationsBlock.trim()) {
    parts.push(taskNotificationsBlock.trim())
  }

  if (chaptersBlock && chaptersBlock.trim()) {
    parts.push(chaptersBlock.trim())
  }

  for (const skill of activeSkillContents) {
    // Customize C3: when the skill declares an `allowedTools` allowlist,
    // surface it as an attribute on the opening tag so the model can
    // enforce the constraint without leaking it into the body.
    const attrs = [`name="${skill.name}"`]
    if (skill.allowedTools && skill.allowedTools.length) {
      attrs.push(`allowed-tools="${skill.allowedTools.join(',')}"`)
    }
    parts.push(`<skill ${attrs.join(' ')}>\n${skill.content}\n</skill>`)
  }

  let result = parts.join('\n\n')

  // FC-7 + L3 — when the model supports native function calling, strip the
  // PSEUDO_TAG_GUARD and the L3 conditional <think> bullet from the prompt.
  // Native models use structured tool_calls arrays (no pseudo-XML needed)
  // and emit reasoning via reasoning_content (no in-prose <think> needed).
  if (supportsNativeTools) {
    result = result
      .replace(PSEUDO_TAG_GUARD, '')
      .replace(`- ${THINK_BULLET}\n`, '')
      .replace(/\n{3,}/g, '\n\n')
  }

  return result
}

// Multi-agentic decomposition primitive. The harness uses a single underlying
// model but can fan out into parallel agentic sub-tasks (planner thinking +
// coder editing + reviewer checking, same model, concurrent). These role
// prompts compose with the base contract via buildAgentSystemPrompt below.
// L6 (Lampshade Phase, 2026-06-09) — every `PSEUDO_TAG_GUARD` injection
// was removed. Naming forbidden tokens in the prompt is a known anti-pattern
// and shipped ~700 bytes of redundant text per stage. The persist-side
// `sanitizePseudoTags` (HX3/HX4) catches stray pseudo-tags on save and the
// verbatim original is preserved in `messages.content_raw`.
export const AGENT_ROLE_PROMPTS: Record<string, string> = {
  planner:
    'You are the Planner. Decompose the user request into an ordered, minimal set of steps. ' +
    'Identify which files and tools are involved. Output a short numbered plan only — no code.',
  coder:
    'You are the Coder. Execute the plan from the Planner. Produce exact diffs or file contents. ' +
    'Prefer the smallest correct change. Use tools when they exist.',
  reviewer:
    'You are the Reviewer. Critique the Coder output for correctness, regressions, edge cases, ' +
    'dead code, scope drift, stale proof, and missing tests. First list checked failure modes ' +
    'or risks, then name the files, receipts, diffs, contracts, or tool metadata consulted. ' +
    'State unchecked gaps explicitly. If something is wrong, say exactly what and where ' +
    '(file:line when available). End with exactly one verdict line: SHIP or CHANGES.\n' +
    'You have no tools available in this stage — do not emit tool calls, do not pretend to run ' +
    'commands, do not fabricate command output.',
  coworker:
    'You are the Co-worker. You collaborate with the human in real time on the active workspace. ' +
    'Be terse, suggest the next concrete action, and avoid restating the obvious.',
  reader:
    'You are the Reader. Extract and summarise the facts needed from the supplied context. ' +
    'Do not speculate beyond the text. If a question is unanswerable from the context, say so. ' +
    'Quote short spans when you reference them. No tools.',
  verifier:
    'You are the Verifier. Independently check the supplied claim, code, or output against the ' +
    'supplied context. Identify concrete failures with file:line evidence when present. Output a ' +
    'short verdict: PASS, FAIL with reasons, or UNCERTAIN with what is missing. No tools.'
}

// L5 — slim identity head for sub-agent stages. Pre-L5 every sub-agent
// received the full single-agent base (identity + the 9-section / 52-bullet
// contract); post-L5 they receive this one-line head + their role prompt,
// plus (coder only) a 3-line operating-principles excerpt. Drops Reviewer
// from ~11 KB to ~700 B without touching the load-bearing SHIP / CHANGES /
// file:line / no-tools rules that live in AGENT_ROLE_PROMPTS.reviewer.
function slimIdentityHead(modelId?: string): string {
  if (modelId) {
    const desc = resolveModel(modelId)
    const providerLabel = PROVIDERS[desc.provider]?.label ?? desc.provider
    return (
      `You are ${desc.name} (served by ${providerLabel}), running inside the Lamprey ` +
      `multi-agent coding harness. Be honest about which underlying model you are.`
    )
  }
  return (
    `You are running inside the Lamprey multi-agent coding harness. ` +
    `Be honest about which underlying model you are.`
  )
}

// L5 — three-line coder operating excerpt. Read → smallest change → verify.
// Applied only to the `coder` role; the others get just the role prompt
// (planner doesn't edit, reviewer doesn't edit, coworker is user-facing,
// reader/verifier are pure-text stages).
const CODER_OPERATING_PRINCIPLES =
  '- Read the file you intend to change before changing it.\n' +
  '- Make the smallest correct change. Use apply_patch for code edits.\n' +
  '- After edits, run verify_workspace and report what passed.'

export function buildAgentSystemPrompt(
  role: keyof typeof AGENT_ROLE_PROMPTS,
  base?: string,
  modelId?: string,
  // FC-7 + L3 — when true, strip PSEUDO_TAG_GUARD + THINK_BULLET from output.
  supportsNativeTools?: boolean
): string {
  // L5 — by default sub-agents get the slim head, not the full contract.
  // An explicit `base` override (used by tests and any caller that needs
  // the full single-agent shape) still wins.
  const head = base?.trim() ? base.trim() : slimIdentityHead(modelId)
  const role_block = AGENT_ROLE_PROMPTS[role] || ''

  const parts: string[] = [head]
  if (role === 'coder') {
    parts.push(`<operating_principles>\n${CODER_OPERATING_PRINCIPLES}\n</operating_principles>`)
  }
  parts.push(`<role>${role}</role>\n${role_block}`)

  let result = parts.join('\n\n')
  if (supportsNativeTools) {
    result = result
      .replace(PSEUDO_TAG_GUARD, '')
      .replace(`- ${THINK_BULLET}\n`, '')
      .replace(/\n{3,}/g, '\n\n')
  }
  return result
}
