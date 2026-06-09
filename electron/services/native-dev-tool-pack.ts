import { toolRegistry } from './tool-registry'
import {
  executeViewImage,
  executeReadThreadTerminal,
  executeLoadWorkspaceDependencies,
  executeRequestPermissions,
  type ViewImageArgs,
  type ReadThreadTerminalArgs,
  type RequestPermissionsArgs
} from './native-aux-tools'
import {
  applyUpdatePlan,
  createGoal,
  getGoal,
  listGoals,
  updateGoal,
  type CreateGoalInput,
  type UpdateGoalInput,
  type UpdatePlanInput
} from './plan-goal-store'

toolRegistry.registerNative(
  {
    id: 'view_image',
    name: 'view_image',
    title: 'View image',
    description:
      'Register a local image file as a viewable artifact. Validates the path resolves inside the workspace or the userData artifacts directory, the extension is png/jpg/jpeg/gif/webp/bmp, and the file is at most 20 MB. Returns the resolved absolute path, byte size, and detected MIME type so the chat UI can render it.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Absolute path or path relative to the workspace root. Must resolve inside the workspace or the userData artifacts directory.'
        },
        description: {
          type: 'string',
          description: 'Optional caption describing what the image shows.'
        }
      },
      required: ['path'],
      additionalProperties: false
    },
    risks: ['read'],
    requiresApproval: false,
    enabled: true,
    parallelizable: true
  },
  async (args, ctx) =>
    executeViewImage(args as unknown as ViewImageArgs, ctx.workspacePath ?? process.cwd())
)

toolRegistry.registerNative(
  {
    id: 'read_thread_terminal',
    name: 'read_thread_terminal',
    title: 'Read terminal output',
    description:
      'Return the tail (~50 KB) of the rolling stdout/stderr buffer for an active terminal session. If terminal_id is omitted the most-recently-active session is used. Returns "no active terminal sessions" when none exist.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        terminal_id: {
          type: 'string',
          description:
            'Optional terminal/PTY session id. When omitted, the most-recently-active session is used.'
        }
      },
      additionalProperties: false
    },
    risks: ['read'],
    requiresApproval: false,
    enabled: true,
    parallelizable: true
  },
  async (args) => executeReadThreadTerminal(args as unknown as ReadThreadTerminalArgs)
)

toolRegistry.registerNative(
  {
    id: 'load_workspace_dependencies',
    name: 'load_workspace_dependencies',
    title: 'Load workspace dependencies',
    description:
      'Report the runtime dependencies available to Lamprey: the embedded Node runtime version + path, an optional Python interpreter (probed from PATH), and a list of bundled helper script paths. Returns a JSON-encoded summary.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    risks: ['read'],
    requiresApproval: false,
    enabled: true,
    parallelizable: true
  },
  async () => executeLoadWorkspaceDependencies()
)

toolRegistry.registerNative(
  {
    id: 'request_permissions',
    name: 'request_permissions',
    title: 'Request permission',
    description:
      'Ask the user to grant a permission scope before performing a risky action. Useful when the model wants to escalate from read-only to a write or destructive capability. Returns "Approved (scope=...)" or "Denied (scope=...)". Allowed scopes: shell, network, write_workspace, destructive_fs, browser_destructive, secret_access, read_workspace, write_path, read_path.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: [
            'shell',
            'network',
            'write_workspace',
            'destructive_fs',
            'browser_destructive',
            'secret_access',
            'read_workspace',
            'write_path',
            'read_path'
          ],
          description: 'The permission scope being requested.'
        },
        reason: {
          type: 'string',
          description: 'Human-readable justification shown to the user in the approval dialog.'
        },
        path: {
          type: 'string',
          description: 'Optional path the permission applies to (for path-scoped requests).'
        }
      },
      required: ['scope', 'reason'],
      additionalProperties: false
    },
    // The handler IS the approval call, so this tool self-approves: the
    // dispatcher must not gate it, or we'd double-prompt — and a global "deny
    // secret" policy would otherwise block the user from ever requesting any
    // permission. The 'secret' risk is kept only so the UI surfaces the
    // escalation badge; `selfApproves` suppresses the dispatch-time modal.
    risks: ['secret'],
    requiresApproval: false,
    selfApproves: true,
    enabled: true,
    transcriptHidden: true
  },
  async (args, ctx) =>
    executeRequestPermissions(args as unknown as RequestPermissionsArgs, ctx)
)

toolRegistry.registerNative(
  {
    id: 'update_plan',
    name: 'update_plan',
    title: 'Update plan',
    description:
      'Set or amend the current plan for this conversation. Each step has a text label and a status (pending / in_progress / done). When `replace` is true the existing plan is wiped and replaced; otherwise incoming steps with matching ids update existing steps, and steps without ids (or with new ids) are appended. Returns a JSON snapshot of the plan.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          description: 'Plan steps to merge or replace.',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Optional stable id; required when updating an existing step.'
              },
              text: { type: 'string', description: 'Step description.' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'done'],
                description: 'Step status: pending, in_progress, or done.'
              }
            },
            required: ['text']
          }
        },
        replace: {
          type: 'boolean',
          description: 'When true, the existing plan is replaced wholesale by `steps`. Defaults to false.'
        }
      },
      required: ['steps'],
      additionalProperties: false
    },
    risks: ['write'],
    requiresApproval: false,
    enabled: true
  },
  async (args, ctx) => {
    const snapshot = applyUpdatePlan(ctx.conversationId, args as unknown as UpdatePlanInput)
    return JSON.stringify(snapshot, null, 2)
  }
)

toolRegistry.registerNative(
  {
    id: 'get_goal',
    name: 'get_goal',
    title: 'Get goal',
    description:
      'Return one goal (when `goal_id` is supplied) or all goals for the current conversation. Returns a JSON-encoded goal or array of goals; an unknown goal_id resolves to `null`.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        goal_id: {
          type: 'string',
          description: 'Optional goal id. When omitted, all goals for the conversation are returned.'
        }
      },
      additionalProperties: false
    },
    risks: ['read'],
    requiresApproval: false,
    enabled: true,
    parallelizable: true
  },
  async (args, ctx) => {
    const goalId = (args as Record<string, unknown>)?.goal_id
    if (typeof goalId === 'string' && goalId.length > 0) {
      return JSON.stringify(getGoal(ctx.conversationId, goalId), null, 2)
    }
    return JSON.stringify(listGoals(ctx.conversationId), null, 2)
  }
)

toolRegistry.registerNative(
  {
    id: 'create_goal',
    name: 'create_goal',
    title: 'Create goal',
    description:
      'Create a new goal for this conversation. Returns the created goal as JSON, including its generated id and timestamps. Status starts at "open".',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short goal title.' },
        description: { type: 'string', description: 'Optional longer description.' },
        due_date: {
          type: 'string',
          description: 'Optional ISO-formatted due date (free-form string; not validated).'
        }
      },
      required: ['title'],
      additionalProperties: false
    },
    risks: ['write'],
    requiresApproval: false,
    enabled: true
  },
  async (args, ctx) => {
    const a = args as Record<string, unknown>
    const input: CreateGoalInput = {
      title: String(a.title ?? ''),
      description: typeof a.description === 'string' ? a.description : undefined,
      dueDate: typeof a.due_date === 'string' ? a.due_date : undefined
    }
    const goal = createGoal(ctx.conversationId, input)
    return JSON.stringify(goal, null, 2)
  }
)

toolRegistry.registerNative(
  {
    id: 'update_goal',
    name: 'update_goal',
    title: 'Update goal',
    description:
      'Update fields on an existing goal. Returns the updated goal as JSON. Status transitions: open / in_progress / done / abandoned.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        goal_id: { type: 'string', description: 'Id of the goal to update.' },
        title: { type: 'string', description: 'Optional new title for the goal.' },
        description: { type: 'string', description: 'Optional new description for the goal.' },
        due_date: { type: 'string', description: 'Optional new due date (ISO format).' },
        status: {
          type: 'string',
          enum: ['open', 'in_progress', 'done', 'abandoned'],
          description: 'Optional new status: open, in_progress, done, or abandoned.'
        }
      },
      required: ['goal_id'],
      additionalProperties: false
    },
    risks: ['write'],
    requiresApproval: false,
    enabled: true
  },
  async (args, ctx) => {
    const a = args as Record<string, unknown>
    if (typeof a.goal_id !== 'string' || a.goal_id.length === 0) {
      throw new Error('update_goal: "goal_id" is required.')
    }
    const input: UpdateGoalInput = {
      goalId: a.goal_id,
      title: typeof a.title === 'string' ? a.title : undefined,
      description: typeof a.description === 'string' ? a.description : undefined,
      dueDate: typeof a.due_date === 'string' ? a.due_date : undefined,
      status: typeof a.status === 'string' ? (a.status as UpdateGoalInput['status']) : undefined
    }
    // updateGoal throws on unknown goal id; let it propagate so chat.ts
    // marks the call as 'error' instead of pretending success.
    const goal = updateGoal(ctx.conversationId, input)
    return JSON.stringify(goal, null, 2)
  }
)
