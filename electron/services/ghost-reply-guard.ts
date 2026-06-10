// SP-4 (Sweet Spot Phase, 2026-06-10) — ghost-reply guard (D5).
//
// The chat:send outer catch used to tear down the run (abort controllers,
// pending documents, chat:error event) without persisting anything. If the
// failure happened BEFORE any assistant/system row landed — a system-prompt
// builder throw, a tool-catalog build throw, an instant stream failure with
// no partial, a multi-agent bail with zero mutations (CR-2 only fires when
// the Coder mutated files) — the transcript ended on the user's message with
// no reply at all. The toast is transient; reopening the conversation showed
// a turn that looks like Lamprey simply ignored the user.
//
// The guard is pure so it can be tested without better-sqlite3: chat.ts
// passes the conversation's rows and persists a `role:'system'` notice only
// when the turn actually ghosted.

export interface GhostCheckRow {
  role: string
  /** R1 stage discriminator — 'planner' rows are hidden in the chat view, so
   *  a turn that persisted ONLY a planner row still reads as ghosted. */
  stage?: string | null
}

/**
 * True when the conversation's newest user turn has no visible reply after
 * it. Visible replies: any `system` row, or an `assistant` row whose stage is
 * not 'planner' (planner rows are hidden by default per R4). `tool` rows are
 * plumbing, not replies.
 */
export function turnEndedGhosted(rows: readonly GhostCheckRow[]): boolean {
  let lastUserIdx = -1
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].role === 'user') {
      lastUserIdx = i
      break
    }
  }
  if (lastUserIdx === -1) return false
  for (let i = lastUserIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    if (row.role === 'system') return false
    if (row.role === 'assistant' && row.stage !== 'planner') return false
  }
  return true
}

/** True for user-initiated cancellation — not a ghost; the user knows why
 *  there is no reply. Matched on the standard AbortError shapes. */
export function isUserAbortError(err: { name?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  if (err.name === 'AbortError') return true
  return /\babort(ed)?\b/i.test(err.message ?? '')
}

/** The system-notice body persisted when a turn ghosts. Plain language, no
 *  harness jargon — era tone. */
export function buildGhostReplyNotice(errorMessage: string | undefined): string {
  const detail = (errorMessage ?? '').trim() || 'unknown error'
  return (
    `This turn failed before a reply could be generated: ${detail}\n\n` +
    'Your message is preserved above — sending it again will retry from scratch. ' +
    'If this keeps happening, check Settings → API Keys and the model selection.'
  )
}
