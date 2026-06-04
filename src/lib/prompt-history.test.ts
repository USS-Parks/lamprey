import { describe, expect, it } from 'vitest'
import {
  emptyHistoryState,
  historyDown,
  historyReset,
  historyUp,
  type PromptHistoryState
} from './prompt-history'

// Most-recent-first ordering matches what chat-store's getRecentUserPrompts
// returns, so the helper's contract is the same shape throughout.
const HISTORY = ['most recent', 'middle', 'oldest']

describe('prompt-history.historyUp', () => {
  it('enters history at index 0 and saves the draft', () => {
    const out = historyUp(HISTORY, emptyHistoryState, 'work-in-progress')
    expect(out.state.index).toBe(0)
    expect(out.state.draft).toBe('work-in-progress')
    expect(out.text).toBe('most recent')
  })

  it('walks one step older on each successive up', () => {
    const a = historyUp(HISTORY, emptyHistoryState, '')
    const b = historyUp(HISTORY, a.state, a.text)
    const c = historyUp(HISTORY, b.state, b.text)
    expect(a.text).toBe('most recent')
    expect(b.text).toBe('middle')
    expect(c.text).toBe('oldest')
  })

  it('stops at the oldest entry rather than walking past it', () => {
    let s: PromptHistoryState = emptyHistoryState
    let text = ''
    for (let i = 0; i < 10; i++) {
      const step = historyUp(HISTORY, s, text)
      s = step.state
      text = step.text
    }
    expect(s.index).toBe(HISTORY.length - 1)
    expect(text).toBe('oldest')
  })

  it('does nothing when history is empty', () => {
    const out = historyUp([], emptyHistoryState, 'typed')
    expect(out.state).toBe(emptyHistoryState)
    expect(out.text).toBe('typed')
  })
})

describe('prompt-history.historyDown', () => {
  it('is a no-op when not browsing', () => {
    const out = historyDown(HISTORY, emptyHistoryState)
    expect(out.state).toBe(emptyHistoryState)
    expect(out.text).toBe('')
  })

  it('walks back toward more recent entries', () => {
    // Walk up twice (so index=1, text="middle"), then down once.
    const up1 = historyUp(HISTORY, emptyHistoryState, 'draft')
    const up2 = historyUp(HISTORY, up1.state, up1.text)
    const down1 = historyDown(HISTORY, up2.state)
    expect(down1.state.index).toBe(0)
    expect(down1.text).toBe('most recent')
  })

  it('restores the saved draft when walking past the newest', () => {
    const up = historyUp(HISTORY, emptyHistoryState, 'my draft')
    expect(up.state.index).toBe(0)
    const down = historyDown(HISTORY, up.state)
    expect(down.state.index).toBeNull()
    expect(down.state.draft).toBe('')
    expect(down.text).toBe('my draft')
  })
})

describe('prompt-history.historyReset', () => {
  it('restores the draft and clears the index when browsing', () => {
    const up = historyUp(HISTORY, emptyHistoryState, 'half-written')
    const reset = historyReset(up.state)
    expect(reset.state.index).toBeNull()
    expect(reset.state.draft).toBe('')
    expect(reset.text).toBe('half-written')
  })

  it('is a no-op when not browsing', () => {
    const out = historyReset(emptyHistoryState)
    expect(out.state).toBe(emptyHistoryState)
    expect(out.text).toBe('')
  })
})
