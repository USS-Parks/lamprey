import { BrowserWindow, Notification } from 'electron'

export interface PushNotificationInput {
  title: string
  body: string
  deepLink?: string | null
}

export interface PushNotificationResult {
  shown: boolean
  reason?: string
}

export function pushNotification(input: PushNotificationInput): PushNotificationResult {
  if (!input.title || typeof input.title !== 'string') {
    throw new Error('title required')
  }
  if (!input.body || typeof input.body !== 'string') {
    throw new Error('body required')
  }
  if (!Notification.isSupported()) {
    return { shown: false, reason: 'notifications unsupported' }
  }
  const notification = new Notification({
    title: input.title,
    body: input.body
  })
  notification.on('click', () => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      win.webContents.send('notifications:clicked', {
        title: input.title,
        body: input.body,
        deepLink: input.deepLink ?? null
      })
    }
  })
  notification.show()
  return { shown: true }
}
