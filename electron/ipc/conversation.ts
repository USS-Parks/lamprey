import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import * as store from '../services/conversation-store'
import { chatOnce } from '../services/providers/registry'
import { listStageMetrics } from '../services/stage-metrics-store'

export function registerConversationHandlers(): void {
  ipcMain.handle('conversation:list', async () => {
    try {
      return { success: true, data: store.listConversations() }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // E3 — sessions sidebar.
  ipcMain.handle(
    'sessions:list',
    async (
      _event,
      opts?: { tab?: 'recent' | 'pinned' | 'archived'; query?: string; limit?: number; offset?: number }
    ) => {
      try {
        return { success: true, data: store.listSessions(opts) }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }
  )

  ipcMain.handle('sessions:archive', async (_event, id: string, archived: boolean) => {
    try {
      store.setConversationArchived(id, archived)
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('sessions:setPinned', async (_event, id: string, pinned: boolean) => {
    try {
      store.setConversationPinned(id, pinned)
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('sessions:search', async (_event, query: string, limit?: number) => {
    try {
      const lim = typeof limit === 'number' && limit > 0 ? Math.min(limit, 200) : 50
      return { success: true, data: store.searchSessions(query, lim) }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('conversation:get', async (_event, id) => {
    try {
      const conv = store.getConversation(id)
      if (!conv) return { success: false, error: 'Conversation not found' }
      return { success: true, data: conv }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle(
    'conversation:create',
    async (
      _event,
      model: string,
      opts?: {
        kind?: 'local' | 'cloud' | 'worktree'
        worktreePath?: string | null
        projectId?: string | null
      }
    ) => {
      try {
        return { success: true, data: store.createConversation(model, opts) }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }
  )

  ipcMain.handle('conversation:delete', async (_event, id) => {
    try {
      store.deleteConversation(id)
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('conversation:updateTitle', async (_event, id, title) => {
    try {
      store.updateConversationTitle(id, title)
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('conversation:getMessages', async (_event, id) => {
    try {
      return { success: true, data: store.getMessages(id) }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // RT3 — per-stage token + duration metrics for an assistant message.
  // Single-agent turns return one row (stage='single'); multi-agent turns
  // return planner + coder on the coder message id, reviewer on the
  // reviewer message id.
  ipcMain.handle('conversation:listStageMetrics', async (_event, messageId: string) => {
    try {
      return { success: true, data: listStageMetrics(messageId) }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('conversation:appendSystem', async (_event, id, content) => {
    try {
      const msg = store.saveMessage({
        id: randomUUID(),
        conversationId: id,
        role: 'system',
        content
      })
      return { success: true, data: msg }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('conversation:setModel', async (_event, id, model) => {
    try {
      store.updateConversationModel(id, model)
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('conversation:fork', async (_event, id: string) => {
    try {
      const src = store.getConversation(id)
      if (!src) return { success: false, error: 'source not found' }
      const next = store.createConversation(src.model, {
        kind: src.kind ?? 'local',
        worktreePath: src.worktreePath ?? null
      })
      // Copy messages over.
      const msgs = store.getMessages(id)
      for (const m of msgs) {
        store.saveMessage({
          id: randomUUID(),
          conversationId: next.id,
          role: m.role,
          content: m.content,
          model: m.model,
          toolCallId: m.toolCallId
        })
      }
      if (src.title) store.updateConversationTitle(next.id, `${src.title} (fork)`)
      return { success: true, data: next }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('conversation:compact', async (_event, id: string) => {
    try {
      const conv = store.getConversation(id)
      if (!conv) return { success: false, error: 'conversation not found' }
      const msgs = store.getMessages(id)
      if (msgs.length < 4) {
        return { success: false, error: 'Conversation is too short to compact.' }
      }
      // Build a summarization request using the conversation's own model.
      const summaryReq = [
        {
          role: 'system' as const,
          content:
            'You are a summarizer. Produce a concise context-preservation summary (≤300 words) of the following conversation. Preserve specific decisions, file paths, code snippets, and unresolved questions. Output Markdown.'
        },
        ...msgs
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content
          }))
      ]
      const summaryResult = await chatOnce(summaryReq as any, conv.model)
      const summary = summaryResult.content
      if (!summary?.trim()) {
        return { success: false, error: 'Summarizer returned empty output.' }
      }
      // Replace messages with a single system marker holding the summary.
      store.clearConversationMessages(id)
      store.saveMessage({
        id: randomUUID(),
        conversationId: id,
        role: 'system',
        content: `## Conversation compacted at ${new Date().toISOString()}\n\n${summary}`
      })
      return { success: true, data: { summary } }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'compact failed' }
    }
  })
}
