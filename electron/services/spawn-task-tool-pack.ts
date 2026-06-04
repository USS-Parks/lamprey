import { toolRegistry } from './tool-registry'
import { spawnTask } from './spawn-task'

toolRegistry.registerNative(
  {
    id: 'spawn_task',
    name: 'spawn_task',
    title: 'Spawn task',
    description:
      'Create a new linked conversation for a separable task. Use when a subproblem should continue in its own session/worktree while the current conversation stays focused. Returns the child conversation id, backlink metadata, and worktree path when one was created.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short title for the child task conversation.'
        },
        prompt: {
          type: 'string',
          description: 'Seed prompt to place in the child conversation.'
        },
        tldr: {
          type: 'string',
          description: 'Optional one-sentence summary shown on the source task chip.'
        },
        cwd: {
          type: 'string',
          description:
            'Optional repository path to use as the source for an isolated child worktree. Defaults to the active workspace.'
        }
      },
      required: ['title', 'prompt'],
      additionalProperties: false
    },
    risks: ['write'],
    requiresApproval: false,
    enabled: true,
    mutates: true
  },
  async (args, ctx) => {
    if (!ctx.conversationId) throw new Error('spawn_task requires a conversation')
    const result = await spawnTask({
      sourceConversationId: ctx.conversationId,
      title: typeof args.title === 'string' ? args.title : '',
      prompt: typeof args.prompt === 'string' ? args.prompt : '',
      tldr: typeof args.tldr === 'string' ? args.tldr : null,
      cwd: typeof args.cwd === 'string' ? args.cwd : ctx.workspacePath,
      model: ctx.model
    })
    return JSON.stringify({
      taskId: result.taskId,
      conversationId: result.conversationId,
      title: result.title,
      tldr: result.tldr,
      worktreePath: result.worktreePath,
      branch: result.branch
    })
  }
)
