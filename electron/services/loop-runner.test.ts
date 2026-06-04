import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const TEST_USER_DATA = join(tmpdir(), `lamprey-loops-test-${process.pid}-${Date.now()}`)

vi.mock('electron', () => ({
  app: { getPath: () => TEST_USER_DATA },
  BrowserWindow: { getAllWindows: () => [] }
}))

import { createConversation, getMessages } from './conversation-store'
import { __resetDbForTests, getDb } from './database'
import { cancelWakeup, fireDueWakeups, listWakeups, scheduleWakeup } from './loop-runner'

function nativeOk(): boolean {
  try {
    getDb()
    return true
  } catch {
    return false
  }
}

beforeEach(() => {
  __resetDbForTests()
  if (existsSync(TEST_USER_DATA)) {
    rmSync(TEST_USER_DATA, { recursive: true, force: true })
  }
  mkdirSync(TEST_USER_DATA, { recursive: true })
})

afterAll(() => {
  __resetDbForTests()
  if (existsSync(TEST_USER_DATA)) {
    rmSync(TEST_USER_DATA, { recursive: true, force: true })
  }
})

describe('G2 loop wake-ups', () => {
  it.skipIf(!nativeOk())('schedules and fires due wake-ups as user messages', () => {
    const conv = createConversation('deepseek-chat')
    const wakeup = scheduleWakeup({
      conversationId: conv.id,
      delaySeconds: 0,
      prompt: 'Check whether the build finished.',
      reason: 'build check'
    })

    expect(listWakeups({ conversationId: conv.id, status: 'pending' })).toHaveLength(1)
    const fired = fireDueWakeups(Date.now() + 1)

    expect(fired.map((w) => w.id)).toEqual([wakeup.id])
    expect(listWakeups({ conversationId: conv.id, status: 'fired' })).toHaveLength(1)
    const messages = getMessages(conv.id)
    expect(messages[messages.length - 1].role).toBe('user')
    expect(messages[messages.length - 1].content).toContain('[scheduled wake-up] build check')
    expect(messages[messages.length - 1].content).toContain('Check whether the build finished.')
  })

  it.skipIf(!nativeOk())('cancels pending wake-ups before they fire', () => {
    const conv = createConversation('deepseek-chat')
    const wakeup = scheduleWakeup({
      conversationId: conv.id,
      delaySeconds: 0,
      prompt: 'Do not fire.',
      reason: 'cancel test'
    })

    expect(cancelWakeup(wakeup.id)).toBe(true)
    expect(fireDueWakeups(Date.now() + 1)).toEqual([])
    expect(getMessages(conv.id)).toEqual([])
    expect(listWakeups({ status: 'cancelled' }).map((w) => w.id)).toEqual([wakeup.id])
  })
})
