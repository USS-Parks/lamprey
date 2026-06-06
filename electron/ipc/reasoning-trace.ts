import { BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFile } from 'fs/promises'
import * as convStore from '../services/conversation-store'
import { listStageMetrics } from '../services/stage-metrics-store'
import {
  toCsv,
  toMarkdown,
  type ExportInput,
  type TurnInput
} from '../services/reasoning-trace-exporter'

// RT7 — audit-trail export. Pulls the active conversation's messages + per-
// message stage metrics, runs them through the pure exporter, and writes to
// a path the user picks via `dialog.showSaveDialog`. Never POSTs anywhere
// — local filesystem only.

export type ExportFormat = 'md' | 'csv'

function safeFilename(conversationId: string, format: ExportFormat): string {
  const slug = conversationId.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 40)
  return `lamprey-reasoning-trace-${slug}.${format}`
}

function buildExportInput(conversationId: string): ExportInput {
  const messages = convStore.getMessages(conversationId)
  const stageMetrics: Record<string, ReturnType<typeof listStageMetrics>> = {}
  for (const m of messages) {
    if (m.role === 'assistant') {
      const metrics = listStageMetrics(m.id)
      if (metrics.length > 0) stageMetrics[m.id] = metrics
    }
  }
  const turns: TurnInput[] = messages.map((m) => ({
    id: m.id,
    conversationId: m.conversationId,
    role: m.role,
    content: m.content,
    model: m.model,
    timestamp: m.timestamp,
    reasoning: m.reasoning,
    toolCalls: m.toolCalls
  }))
  let title: string | null
  try {
    const conv = convStore.getConversation(conversationId)
    title = conv?.title ?? null
  } catch {
    title = null
  }
  return {
    conversationId,
    conversationTitle: title,
    generatedAt: Date.now(),
    turns,
    stageMetrics
  }
}

export function registerReasoningTraceHandlers(): void {
  ipcMain.handle(
    'reasoning-trace:export',
    async (
      _event,
      payload: { conversationId: string; format: ExportFormat }
    ): Promise<{ success: boolean; data?: { path: string }; error?: string }> => {
      try {
        if (!payload || typeof payload !== 'object') {
          return { success: false, error: 'reasoning-trace:export expects {conversationId, format}.' }
        }
        const { conversationId, format } = payload
        if (typeof conversationId !== 'string' || !conversationId.trim()) {
          return { success: false, error: 'conversationId required.' }
        }
        if (format !== 'md' && format !== 'csv') {
          return { success: false, error: `unsupported format "${format}". Use 'md' or 'csv'.` }
        }

        const input = buildExportInput(conversationId)
        const body = format === 'md' ? toMarkdown(input) : toCsv(input)

        const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
        const dlgRes = await dialog.showSaveDialog(win!, {
          title: 'Export reasoning trace',
          defaultPath: safeFilename(conversationId, format),
          filters:
            format === 'md'
              ? [{ name: 'Markdown', extensions: ['md'] }]
              : [{ name: 'CSV', extensions: ['csv'] }]
        })
        if (dlgRes.canceled || !dlgRes.filePath) {
          return { success: false, error: 'cancelled' }
        }
        await writeFile(dlgRes.filePath, body, 'utf8')
        return { success: true, data: { path: dlgRes.filePath } }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err)
        }
      }
    }
  )
}
