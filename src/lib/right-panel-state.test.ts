import { describe, expect, it } from 'vitest'
import {
  NEW_CONV_DEFAULT,
  applyUserToggle,
  getConvState,
  tryAutoOpen
} from './right-panel-state'

describe('right-panel-state.getConvState', () => {
  it('returns the new-conv default for an unknown conv id', () => {
    const out = getConvState({}, 'never-seen')
    expect(out).toEqual(NEW_CONV_DEFAULT)
    expect(out.collapsed).toBe(true)
  })

  it('returns the stored state for a known conv id', () => {
    const stored = { collapsed: false, currentTrigger: 'artifact:foo', dismissed: [] }
    expect(getConvState({ c1: stored }, 'c1')).toEqual(stored)
  })

  it('returns an expanded shape when no conversation is active', () => {
    // Welcome screen doesn't own a conv id — the panel should be visible
    // in this branch so the right-side surface area isn't lost.
    expect(getConvState({}, null).collapsed).toBe(false)
  })
})

describe('right-panel-state.tryAutoOpen', () => {
  it('opens the panel and records the trigger on first call', () => {
    const out = tryAutoOpen(NEW_CONV_DEFAULT, 'artifact:react://Counter')
    expect(out.collapsed).toBe(false)
    expect(out.currentTrigger).toBe('artifact:react://Counter')
  })

  it('does NOT reopen when the same trigger was previously dismissed', () => {
    const dismissed = {
      collapsed: true,
      currentTrigger: null,
      dismissed: ['artifact:foo']
    }
    const out = tryAutoOpen(dismissed, 'artifact:foo')
    expect(out).toBe(dismissed)
  })

  it('does reopen for a DIFFERENT trigger after a dismissal', () => {
    const state = { collapsed: true, currentTrigger: null, dismissed: ['artifact:foo'] }
    const out = tryAutoOpen(state, 'tool:browser')
    expect(out.collapsed).toBe(false)
    expect(out.currentTrigger).toBe('tool:browser')
    expect(out.dismissed).toContain('artifact:foo')
  })

  it('is idempotent on the currently-open trigger', () => {
    const state = { collapsed: false, currentTrigger: 'tool:browser', dismissed: [] }
    expect(tryAutoOpen(state, 'tool:browser')).toBe(state)
  })
})

describe('right-panel-state.applyUserToggle', () => {
  it('records the dismissed trigger when collapsing', () => {
    const state = { collapsed: false, currentTrigger: 'artifact:foo', dismissed: [] }
    const out = applyUserToggle(state, true)
    expect(out.collapsed).toBe(true)
    expect(out.currentTrigger).toBeNull()
    expect(out.dismissed).toEqual(['artifact:foo'])
  })

  it('does not double-add an already-dismissed trigger', () => {
    const state = { collapsed: false, currentTrigger: 'artifact:foo', dismissed: ['artifact:foo'] }
    const out = applyUserToggle(state, true)
    expect(out.dismissed).toEqual(['artifact:foo'])
  })

  it('marks the trigger as `__manual__` when the user expands manually', () => {
    const state = { collapsed: true, currentTrigger: null, dismissed: [] }
    const out = applyUserToggle(state, false)
    expect(out.collapsed).toBe(false)
    expect(out.currentTrigger).toBe('__manual__')
  })

  it('preserves the dismissed list across a manual expand', () => {
    const state = { collapsed: true, currentTrigger: null, dismissed: ['artifact:foo'] }
    const out = applyUserToggle(state, false)
    expect(out.dismissed).toEqual(['artifact:foo'])
  })
})
