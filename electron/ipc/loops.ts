import { ipcMain } from 'electron'
import {
  cancelWakeup,
  listWakeups,
  scheduleWakeup,
  type LoopWakeupStatus
} from '../services/loop-runner'
import {
  createLoop,
  getLoop,
  listLoops,
  updateLoop,
  deleteLoop,
  listBacklog,
  enqueueBacklog,
  reorderBacklog,
  removeBacklogItem,
  listLoopRuns,
  type LoopMode,
  type LoopStatus
} from '../services/loop-store'
import { readLoopConfig } from '../services/loop-config'
import { createConversation, getConversation } from '../services/conversation-store'

export function registerLoopsHandlers(): void {
  ipcMain.handle(
    'loops:schedule',
    async (
      _event,
      input: {
        conversationId: string
        delaySeconds: number
        prompt: string
        reason?: string | null
      }
    ) => {
      try {
        return { success: true, data: scheduleWakeup(input) }
      } catch (err) {
        return { success: false, error: messageFor(err, 'schedule failed') }
      }
    }
  )

  ipcMain.handle('loops:cancel', async (_event, id: string) => {
    try {
      return { success: true, data: { cancelled: cancelWakeup(id) } }
    } catch (err) {
      return { success: false, error: messageFor(err, 'cancel failed') }
    }
  })

  ipcMain.handle(
    'loops:list',
    async (
      _event,
      filter?: {
        conversationId?: string
        status?: LoopWakeupStatus | LoopWakeupStatus[]
        limit?: number
      }
    ) => {
      try {
        return { success: true, data: listWakeups(filter) }
      } catch (err) {
        return { success: false, error: messageFor(err, 'list failed') }
      }
    }
  )

  // ---- LP-7: loop entities (distinct from the one-shot wake-ups above) ----

  ipcMain.handle(
    'loops:create',
    async (
      _event,
      input: {
        mode: LoopMode
        conversationId?: string
        instruction?: string
        model?: string
        intervalSeconds?: number
        tasks?: string[]
      }
    ) => {
      try {
        const cfg = readLoopConfig()
        if (!cfg.enabled) {
          return { success: false, error: 'Loops are disabled. Enable them in Settings → Loops.' }
        }
        const mode = input?.mode
        if (mode !== 'interval' && mode !== 'self_paced' && mode !== 'autonomous') {
          return { success: false, error: 'invalid loop mode' }
        }
        const model = input.model || 'deepseek-v4-pro'
        let conversationId = input.conversationId
        if (!conversationId || !getConversation(conversationId)) {
          conversationId = createConversation(model).id
        }
        const instruction = input.instruction?.trim() || null
        const tasks = (Array.isArray(input.tasks) ? input.tasks : [])
          .map((t) => String(t ?? '').trim())
          .filter(Boolean)
        const seedTasks = tasks.length > 0 ? tasks : instruction ? [instruction] : []
        if (seedTasks.length === 0) {
          return { success: false, error: 'a loop needs at least one task or an instruction' }
        }
        const loop = createLoop({
          conversationId,
          mode,
          instruction,
          model,
          intervalSeconds: typeof input.intervalSeconds === 'number' ? input.intervalSeconds : null,
          maxIterations: cfg.maxIterations,
          maxWallclockMs: cfg.maxWallclockMs,
          tokenBudget: cfg.tokenBudget,
          nextFireAt: Date.now()
        })
        enqueueBacklog(loop.id, seedTasks)
        return { success: true, data: loop }
      } catch (err) {
        return { success: false, error: messageFor(err, 'create failed') }
      }
    }
  )

  ipcMain.handle(
    'loops:listLoops',
    async (_event, filter?: { conversationId?: string; status?: LoopStatus | LoopStatus[]; limit?: number }) => {
      try {
        return { success: true, data: listLoops(filter) }
      } catch (err) {
        return { success: false, error: messageFor(err, 'list loops failed') }
      }
    }
  )

  ipcMain.handle('loops:getLoop', async (_event, id: string) => {
    try {
      return { success: true, data: getLoop(id) }
    } catch (err) {
      return { success: false, error: messageFor(err, 'get loop failed') }
    }
  })

  ipcMain.handle('loops:pause', async (_event, id: string) => {
    try {
      return { success: true, data: updateLoop(id, { status: 'paused', nextFireAt: null }) }
    } catch (err) {
      return { success: false, error: messageFor(err, 'pause failed') }
    }
  })

  ipcMain.handle('loops:resume', async (_event, id: string) => {
    try {
      if (!readLoopConfig().enabled) {
        return { success: false, error: 'Loops are disabled. Enable them in Settings → Loops.' }
      }
      return { success: true, data: updateLoop(id, { status: 'running', nextFireAt: Date.now() }) }
    } catch (err) {
      return { success: false, error: messageFor(err, 'resume failed') }
    }
  })

  ipcMain.handle('loops:stop', async (_event, id: string, reason?: string) => {
    try {
      return {
        success: true,
        data: updateLoop(id, { status: 'stopped', stopReason: reason || 'user-stop', nextFireAt: null })
      }
    } catch (err) {
      return { success: false, error: messageFor(err, 'stop failed') }
    }
  })

  ipcMain.handle('loops:deleteLoop', async (_event, id: string) => {
    try {
      return { success: true, data: { deleted: deleteLoop(id) } }
    } catch (err) {
      return { success: false, error: messageFor(err, 'delete failed') }
    }
  })

  ipcMain.handle('loops:listBacklog', async (_event, loopId: string) => {
    try {
      return { success: true, data: listBacklog(loopId) }
    } catch (err) {
      return { success: false, error: messageFor(err, 'list backlog failed') }
    }
  })

  ipcMain.handle('loops:enqueue', async (_event, loopId: string, tasks: string[]) => {
    try {
      const clean = (Array.isArray(tasks) ? tasks : []).map((t) => String(t ?? '')).filter((t) => t.trim())
      return { success: true, data: enqueueBacklog(loopId, clean) }
    } catch (err) {
      return { success: false, error: messageFor(err, 'enqueue failed') }
    }
  })

  ipcMain.handle('loops:reorderBacklog', async (_event, loopId: string, orderedIds: string[]) => {
    try {
      reorderBacklog(loopId, Array.isArray(orderedIds) ? orderedIds : [])
      return { success: true, data: listBacklog(loopId) }
    } catch (err) {
      return { success: false, error: messageFor(err, 'reorder failed') }
    }
  })

  ipcMain.handle('loops:removeBacklog', async (_event, id: string) => {
    try {
      return { success: true, data: { removed: removeBacklogItem(id) } }
    } catch (err) {
      return { success: false, error: messageFor(err, 'remove failed') }
    }
  })

  ipcMain.handle('loops:listRuns', async (_event, loopId: string, limit?: number) => {
    try {
      return { success: true, data: listLoopRuns(loopId, limit ?? 50) }
    } catch (err) {
      return { success: false, error: messageFor(err, 'list runs failed') }
    }
  })
}

function messageFor(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message || fallback
  if (typeof err === 'string') return err || fallback
  return fallback
}
