import { pushNotification } from './notifications-service'
import { sendSessionMessage } from './cross-session-messaging'
import { toolRegistry } from './tool-registry'

toolRegistry.registerNative(
  {
    id: 'push_notification',
    name: 'push_notification',
    title: 'Push notification',
    description: 'Show an OS notification to the user. Optionally include a deep link such as conversation:<id>.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Notification title.' },
        body: { type: 'string', description: 'Notification body text.' },
        deepLink: { type: 'string', description: 'Optional deep link, e.g. conversation:<id>.' }
      },
      required: ['title', 'body'],
      additionalProperties: false
    },
    risks: ['write'],
    requiresApproval: false,
    enabled: true
  },
  async (args) => {
    const result = pushNotification({
      title: String(args.title ?? ''),
      body: String(args.body ?? ''),
      deepLink: typeof args.deepLink === 'string' ? args.deepLink : null
    })
    return JSON.stringify(result)
  }
)

toolRegistry.registerNative(
  {
    id: 'send_to_session',
    name: 'send_to_session',
    title: 'Send to session',
    description:
      'Send a task notification to another conversation/session. It appears in that session on its next model turn.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        targetSessionId: { type: 'string', description: 'Target conversation/session ID.' },
        body: { type: 'string', description: 'Message body to send to the target session.' }
      },
      required: ['targetSessionId', 'body'],
      additionalProperties: false
    },
    risks: ['write'],
    requiresApproval: false,
    enabled: true
  },
  async (args, ctx) => {
    const message = sendSessionMessage({
      targetSessionId: String(args.targetSessionId ?? ''),
      body: String(args.body ?? ''),
      fromSessionId: ctx.conversationId ?? null
    })
    return JSON.stringify({ sent: true, id: message.id, targetSessionId: message.targetSessionId })
  }
)
