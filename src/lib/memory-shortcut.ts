// Fluidity J4: pure detector for the "#" memory-write shortcut in ChatInput.
//
// Rule from the plan: "# at column 0 of line 1 toggles mode; # mid-text does
// not". Accept the bare `#` (user just typed the hash, no body yet) or
// `# <text>` (any non-empty trailing description). Reject:
//   - `#hash-but-no-space` (no separator → looks like a hashtag, not a memory)
//   - leading whitespace before `#`
//   - `#` anywhere after a newline (must be line 1)
//
// Returns the seed description (trimmed) when the input is in memory mode,
// otherwise null.

export function detectMemoryShortcut(content: string): { description: string } | null {
  if (content.length === 0) return null
  // Multiline: only fire if `#` is on line 1.
  const firstLineEnd = content.indexOf('\n')
  const firstLine = firstLineEnd >= 0 ? content.slice(0, firstLineEnd) : content
  if (!firstLine.startsWith('#')) return null
  // After `#`: must be end-of-string, a space, or a newline (handled above).
  if (firstLine.length === 1) return { description: '' }
  if (firstLine[1] !== ' ') return null
  // The description is whatever follows "# " on line 1. Subsequent lines are
  // left for the editor body (caller may decide whether to use them).
  return { description: firstLine.slice(2).trim() }
}
