import { scheduleWakeup } from './loop-runner'
import { toolRegistry } from './tool-registry'

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
