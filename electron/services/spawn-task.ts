import { app } from 'electron'
import { randomUUID } from 'crypto'
import { join } from 'path'
import {
  createAgentWorktreeManager,
  type WorktreeManager
} from './worktree-runner'
import * as convStore from './conversation-store'
import { enqueueAsyncEvent } from './async-event-bridge'
import { emitChatEvent } from './chat-events'

export interface SpawnTaskInput {
  sourceConversationId: string
  title: string
  prompt: string
  tldr?: string | null
  cwd?: string | null
  model?: string | null
}

export interface SpawnTaskResult {
  taskId: string
  sourceConversationId: string
  conversationId: string
  title: string
  prompt: string
  tldr: string | null
  worktreePath: string | null
  branch: string | null
}

export interface SpawnTaskDeps {
  createConversation?: typeof convStore.createConversation
  getConversation?: typeof convStore.getConversation
  updateConversationTitle?: typeof convStore.updateConversationTitle
  saveMessage?: typeof convStore.saveMessage
  enqueue?: typeof enqueueAsyncEvent
  worktreeManager?: WorktreeManager | null
  now?: () => number
}

function cleanText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`spawn_task: ${field} is required`)
  }
  return value.trim().slice(0, max)
}

function defaultWorktreeManager(cwd: string | null | undefined): WorktreeManager | null {
  if (!cwd) return null
  return createAgentWorktreeManager({
    baseCwd: cwd,
    workspacesRoot: join(app.getPath('userData'), 'spawn-worktrees')
  })
}

export async function spawnTask(
  input: SpawnTaskInput,
  deps: SpawnTaskDeps = {}
): Promise<SpawnTaskResult> {
  const sourceConversationId = cleanText(input.sourceConversationId, 'sourceConversationId', 160)
  const title = cleanText(input.title, 'title', 80)
  const prompt = cleanText(input.prompt, 'prompt', 16_000)
  const tldr =
    typeof input.tldr === 'string' && input.tldr.trim()
      ? input.tldr.trim().slice(0, 500)
      : null

  const getConversation = deps.getConversation ?? convStore.getConversation
  const createConversation = deps.createConversation ?? convStore.createConversation
  const updateConversationTitle = deps.updateConversationTitle ?? convStore.updateConversationTitle
  const saveMessage = deps.saveMessage ?? convStore.saveMessage
  const enqueue = deps.enqueue ?? enqueueAsyncEvent
  const source = getConversation(sourceConversationId)
  if (!source) throw new Error('spawn_task: source conversation not found')

  const taskId = randomUUID()
  const manager =
    deps.worktreeManager !== undefined
      ? deps.worktreeManager
      : defaultWorktreeManager(input.cwd)
  const worktree = manager ? await manager.create(taskId) : null
  const model = input.model?.trim() || source.model
  const child = createConversation(model, {
    kind: worktree ? 'worktree' : 'local',
    worktreePath: worktree?.path ?? null,
    projectId: source.projectId ?? null
  })

  updateConversationTitle(child.id, title)
  saveMessage({
    id: randomUUID(),
    conversationId: sourceConversationId,
    role: 'system',
    content: [
      `<spawned_task id="${taskId}" conversationId="${child.id}">`,
      `Title: ${title}`,
      tldr ? `Summary: ${tldr}` : null,
      `Target conversation: ${child.id}`,
      worktree ? `Worktree: ${worktree.path}` : null,
      '</spawned_task>'
    ]
      .filter(Boolean)
      .join('\n')
  })
  saveMessage({
    id: randomUUID(),
    conversationId: child.id,
    role: 'system',
    content: [
      `<spawned_from conversationId="${sourceConversationId}" taskId="${taskId}">`,
      `Source conversation: ${sourceConversationId}`,
      tldr ? `Summary: ${tldr}` : null,
      '</spawned_from>'
    ]
      .filter(Boolean)
      .join('\n')
  })
  saveMessage({
    id: randomUUID(),
    conversationId: child.id,
    role: 'user',
    content: prompt,
    model
  })

  const result: SpawnTaskResult = {
    taskId,
    sourceConversationId,
    conversationId: child.id,
    title,
    prompt,
    tldr,
    worktreePath: worktree?.path ?? null,
    branch: worktree?.branch ?? null
  }

  enqueue({
    conversationId: sourceConversationId,
    kind: 'tasks:spawn-completed',
    payload: {
      taskId,
      title,
      tldr,
      childConversationId: child.id,
      worktreePath: result.worktreePath,
      branch: result.branch
    },
    createdAt: deps.now?.() ?? Date.now()
  })

  emitChatEvent('tasks:spawned', {
    taskId: result.taskId,
    sourceConversationId: result.sourceConversationId,
    conversationId: result.conversationId,
    title: result.title,
    tldr: result.tldr,
    worktreePath: result.worktreePath,
    branch: result.branch
  })

  return result
}
