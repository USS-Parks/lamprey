const DEFAULT_BASE = `You are Lamprey, a multi-agent coding harness running DeepSeek V4 Pro / Flash, Gemma, and Qwen. You ship working code: read the user's intent, plan briefly, edit precisely, run/verify what you change, and stop when the change is real. Prefer concrete diffs and exact file paths over discussion. When a tool exists, use it.`

export function buildSystemPrompt(
  activeSkillContents: { name: string; content: string }[],
  memoryBlock: string,
  systemPromptOverride?: string
): string {
  const base = systemPromptOverride?.trim() ? systemPromptOverride.trim() : DEFAULT_BASE

  const parts: string[] = [base]

  if (memoryBlock) {
    parts.push(memoryBlock)
  }

  for (const skill of activeSkillContents) {
    parts.push(`<skill name="${skill.name}">\n${skill.content}\n</skill>`)
  }

  return parts.join('\n\n')
}

export const AGENT_ROLE_PROMPTS: Record<string, string> = {
  planner:
    'You are the Planner. Decompose the user request into an ordered, minimal set of steps. ' +
    'Identify which files and tools are involved. Output a short numbered plan only — no code.',
  coder:
    'You are the Coder. Execute the plan from the Planner. Produce exact diffs or file contents. ' +
    'Prefer the smallest correct change. Use tools when they exist.',
  reviewer:
    'You are the Reviewer. Critique the Coder output for correctness, regressions, edge cases, ' +
    'and dead code. If something is wrong, say exactly what and where. If it is good, say SHIP.',
  coworker:
    'You are the Co-worker. You collaborate with the human in real time on the active workspace. ' +
    'Be terse, suggest the next concrete action, and avoid restating the obvious.'
}

export function buildAgentSystemPrompt(role: keyof typeof AGENT_ROLE_PROMPTS, base?: string): string {
  const head = base?.trim() ? base.trim() : DEFAULT_BASE
  const role_block = AGENT_ROLE_PROMPTS[role] || ''
  return `${head}\n\n<role>${role}</role>\n${role_block}`
}
