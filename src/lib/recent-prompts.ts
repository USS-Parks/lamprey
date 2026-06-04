// Fluidity J1: pure helpers behind chat-store.getRecentUserPrompts.
// Lifted into a framework-free module so they can be unit-tested without
// dragging in the rest of chat-store's transitive `@/` graph (which the
// vitest runner doesn't resolve without an alias plugin).
import type { Message } from './types'

/**
 * Inverse of buildAttachmentBlock — strips trailing attachment block(s)
 * from a stored user-message content so the ↑ history walker recalls just
 * what the user originally typed (not the inlined ``` file dumps). Anchors
 * on the leading "\n\n[" marker chains buildAttachmentBlock emits:
 * "[Attachment ", "[Indexed corpus:", "[Indexing ", "[PDF ".
 */
export function stripAttachmentBlocks(content: string): string {
  const match = content.match(
    /\n\n\[(?:Attachment |Indexed corpus:|Indexing |PDF )/
  )
  if (!match || match.index === undefined) return content
  return content.slice(0, match.index)
}

/**
 * Walk messages newest→oldest and return up to `limit` non-empty user
 * prompts (attachment blocks stripped). Most-recent-first ordering matches
 * what the ↑/↓ walker expects.
 */
export function getRecentUserPromptsFrom(
  messages: readonly Message[],
  limit = 50
): string[] {
  const out: string[] = []
  for (let i = messages.length - 1; i >= 0 && out.length < limit; i--) {
    const m = messages[i]
    if (m.role !== 'user') continue
    const stripped = stripAttachmentBlocks(m.content).trim()
    if (stripped) out.push(stripped)
  }
  return out
}
