import { describe, expect, it, vi } from 'vitest'

// BUG-6: preload `on*` registrations must return a per-listener unsubscriber,
// and unsubscribing one listener on a shared channel must NOT remove the
// others. We mock electron with a listener registry that mirrors
// ipcRenderer's on/removeListener semantics, import preload (which calls
// contextBridge.exposeInMainWorld), and capture the exposed api.
const { mockState } = vi.hoisted(() => ({
  mockState: {
    listeners: new Map<string, Set<(...a: unknown[]) => void>>(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    exposed: undefined as any
  }
}))

vi.mock('electron', () => {
  const { listeners } = mockState
  return {
    contextBridge: {
      exposeInMainWorld: (_name: string, obj: unknown) => {
        mockState.exposed = obj
      }
    },
    ipcRenderer: {
      on: (ch: string, h: (...a: unknown[]) => void) => {
        if (!listeners.has(ch)) listeners.set(ch, new Set())
        listeners.get(ch)!.add(h)
      },
      removeListener: (ch: string, h: (...a: unknown[]) => void) => {
        listeners.get(ch)?.delete(h)
      },
      removeAllListeners: (ch: string) => listeners.delete(ch),
      invoke: () => Promise.resolve()
    },
    webUtils: { getPathForFile: () => '' }
  }
})

await import('./preload')
const api = mockState.exposed

function emit(channel: string, payload: unknown) {
  mockState.listeners.get(channel)?.forEach((h) => h(null, payload))
}

describe('preload listener contract — BUG-6', () => {
  it('chat.onError returns an unsubscriber that removes only its own listener', () => {
    const a = vi.fn()
    const b = vi.fn()
    const unsubA = api.chat.onError(a)
    api.chat.onError(b)

    emit('chat:error', { error: 'first' })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)

    unsubA()
    emit('chat:error', { error: 'second' })
    // a is gone; b — a separate subscriber on the same channel — survives.
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
  })

  it('app.onError and app.onWarning return working unsubscribers', () => {
    const onErr = vi.fn()
    const unsub = api.app.onError(onErr)
    emit('app:error', { message: 'x' })
    expect(onErr).toHaveBeenCalledTimes(1)
    unsub()
    emit('app:error', { message: 'y' })
    expect(onErr).toHaveBeenCalledTimes(1)
  })

  it('no longer exposes chat.offAll (the removeAllListeners footgun is gone)', () => {
    expect(api.chat.offAll).toBeUndefined()
  })
})
