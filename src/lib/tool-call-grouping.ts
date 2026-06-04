// Consecutive same-tool grouping for MessageList. Matches Codex /
// Claude Code parity: a planner exploration burst of 6 `shell_command`
// reads should render as ONE "Shell command · 6 calls" foldable group,
// not six stacked cards.
//
// Rule:
//   - Walk the toolCalls list left-to-right.
//   - A run of 3+ consecutive entries with the same (toolName, serverId)
//     AND all individually `isGroupable` collapses into a single group
//     item. Otherwise each entry passes through as `single`.
//   - Anything that's still in flight, errored, destructive, hidden
//     from the transcript, or a special-renderer tool (multi_agent_run)
//     is NEVER groupable — those need to remain visually distinct so
//     the user sees the live spinner / red border / dedicated card.
//
// Pure, no react import — lives in /lib so the test suite exercises it
// without a render harness.

import type { ToolCallState } from '@/stores/chat-store'

export type GroupedToolCallItem =
  | { kind: 'single'; toolCall: ToolCallState }
  | {
      kind: 'group'
      toolName: string
      serverId: string
      // Plain-English label from the descriptor (e.g. "Shell command").
      // Falls back to `toolName` when the IPC event didn't carry one.
      title: string
      items: ToolCallState[]
    }

/** Minimum run length that earns a group wrapper. Pairs (2 in a row) are
 *  not compact enough to justify the header chrome; 3+ wins big. */
export const GROUP_THRESHOLD = 3

/** Tool names that always render with their own bespoke component and so
 *  must never be folded into a generic group. */
const NEVER_GROUP_TOOL_NAMES = new Set<string>(['multi_agent_run'])

export function isGroupable(tc: ToolCallState): boolean {
  if (tc.transcriptHidden) return false
  if (NEVER_GROUP_TOOL_NAMES.has(tc.toolName)) return false
  if (tc.status === 'pending' || tc.status === 'running') return false
  // Errored and denied calls stay individual: the user needs to see the
  // red/grey border on its own card, not buried inside a "6 calls" group.
  if (tc.status === 'error' || tc.status === 'denied') return false
  if (tc.risks && tc.risks.includes('destructive')) return false
  return true
}

export function groupConsecutiveToolCalls(
  toolCalls: ToolCallState[]
): GroupedToolCallItem[] {
  const out: GroupedToolCallItem[] = []
  let i = 0
  while (i < toolCalls.length) {
    const head = toolCalls[i]
    if (!isGroupable(head)) {
      out.push({ kind: 'single', toolCall: head })
      i++
      continue
    }
    let j = i + 1
    while (
      j < toolCalls.length &&
      isGroupable(toolCalls[j]) &&
      toolCalls[j].toolName === head.toolName &&
      toolCalls[j].serverId === head.serverId
    ) {
      j++
    }
    const runLength = j - i
    if (runLength >= GROUP_THRESHOLD) {
      out.push({
        kind: 'group',
        toolName: head.toolName,
        serverId: head.serverId,
        title: head.title ?? head.toolName,
        items: toolCalls.slice(i, j)
      })
    } else {
      for (let k = i; k < j; k++) {
        out.push({ kind: 'single', toolCall: toolCalls[k] })
      }
    }
    i = j
  }
  return out
}

/** Sum of `duration` (ms) across a group's items. Items still missing a
 *  duration (shouldn't happen because non-terminal calls aren't groupable,
 *  but defensive) contribute 0. */
export function groupTotalDurationMs(items: ToolCallState[]): number {
  let total = 0
  for (const it of items) {
    if (typeof it.duration === 'number') total += it.duration
  }
  return total
}
