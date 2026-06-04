// Fluidity J9: pure helper that merges a chronological list of message
// timestamps with a chronological list of notice timestamps, returning
// drop-in indices for MessageList. Kept framework-free so the
// "interleave" rule is unit-testable without rendering.

export interface NoticeWithTs {
  id: string
  ts: number
}

export interface MessageWithTs {
  id: string
  timestamp: number
}

export type InterleaveItem<M, N> =
  | { kind: 'message'; item: M }
  | { kind: 'notice'; item: N }

/**
 * Merge messages and notices by timestamp. When timestamps tie, the
 * message comes first — we'd rather show "you said X" then "background
 * event followed it" than the other way around. Stable within each list.
 */
export function interleaveNotices<M extends MessageWithTs, N extends NoticeWithTs>(
  messages: readonly M[],
  notices: readonly N[]
): InterleaveItem<M, N>[] {
  const out: InterleaveItem<M, N>[] = []
  let mi = 0
  let ni = 0
  while (mi < messages.length && ni < notices.length) {
    const m = messages[mi]
    const n = notices[ni]
    if (m.timestamp <= n.ts) {
      out.push({ kind: 'message', item: m })
      mi++
    } else {
      out.push({ kind: 'notice', item: n })
      ni++
    }
  }
  while (mi < messages.length) {
    out.push({ kind: 'message', item: messages[mi] })
    mi++
  }
  while (ni < notices.length) {
    out.push({ kind: 'notice', item: notices[ni] })
    ni++
  }
  return out
}
