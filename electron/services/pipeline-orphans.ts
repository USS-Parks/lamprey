import { getDb } from './database'

// Persistence Phase / PS8 — orphan pipeline stage detection.
//
// The multi-agent pipeline (planner → coder → reviewer → composer) saves
// each stage's assistant message row separately, with the `stage` column
// distinguishing the role. Awaits between stages mean we can't put the
// whole pipeline in a single SQL transaction — a crash between Planner
// and Coder leaves the Planner row durably present but the Coder row
// missing. The Reasoning-Trace Viewer (RT5) already half-handles this
// by rendering planner rows behind a "Show pipeline trace" toggle; PS8
// adds a structured query so the viewer (and the future
// "Incomplete pipeline" chip) can explicitly call out orphans rather
// than leaving the user to infer the gap.
//
// An orphan is defined as: a row with `stage = 'planner'` for which no
// later assistant row in the same conversation carries `stage` NULL
// (= the implicit Coder slot) or `stage IN ('coder','composer')` AFTER
// the planner's created_at. Reviewer rows are not considered orphans
// because a pipeline can legitimately stop at Coder (the user might
// configure a two-stage roster).
//
// The query is intentionally derived, not stored — no extra column,
// no migration. The cost is O(messages in conversation) per call;
// callers should only invoke when the viewer renders.

export interface OrphanStageRow {
  /** id of the orphan stage's `messages` row. */
  messageId: string
  /** Stage discriminator ('planner' today; future stages may surface here). */
  stage: string
  /** `messages.created_at` of the orphan. */
  createdAt: number
  /** `messages.conversation_id`. */
  conversationId: string
}

/**
 * Return planner-stage assistant rows in this conversation whose Coder
 * companion never landed. Sorted ascending by `created_at`.
 *
 * Definition: a planner row at time `t` is orphan iff there is no
 * assistant row with `created_at > t` in the same conversation whose
 * stage is `'coder'` OR NULL (the implicit Coder slot used today) OR
 * `'composer'` (the composer rewrite of the Coder body, which presumes
 * Coder ran).
 */
export function findOrphanPipelineStages(conversationId: string): OrphanStageRow[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT planner.id AS messageId,
              planner.stage AS stage,
              planner.created_at AS createdAt,
              planner.conversation_id AS conversationId
         FROM messages AS planner
        WHERE planner.conversation_id = ?
          AND planner.role = 'assistant'
          AND planner.stage = 'planner'
          AND NOT EXISTS (
              SELECT 1
                FROM messages AS follow
               WHERE follow.conversation_id = planner.conversation_id
                 AND follow.role = 'assistant'
                 AND follow.created_at > planner.created_at
                 AND (follow.stage IS NULL
                      OR follow.stage IN ('coder', 'composer'))
          )
        ORDER BY planner.created_at ASC`
    )
    .all(conversationId) as OrphanStageRow[]
  return rows
}

/**
 * Aggregate count for surfaces that need a quick "any orphans?" probe
 * without paying for the full row list. Returns the same orphan set
 * size as `findOrphanPipelineStages` would.
 */
export function countOrphanPipelineStages(conversationId: string): number {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c
         FROM messages AS planner
        WHERE planner.conversation_id = ?
          AND planner.role = 'assistant'
          AND planner.stage = 'planner'
          AND NOT EXISTS (
              SELECT 1
                FROM messages AS follow
               WHERE follow.conversation_id = planner.conversation_id
                 AND follow.role = 'assistant'
                 AND follow.created_at > planner.created_at
                 AND (follow.stage IS NULL
                      OR follow.stage IN ('coder', 'composer'))
          )`
    )
    .get(conversationId) as { c: number }
  return row.c
}
