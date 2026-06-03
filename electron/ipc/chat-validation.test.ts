import { describe, expect, it } from 'vitest'
import { validateChatSendRequest } from './chat-validation'

// Pure validation tests for the chat:send request shape. The helper lives
// in its own file (chat-validation.ts) so the test doesn't have to import
// the rest of chat.ts's module graph — skill-loader, electron-toolkit,
// providers — none of which initialize cleanly under headless vitest.

describe('validateChatSendRequest', () => {
  it('rejects null', () => {
    const r = validateChatSendRequest(null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/request object/i)
  })

  it('rejects undefined', () => {
    const r = validateChatSendRequest(undefined)
    expect(r.ok).toBe(false)
  })

  it('rejects a string', () => {
    const r = validateChatSendRequest('hello')
    expect(r.ok).toBe(false)
  })

  it('rejects an array', () => {
    const r = validateChatSendRequest(['hello'])
    expect(r.ok).toBe(false)
  })

  it('rejects empty content', () => {
    const r = validateChatSendRequest({ content: '', model: 'm' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/content/i)
  })

  it('rejects whitespace-only content', () => {
    const r = validateChatSendRequest({ content: '   ', model: 'm' })
    expect(r.ok).toBe(false)
  })

  it('rejects non-string content', () => {
    const r = validateChatSendRequest({ content: 42, model: 'm' })
    expect(r.ok).toBe(false)
  })

  it('rejects missing model', () => {
    const r = validateChatSendRequest({ content: 'hi' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/model/i)
  })

  it('rejects non-string model', () => {
    const r = validateChatSendRequest({ content: 'hi', model: 42 })
    expect(r.ok).toBe(false)
  })

  it('rejects non-string conversationId', () => {
    const r = validateChatSendRequest({
      content: 'hi',
      model: 'm',
      conversationId: { id: 'X' }
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/conversationId/i)
  })

  it('accepts a minimal valid request, defaults conversationId to "new"', () => {
    const r = validateChatSendRequest({ content: 'hi', model: 'm' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.content).toBe('hi')
      expect(r.value.model).toBe('m')
      expect(r.value.conversationId).toBe('new')
      expect(r.value.activeSkillIds).toEqual([])
      expect(r.value.requestedAgentMode).toBeUndefined()
    }
  })

  it('filters activeSkillIds to strings only (mixed types dropped)', () => {
    const r = validateChatSendRequest({
      content: 'hi',
      model: 'm',
      activeSkillIds: ['valid', 42, null, undefined, '', 'also-valid', {}]
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.activeSkillIds).toEqual(['valid', 'also-valid'])
    }
  })

  it('accepts agentMode "single" / "multi" and drops anything else', () => {
    expect(
      (validateChatSendRequest({
        content: 'hi',
        model: 'm',
        agentMode: 'single'
      }) as { ok: true; value: { requestedAgentMode: string } }).value.requestedAgentMode
    ).toBe('single')
    expect(
      (validateChatSendRequest({
        content: 'hi',
        model: 'm',
        agentMode: 'multi'
      }) as { ok: true; value: { requestedAgentMode: string } }).value.requestedAgentMode
    ).toBe('multi')
    expect(
      (validateChatSendRequest({
        content: 'hi',
        model: 'm',
        agentMode: 'bogus'
      }) as { ok: true; value: { requestedAgentMode: string | undefined } }).value
        .requestedAgentMode
    ).toBeUndefined()
  })

  it('passes through a real conversationId verbatim', () => {
    const r = validateChatSendRequest({
      content: 'hi',
      model: 'm',
      conversationId: 'conv-XYZ'
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.conversationId).toBe('conv-XYZ')
  })
})
