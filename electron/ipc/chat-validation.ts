// Pure validation for the `chat:send` IPC payload. Lives in its own file
// (rather than alongside the handler in chat.ts) so the test layer can
// exercise it without pulling chat.ts's full module graph — chat.ts
// transitively imports skill-loader / electron-toolkit / providers, none
// of which initialize cleanly under headless vitest.

// UB-7 (Unburdening Phase, 2026-06-10) — the `agentMode` request field died
// with the pipeline; unknown fields (including stale agentMode from old
// callers) are simply ignored.
export type ChatSendValidation =
  | {
      ok: true
      value: {
        content: string
        model: string
        conversationId: string
        activeSkillIds: string[]
      }
    }
  | { ok: false; error: string }

export function validateChatSendRequest(raw: unknown): ChatSendValidation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'chat:send: request object is required' }
  }
  const req = raw as Record<string, unknown>
  if (typeof req.content !== 'string' || req.content.trim() === '') {
    return {
      ok: false,
      error: 'chat:send: content (non-empty string) is required'
    }
  }
  if (typeof req.model !== 'string' || !req.model) {
    return { ok: false, error: 'chat:send: model id is required' }
  }
  if (req.conversationId !== undefined && typeof req.conversationId !== 'string') {
    return {
      ok: false,
      error: 'chat:send: conversationId must be a string'
    }
  }
  // Filter to strings so a mixed-type array doesn't reach the skill loader
  // as a "skill not found" later.
  const activeSkillIds: string[] = Array.isArray(req.activeSkillIds)
    ? req.activeSkillIds.filter(
        (s): s is string => typeof s === 'string' && s.length > 0
      )
    : []
  return {
    ok: true,
    value: {
      content: req.content,
      model: req.model,
      conversationId:
        typeof req.conversationId === 'string' ? req.conversationId : 'new',
      activeSkillIds
    }
  }
}
