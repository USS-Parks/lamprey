import { ipcMain, dialog, BrowserWindow } from 'electron'
import {
  runDeepResearch,
  registerRun,
  deregisterRun,
  cancelRun,
  recordProgress,
  getRunStatus,
  listActiveRuns,
  type ResearchProgress
} from '../services/research'
import {
  downloadResearchArtifact,
  listResearchArtifacts,
  readResearchArtifact
} from '../services/research-artifacts-store'
import { emitChatEvent } from '../services/chat-events'
import type { DepthTier } from '../services/research/intent'

// IPC surface for the deep-research pipeline.
//
//   research:start  — kicks off a run, returns {runId} immediately. The
//                     run completes asynchronously; progress events
//                     stream via emitChatEvent('research:progress').
//                     The completion outcome is delivered via the
//                     standard chat-events path so the renderer's
//                     existing subscription model works unchanged.
//   research:cancel — aborts an active run by id.
//   research:status — returns the most recent progress snapshot.
//   research:list   — returns metadata about every active run (used by
//                     a future activity dashboard; D12 banner uses the
//                     event-stream not this).

interface StartRequest {
  question: string
  depth?: DepthTier
  conversationId: string
}

function isValidDepth(v: unknown): v is DepthTier {
  return v === 'quick' || v === 'standard' || v === 'exhaustive'
}

function isStartRequest(v: unknown): v is StartRequest {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return typeof r.question === 'string' && typeof r.conversationId === 'string'
}

export function registerResearchHandlers(): void {
  ipcMain.handle('research:start', async (_event, request: unknown) => {
    try {
      if (!isStartRequest(request)) {
        return { success: false, error: 'Invalid research:start request shape.' }
      }
      const depth: DepthTier = isValidDepth(request.depth) ? request.depth : 'standard'

      // Spawn the run asynchronously so the renderer call returns
      // immediately with a runId; outcome + progress flow through
      // chat-events.
      const controller = new AbortController()
      let runId = ''
      // Use the synchronous registerRun + the runId from inside the
      // orchestrator — since runDeepResearch generates its own runId we
      // need to capture it from the first progress event.
      const onProgress = (p: ResearchProgress) => {
        if (!runId) {
          runId = p.runId
          registerRun(runId, controller, request.conversationId)
        }
        recordProgress(p.runId, p)
        emitChatEvent('research:progress', { ...p })
      }

      void (async () => {
        try {
          const outcome = await runDeepResearch({
            question: request.question,
            depth,
            conversationId: request.conversationId,
            correlationId: request.conversationId,
            abortSignal: controller.signal,
            onProgress
          })
          emitChatEvent('research:completed', {
            runId: outcome.runId,
            conversationId: request.conversationId,
            artifactPath: outcome.artifactPath,
            filename: outcome.filename,
            summary: outcome.summary,
            markdown: outcome.markdown,
            sourceCount: outcome.sourceCount,
            acceptedCount: outcome.acceptedCount,
            singleSourceCount: outcome.singleSourceCount,
            disputedCount: outcome.disputedCount,
            providersUsed: outcome.providersUsed,
            elapsedMs: outcome.elapsedMs
          })
        } catch (err) {
          emitChatEvent('research:failed', {
            runId,
            conversationId: request.conversationId,
            error: (err as Error).message ?? String(err)
          })
        } finally {
          if (runId) deregisterRun(runId)
        }
      })()

      // Wait one tick so the runId can populate from the first progress event.
      await new Promise<void>((resolve) => setImmediate(resolve))

      return { success: true, data: { runId } }
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message ?? 'research:start failed'
      }
    }
  })

  ipcMain.handle('research:cancel', async (_event, runId: unknown) => {
    try {
      if (typeof runId !== 'string' || !runId) {
        return { success: false, error: 'research:cancel requires a runId string.' }
      }
      const cancelled = cancelRun(runId)
      return { success: true, data: { cancelled } }
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message ?? 'research:cancel failed'
      }
    }
  })

  ipcMain.handle('research:status', async (_event, runId: unknown) => {
    try {
      if (typeof runId !== 'string' || !runId) {
        return { success: false, error: 'research:status requires a runId string.' }
      }
      return { success: true, data: getRunStatus(runId) }
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message ?? 'research:status failed'
      }
    }
  })

  ipcMain.handle('research:list', async () => {
    try {
      return {
        success: true,
        data: {
          activeRuns: listActiveRuns(),
          artifacts: listResearchArtifacts()
        }
      }
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message ?? 'research:list failed'
      }
    }
  })

  ipcMain.handle('research:read', async (_event, filename: unknown) => {
    try {
      if (typeof filename !== 'string' || !filename) {
        return { success: false, error: 'research:read requires a filename string.' }
      }
      const r = readResearchArtifact(filename)
      if (!r) return { success: false, error: `Artifact not found: ${filename}` }
      return { success: true, data: { entry: r.entry, content: r.content } }
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message ?? 'research:read failed'
      }
    }
  })

  ipcMain.handle('research:download', async (event, filename: unknown) => {
    try {
      if (typeof filename !== 'string' || !filename) {
        return { success: false, error: 'research:download requires a filename string.' }
      }
      const focused = BrowserWindow.getFocusedWindow() ?? BrowserWindow.fromWebContents(event.sender)
      const opts: Electron.SaveDialogOptions = {
        defaultPath: filename,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      }
      const result = focused
        ? await dialog.showSaveDialog(focused, opts)
        : await dialog.showSaveDialog(opts)
      if (result.canceled || !result.filePath) {
        return { success: true, data: { saved: false } }
      }
      const ok = downloadResearchArtifact(filename, result.filePath)
      if (!ok) return { success: false, error: 'Failed to write the chosen destination.' }
      return { success: true, data: { saved: true, path: result.filePath } }
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message ?? 'research:download failed'
      }
    }
  })
}
