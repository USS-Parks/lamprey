import { describe, it, expect, beforeEach } from 'vitest'
import {
  recordRouterDecision,
  getRecentRouterDecisions,
  clearRouterTelemetry,
  setRouterTelemetryEnabled,
  isRouterTelemetryEnabled
} from './router-telemetry'

describe('CR-3 router-telemetry ring buffer', () => {
  beforeEach(() => {
    setRouterTelemetryEnabled(true)
    clearRouterTelemetry()
  })

  it('records a decision and returns it via getRecentRouterDecisions', () => {
    recordRouterDecision({
      promptText: 'Rename foo to bar',
      route: 'single',
      matchedRule: 'default_single',
      reason: 'short, single-deliverable ask',
      conversationId: 'conv-1',
      timestamp: 1000
    })
    const entries = getRecentRouterDecisions()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      route: 'single',
      matchedRule: 'default_single',
      promptLength: 'Rename foo to bar'.length,
      timestamp: 1000,
      conversationId: 'conv-1'
    })
    expect(entries[0].promptHash).toHaveLength(8)
  })

  it('caps the buffer at 50 entries (oldest dropped)', () => {
    for (let i = 0; i < 60; i++) {
      recordRouterDecision({
        promptText: `prompt ${i}`,
        route: 'single',
        matchedRule: 'default_single',
        reason: 'r',
        timestamp: i
      })
    }
    const entries = getRecentRouterDecisions()
    expect(entries).toHaveLength(50)
    expect(entries[0].timestamp).toBe(10)
    expect(entries[49].timestamp).toBe(59)
  })

  it('is a no-op when telemetry is disabled', () => {
    setRouterTelemetryEnabled(false)
    recordRouterDecision({
      promptText: 'foo',
      route: 'multi',
      matchedRule: 'phase_phrase',
      reason: 'r'
    })
    expect(getRecentRouterDecisions()).toHaveLength(0)
    expect(isRouterTelemetryEnabled()).toBe(false)
  })

  it('the promptHash differs between distinct prompts', () => {
    recordRouterDecision({
      promptText: 'rename a to b',
      route: 'single',
      matchedRule: 'default_single',
      reason: 'r'
    })
    recordRouterDecision({
      promptText: 'rename c to d',
      route: 'single',
      matchedRule: 'default_single',
      reason: 'r'
    })
    const entries = getRecentRouterDecisions()
    expect(entries[0].promptHash).not.toEqual(entries[1].promptHash)
  })

  it('identical prompts produce identical hashes (scrubbable yet identifying)', () => {
    recordRouterDecision({
      promptText: 'identical prompt',
      route: 'single',
      matchedRule: 'default_single',
      reason: 'r'
    })
    recordRouterDecision({
      promptText: 'identical prompt',
      route: 'single',
      matchedRule: 'default_single',
      reason: 'r'
    })
    const entries = getRecentRouterDecisions()
    expect(entries[0].promptHash).toEqual(entries[1].promptHash)
  })
})
