import { ipcMain, BrowserWindow } from 'electron'
import {
  runWorkflow,
  type WorkflowProgressEvent,
  type WorkflowRunHandle,
  type WorkflowRunnerDeps
} from '../services/workflow-runner'
import {
  forkAgent,
  type ForkAgentDeps,
  type ForkAgentRunner
} from '../services/subagent-runner'
import { realAgentRunStore } from '../services/agent-run-store'
import { broadcastAgentRunEvent } from './tasks'
import {
  getWorkflow,
  listWorkflows,
  saveUserWorkflow,
  validateWorkflowSource
} from '../services/workflow-library'
import * as memStore from '../services/memory-store'
import { getAskUserRuntime } from '../services/ask-user-runtime'

// Track 1 / B1: workflows:* IPC + workflow:progress broadcast wiring.
//
// B1 ships the in-memory run registry + IPC entrypoints. B2 layers the
// journal on top (run journals to disk + resumeFromRunId). B3 wires the
// renderer panel that subscribes to the broadcast. B4 ships the library.
//
// Production callers register a chat-provider-backed ForkAgentRunner via
// setWorkflowChatRunner(). Until that's called (e.g., before the model
// settings are loaded), runInline returns a structured error.

const liveWorkflows = new Map<string, WorkflowRunHandle>()

let chatRunner: ForkAgentRunner | null = null
let defaultModel: string | null = null

export function setWorkflowChatRunner(args: {
  runner: ForkAgentRunner
  defaultModel: string
}): void {
  chatRunner = args.runner
  defaultModel = args.defaultModel
}

export function broadcastWorkflowProgress(event: WorkflowProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('workflow:progress', event)
  }
}

function buildForkDeps(): ForkAgentDeps {
  if (!chatRunner || !defaultModel) {
    throw new Error(
      'workflows: chat runner not yet registered; call setWorkflowChatRunner({runner, defaultModel}) at startup'
    )
  }
  return {
    runner: chatRunner,
    defaultModel,
    agentRunStore: realAgentRunStore,
    notify: broadcastAgentRunEvent
  }
}

function buildDeps(): WorkflowRunnerDeps {
  return {
    forkSeam: {
      forkAgent,
      forkDeps: buildForkDeps()
    },
    progress: broadcastWorkflowProgress,
    loadNamedWorkflow: (name: string) => {
      const entry = getWorkflow(name)
      if (!entry) throw new Error(`workflow "${name}" not found in library`)
      return entry.source
    },
    memory: {
      list: (filter?: unknown) => memStore.listMemoryFiles(parseMemoryFilter(filter)),
      write: (input: unknown) => {
        if (!input || typeof input !== 'object') {
          throw new Error('memory.write requires an object')
        }
        return memStore.writeMemoryFile(input as Parameters<typeof memStore.writeMemoryFile>[0])
      },
      delete: (name: string) => memStore.deleteMemoryFile(name)
    },
    askUser: async (input) => {
      const runtime = getAskUserRuntime()
      if (!runtime) {
        throw new Error('ask-user runtime not initialised — registerAskUserHandlers not called')
      }
      return runtime.ask(input)
    }
  }
}

function parseMemoryFilter(filter?: unknown): memStore.MemoryListFilter | undefined {
  if (!filter || typeof filter !== 'object') return undefined
  const f = filter as Record<string, unknown>
  const parsed: memStore.MemoryListFilter = {}
  if (typeof f.type === 'string' && ['user', 'feedback', 'project', 'reference'].includes(f.type)) {
    parsed.type = f.type as memStore.MemoryListFilter['type']
  }
  if (typeof f.projectSlug === 'string' && f.projectSlug.trim()) {
    parsed.projectSlug = f.projectSlug.trim()
  }
  return parsed
}

export function registerWorkflowsHandlers(): void {
  // List currently-running workflows + library entries.
  ipcMain.handle('workflows:list', async () => {
    try {
      const live = [...liveWorkflows.entries()].map(([runId, _h]) => ({
        runId,
        status: 'running' as const
      }))
      const library = listWorkflows().map((e) => ({
        name: e.name,
        description: e.description,
        origin: e.origin
      }))
      return { success: true, data: { live, library } }
    } catch (err: unknown) {
      return { success: false, error: messageFor(err, 'list failed') }
    }
  })

  ipcMain.handle('workflows:validate', async (_e, input: { script: string }) => {
    try {
      if (!input || typeof input.script !== 'string') {
        return { success: false, error: 'script required' }
      }
      return { success: true, data: validateWorkflowSource(input.script) }
    } catch (err: unknown) {
      return { success: false, error: messageFor(err, 'validate failed') }
    }
  })

  ipcMain.handle('workflows:save', async (_e, input: { script: string }) => {
    try {
      if (!input || typeof input.script !== 'string') {
        return { success: false, error: 'script required' }
      }
      const entry = saveUserWorkflow(input.script)
      return {
        success: true,
        data: {
          name: entry.name,
          description: entry.description,
          origin: entry.origin,
          filePath: entry.filePath
        }
      }
    } catch (err: unknown) {
      return { success: false, error: messageFor(err, 'save failed') }
    }
  })

  ipcMain.handle(
    'workflows:runInline',
    async (
      _e,
      input: { script: string; args?: unknown; budgetTotal?: number | null; concurrencyCap?: number; timeoutMs?: number }
    ) => {
      try {
        if (!input || typeof input.script !== 'string') {
          return { success: false, error: 'script required' }
        }
        const deps = buildDeps()
        const handle = runWorkflow(
          {
            script: input.script,
            args: input.args,
            budgetTotal: input.budgetTotal ?? null,
            concurrencyCap: input.concurrencyCap,
            timeoutMs: input.timeoutMs
          },
          deps
        )
        liveWorkflows.set(handle.runId, handle)
        handle.promise.finally(() => liveWorkflows.delete(handle.runId)).catch(() => {})
        // Don't await — IPC returns the runId immediately so the renderer
        // can subscribe to workflow:progress and render the live tree.
        return { success: true, data: { runId: handle.runId } }
      } catch (err: unknown) {
        return { success: false, error: messageFor(err, 'runInline failed') }
      }
    }
  )

  // Named-workflow invocation — resolves a library entry by name and runs it.
  ipcMain.handle('workflows:run', async (_e, input: { name: string; args?: unknown }) => {
    try {
      if (!input || typeof input.name !== 'string' || !input.name) {
        return { success: false, error: 'name required' }
      }
      const entry = getWorkflow(input.name)
      if (!entry) return { success: false, error: `workflow "${input.name}" not found` }
      const deps = buildDeps()
      const handle = runWorkflow(
        { script: entry.source, args: input.args },
        deps
      )
      liveWorkflows.set(handle.runId, handle)
      handle.promise.finally(() => liveWorkflows.delete(handle.runId)).catch(() => {})
      return { success: true, data: { runId: handle.runId, name: entry.name } }
    } catch (err: unknown) {
      return { success: false, error: messageFor(err, 'run failed') }
    }
  })

  ipcMain.handle('workflows:stop', async (_e, runId: string) => {
    try {
      if (typeof runId !== 'string' || !runId) {
        return { success: false, error: 'runId required' }
      }
      const handle = liveWorkflows.get(runId)
      if (!handle) return { success: false, error: 'not found or already finished' }
      handle.abort('user-stop')
      return { success: true, data: { stopped: true } }
    } catch (err: unknown) {
      return { success: false, error: messageFor(err, 'stop failed') }
    }
  })
}

function messageFor(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message || fallback
  if (typeof err === 'string') return err || fallback
  return fallback
}
