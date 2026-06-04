import { describe, it, expect, vi } from 'vitest'

vi.mock('./automations-runner', () => ({ runAutomation: vi.fn() }))
vi.mock('./automations-store', () => ({ getAutomation: vi.fn() }))
vi.mock('./chat-history', () => ({ buildApiMessagesFromStoredMessages: vi.fn() }))
vi.mock('./conversation-store', () => ({
  getConversation: vi.fn(),
  getMessages: vi.fn(),
  saveMessage: vi.fn()
}))
vi.mock('./memory-store', () => ({
  buildMemoryBlock: vi.fn(() => ''),
  buildMemoryIndexBlock: vi.fn(() => '')
}))
vi.mock('./providers/registry', () => ({ chatOnce: vi.fn() }))
vi.mock('./system-prompt-builder', () => ({ buildSystemPrompt: vi.fn(() => '') }))

import {
  formatHeadlessResult,
  isHeadlessCliArgv,
  parseHeadlessArgs
} from './headless-runner'

describe('G3 headless CLI parsing', () => {
  it('parses conversation runs with JSON output', () => {
    expect(parseHeadlessArgs(['electron', '.', '--lamprey-headless', 'run', '--conv', 'c1', '--json'])).toEqual({
      conversationId: 'c1',
      json: true
    })
  })

  it('parses automation runs', () => {
    expect(parseHeadlessArgs(['run', '--automation=a1'])).toEqual({
      automationId: 'a1',
      json: false
    })
  })

  it('detects headless argv', () => {
    expect(isHeadlessCliArgv(['electron', '.', '--lamprey-headless'])).toBe(true)
    expect(isHeadlessCliArgv(['lamprey', 'run'])).toBe(true)
    expect(isHeadlessCliArgv(['electron', '.'])).toBe(false)
  })

  it('formats structured errors as JSON when requested', () => {
    expect(formatHeadlessResult({ success: false, error: 'missing' }, true)).toContain('"success": false')
  })
})
