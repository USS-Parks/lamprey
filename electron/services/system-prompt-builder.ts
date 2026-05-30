export function buildSystemPrompt(
  activeSkillContents: { name: string; content: string }[],
  memoryBlock: string,
  systemPromptOverride?: string
): string {
  const base = systemPromptOverride?.trim()
    ? systemPromptOverride.trim()
    : 'You are Lamprey, a helpful AI assistant. Be direct and precise.'

  const parts: string[] = [base]

  if (memoryBlock) {
    parts.push(memoryBlock)
  }

  for (const skill of activeSkillContents) {
    parts.push(`<skill name="${skill.name}">\n${skill.content}\n</skill>`)
  }

  return parts.join('\n\n')
}
