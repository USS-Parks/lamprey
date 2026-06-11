// SP-7 (Sweet Spot Phase, 2026-06-10) — era-chrome contract locks (E5).
//
// Source-reading assertions in the WC-8 pattern: the chat surface must not
// leak raw harness internals to the user. Raw stage ids ('planner', 'coder',
// 'reviewer'), "(orphan)" jargon, and raw contract/receipt ids were all
// user-visible in v0.12.0; this suite keeps them out.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const here = __dirname
const agentRunBanner = readFileSync(join(here, 'AgentRunBanner.tsx'), 'utf-8')
const messageBubble = readFileSync(join(here, 'MessageBubble.tsx'), 'utf-8')

describe('SP-7 era chrome — no raw harness internals in user copy', () => {
  it('AgentRunBanner has NO pipeline branch at all (deleted 2026-06-10 per user direction)', () => {
    // The multi-agent "Pipeline" banner (planner → coder → reviewer stage
    // dots above the input pill) is deleted, not gated. Only the single-mode
    // run-phase pill remains.
    expect(agentRunBanner).not.toContain('Pipeline')
    expect(agentRunBanner).not.toContain('ROLE_ORDER')
    expect(agentRunBanner).not.toContain('activeRun')
    expect(agentRunBanner).not.toContain('useAgentStore')
    expect(agentRunBanner).toContain('RunPhasePill')
  })

  it('UB-7: the Agents settings tab is deleted; the work-mode popover has no mode switch', () => {
    expect(existsSync(join(here, '..', 'settings', 'AgentSettings.tsx'))).toBe(false)
    const workModePopover = readFileSync(
      join(here, '..', 'workspace', 'WorkModePopover.tsx'),
      'utf-8'
    )
    expect(workModePopover).not.toContain('Pipeline (Planner')
    expect(workModePopover).not.toContain("setMode('multi')")
    expect(workModePopover).not.toContain('agentMode')
  })

  it('UB-6: pipeline trace + stage chips reduced to one legacy marker', () => {
    expect(messageBubble).not.toContain('attachedPlanner')
    expect(messageBubble).not.toContain('pipeline trace')
    expect(messageBubble).not.toContain('Planner (orphan)')
    expect(messageBubble).toContain('Pipeline (legacy)')
    // The legacy chip is the ONLY stage rendering left, and it is muted.
    expect(messageBubble).not.toContain('bg-purple-500/15')
    expect(messageBubble).not.toContain('bg-sky-500/15')
  })

  it('UB-4: the proof-gate banner no longer exists at all', () => {
    // Excised with the proof machinery — absence-locked so it can't return.
    expect(existsSync(join(here, 'ProofGateBanner.tsx'))).toBe(false)
    expect(existsSync(join(here, 'proof-gate-notice.ts'))).toBe(false)
    expect(existsSync(join(here, 'proof-banner-state.ts'))).toBe(false)
    expect(messageBubble).not.toContain('ProofGateBanner')
    expect(messageBubble).not.toContain('proofStatus')
  })

  it('system rows route to SystemMarker, not assistant bubbles', () => {
    const messageList = readFileSync(join(here, 'MessageList.tsx'), 'utf-8')
    expect(messageList).toMatch(/role === 'system'\s*\?\s*\(\s*<SystemMarker/)
  })

  it('model chip shows real model names, not the legacy R1/V3 binary', () => {
    expect(messageBubble).not.toContain("'deepseek-reasoner' ? 'R1' : 'V3'")
    expect(messageBubble).toContain('formatModelIdFallback')
    expect(messageBubble).toContain('{modelLabel}')
    expect(messageBubble).toContain('title={message.model}')
  })
})
