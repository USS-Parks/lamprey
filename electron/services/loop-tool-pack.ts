import { scheduleWakeup } from './loop-runner'
import { toolRegistry } from './tool-registry'
import {
  applyLoopEnqueue,
  applyLoopCompleteTask,
  applyLoopControl,
  productionLoopToolStore,
  type LoopControlAction
} from './loop-tool-logic'

toolRegistry.registerNative(
  {
    id: 'schedule_wakeup',
    name: 'schedule_wakeup',
    title: 'Schedule wake-up',
    description:
      'Schedule a follow-up prompt in the current conversation after a delay. Use this for self-paced loops, deferred checks, and reminders that should re-enter the conversation.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        delaySeconds: {
          type: 'number',
          description: 'Delay before the wake-up fires, in seconds.'
        },
        prompt: {
          type: 'string',
          description: 'Prompt to append as the scheduled user wake-up.'
        },
        reason: {
          type: 'string',
          description: 'Short reason shown in the wake-up pill.'
        }
      },
      required: ['delaySeconds', 'prompt'],
      additionalProperties: false
    },
    risks: ['write'],
    requiresApproval: false,
    enabled: true
  },
  async (args, ctx) => {
    if (!ctx.conversationId) {
      throw new Error('schedule_wakeup requires an active conversation')
    }
    const wakeup = scheduleWakeup({
      conversationId: ctx.conversationId,
      delaySeconds: Number(args.delaySeconds),
      prompt: String(args.prompt ?? ''),
      reason: typeof args.reason === 'string' ? args.reason : null
    })
    return JSON.stringify({
      scheduled: true,
      id: wakeup.id,
      fireAt: wakeup.fireAt,
      reason: wakeup.reason
    })
  }
)

// LP-4 — model-callable loop-control tools. Meaningful only when the current
// conversation has an active loop (resolved from ctx.conversationId); otherwise
// they return a clear { ok:false } so the model learns it isn't in a loop.

toolRegistry.registerNative(
  {
    id: 'loop_enqueue',
    name: 'loop_enqueue',
    title: 'Enqueue loop tasks',
    description:
      'Append one or more tasks to the current loop\'s backlog queue. Use this in an autonomous loop to grow the work list as you discover new tasks.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task descriptions to append to the backlog, in order.'
        }
      },
      required: ['tasks'],
      additionalProperties: false
    },
    risks: ['write'],
    requiresApproval: false,
    enabled: true
  },
  async (args, ctx) => {
    if (!ctx.conversationId) throw new Error('loop_enqueue requires an active conversation')
    const tasks = Array.isArray(args.tasks) ? (args.tasks as unknown[]).map((t) => String(t)) : []
    return JSON.stringify(applyLoopEnqueue(productionLoopToolStore(), ctx.conversationId, tasks))
  }
)

toolRegistry.registerNative(
  {
    id: 'loop_complete_task',
    name: 'loop_complete_task',
    title: 'Complete loop task',
    description:
      'Mark the current in-progress backlog task done and record a short outcome. Use this when you finish the task the loop handed you, so the progress ledger stays accurate and the work is not repeated.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        result: { type: 'string', description: 'A short outcome summary for the completed task.' }
      },
      required: ['result'],
      additionalProperties: false
    },
    risks: ['write'],
    requiresApproval: false,
    enabled: true
  },
  async (args, ctx) => {
    if (!ctx.conversationId) throw new Error('loop_complete_task requires an active conversation')
    return JSON.stringify(
      applyLoopCompleteTask(productionLoopToolStore(), ctx.conversationId, String(args.result ?? ''), Date.now())
    )
  }
)

toolRegistry.registerNative(
  {
    id: 'loop_control',
    name: 'loop_control',
    title: 'Control the loop',
    description:
      'Steer the current loop: pause it, stop it, declare the mission complete, or continue with a chosen delay (self-paced cadence). Use mission_complete when there is nothing left worth doing.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['pause', 'stop', 'mission_complete', 'continue'],
          description: 'What to do with the loop.'
        },
        reason: { type: 'string', description: 'Short reason (shown in the UI / stop_reason).' },
        delaySeconds: {
          type: 'number',
          description: 'For action=continue: seconds until the next iteration (clamped to a floor).'
        }
      },
      required: ['action'],
      additionalProperties: false
    },
    risks: ['write'],
    requiresApproval: false,
    enabled: true
  },
  async (args, ctx) => {
    if (!ctx.conversationId) throw new Error('loop_control requires an active conversation')
    const action = String(args.action ?? '') as LoopControlAction
    return JSON.stringify(
      applyLoopControl(productionLoopToolStore(), ctx.conversationId, action, {
        reason: typeof args.reason === 'string' ? args.reason : undefined,
        delaySeconds: typeof args.delaySeconds === 'number' ? args.delaySeconds : undefined,
        now: Date.now()
      })
    )
  }
)
