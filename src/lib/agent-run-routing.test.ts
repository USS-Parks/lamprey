import { describe, expect, it } from 'vitest'
import { routeAgentRun } from './agent-run-routing'

describe('routeAgentRun', () => {
  it('returns "inline" for in-turn runs', () => {
    expect(routeAgentRun({ runInBackground: false })).toBe('inline')
  })

  it('returns "banner" when the run is backgrounded', () => {
    expect(routeAgentRun({ runInBackground: true })).toBe('banner')
  })
})
