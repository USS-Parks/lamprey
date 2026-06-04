import { ipcMain } from 'electron'
import {
  createChapter,
  deleteChapter,
  listChapters,
  listChaptersByAnchor
} from '../services/chapters-store'
import { emitChatEvent } from '../services/chat-events'

// Track 2 / E1 — chapter IPC. The model writes via the `mark_chapter`
// tool descriptor (handled inline in chat.ts so it can emit the chat
// event); the renderer hits these handlers for hydration + manual user
// flips. Every write fires `chat.chapter.marked` so any open chat view
// updates without polling.

export function registerChaptersHandlers(): void {
  ipcMain.handle('session:markChapter', async (
    _event,
    payload: {
      conversationId: string
      title: string
      summary?: string | null
      anchorMessageId: string
    }
  ) => {
    try {
      if (!payload?.conversationId) {
        return { success: false, error: 'conversationId required' }
      }
      if (!payload.title || typeof payload.title !== 'string') {
        return { success: false, error: 'title required' }
      }
      if (!payload.anchorMessageId || typeof payload.anchorMessageId !== 'string') {
        return { success: false, error: 'anchorMessageId required' }
      }
      const chapter = createChapter({
        conversationId: payload.conversationId,
        title: payload.title,
        summary: payload.summary ?? null,
        anchorMessageId: payload.anchorMessageId
      })
      emitChatEvent('chat:chapter-marked', {
        conversationId: payload.conversationId,
        chapter
      })
      return { success: true, data: chapter }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'session:markChapter failed' }
    }
  })

  ipcMain.handle('session:listChapters', async (_e, conversationId: string) => {
    try {
      if (!conversationId) return { success: false, error: 'conversationId required' }
      return { success: true, data: listChapters(conversationId) }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'session:listChapters failed' }
    }
  })

  ipcMain.handle('session:chaptersForAnchor', async (
    _e,
    anchorMessageId: string
  ) => {
    try {
      if (!anchorMessageId) return { success: false, error: 'anchorMessageId required' }
      return { success: true, data: listChaptersByAnchor(anchorMessageId) }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'session:chaptersForAnchor failed' }
    }
  })

  ipcMain.handle('session:deleteChapter', async (_e, id: string) => {
    try {
      if (!id) return { success: false, error: 'id required' }
      const ok = deleteChapter(id)
      return { success: true, data: ok }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'session:deleteChapter failed' }
    }
  })
}
