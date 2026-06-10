import { describe, it, expect } from 'vitest'
import {
  turnEndedGhosted,
  isUserAbortError,
  buildGhostReplyNotice
} from './ghost-reply-guard'

describe('SP-4 ghost-reply guard (D5)', () => {
  it('empty conversation → not ghosted', () => {
    expect(turnEndedGhosted([])).toBe(false)
  })

  it('user message with no reply → ghosted', () => {
    expect(turnEndedGhosted([{ role: 'user' }])).toBe(true)
  })

  it('user → assistant reply → not ghosted', () => {
    expect(turnEndedGhosted([{ role: 'user' }, { role: 'assistant' }])).toBe(false)
  })

  it('user → system notice (research fallback / CR-2) → not ghosted', () => {
    expect(turnEndedGhosted([{ role: 'user' }, { role: 'system', stage: 'system' }])).toBe(false)
  })

  it('user → ONLY a hidden planner row → still ghosted (R4 hides planner)', () => {
    expect(
      turnEndedGhosted([{ role: 'user' }, { role: 'assistant', stage: 'planner' }])
    ).toBe(true)
  })

  it('user → planner row → coder reply → not ghosted', () => {
    expect(
      turnEndedGhosted([
        { role: 'user' },
        { role: 'assistant', stage: 'planner' },
        { role: 'assistant' }
      ])
    ).toBe(false)
  })

  it('user → tool rows only → ghosted (tool rows are plumbing, not replies)', () => {
    expect(turnEndedGhosted([{ role: 'user' }, { role: 'tool' }])).toBe(true)
  })

  it('earlier turns answered, newest turn ghosted → ghosted', () => {
    expect(
      turnEndedGhosted([
        { role: 'user' },
        { role: 'assistant' },
        { role: 'user' }
      ])
    ).toBe(true)
  })

  it('partial assistant row saved by onError → not ghosted', () => {
    expect(
      turnEndedGhosted([{ role: 'user' }, { role: 'assistant', stage: null }])
    ).toBe(false)
  })

  it('isUserAbortError matches AbortError name and abort-shaped messages', () => {
    expect(isUserAbortError({ name: 'AbortError' })).toBe(true)
    expect(isUserAbortError({ message: 'The operation was aborted' })).toBe(true)
    expect(isUserAbortError({ message: 'request aborted by user' })).toBe(true)
    expect(isUserAbortError({ message: 'ECONNRESET' })).toBe(false)
    expect(isUserAbortError(undefined)).toBe(false)
  })

  it('notice names the error and stays jargon-free', () => {
    const text = buildGhostReplyNotice('boom')
    expect(text).toContain('boom')
    expect(text).not.toMatch(/proof|contract|pipeline|stage/i)
    expect(buildGhostReplyNotice(undefined)).toContain('unknown error')
    expect(buildGhostReplyNotice('   ')).toContain('unknown error')
  })
})
