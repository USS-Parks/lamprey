// SP-7 (Sweet Spot Phase, 2026-06-10) — era-chrome contract locks (E5).
//
// Source-reading assertions in the WC-8 pattern: the chat surface must not
// leak raw harness internals to the user. Raw stage ids ('planner', 'coder',
// 'reviewer'), "(orphan)" jargon, and raw contract/receipt ids were all
// user-visible in v0.12.0; this suite keeps them out.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const here = __dirname
const agentRunBanner = readFileSync(join(here, 'AgentRunBanner.tsx'), 'utf-8')
const messageBubble = readFileSync(join(here, 'MessageBubble.tsx'), 'utf-8')
const proofGateBanner = readFileSync(join(here, 'ProofGateBanner.tsx'), 'utf-8')

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

  it('the mode toggle is gone from Settings and the work-mode popover', () => {
    const agentSettings = readFileSync(
      join(here, '..', 'settings', 'AgentSettings.tsx'),
      'utf-8'
    )
    const workModePopover = readFileSync(
      join(here, '..', 'workspace', 'WorkModePopover.tsx'),
      'utf-8'
    )
    expect(agentSettings).not.toContain('persistMode')
    expect(agentSettings).not.toContain('Multi-agent')
    expect(agentSettings).not.toContain("persistMode('auto')")
    expect(workModePopover).not.toContain('Pipeline (Planner')
    expect(workModePopover).not.toContain("setMode('multi')")
    expect(workModePopover).not.toContain('agentMode')
  })

  it('MessageBubble no longer says "Planner (orphan)" or "planner ·"', () => {
    expect(messageBubble).not.toContain('Planner (orphan)')
    expect(messageBubble).not.toContain('planner · {')
    expect(messageBubble).toContain('Plan · {attachedPlanner.model}')
  })

  it('ProofGateBanner keeps contract ids out of the visible body', () => {
    // The id string may appear ONLY inside the hover tooltip (title={...}).
    const visibleContractRender = /<div[^>]*>\s*\{\[notice\.contractId/
    expect(proofGateBanner).not.toMatch(visibleContractRender)
    expect(proofGateBanner).toContain('title={')
    expect(proofGateBanner).toContain('Checks: {receiptLabel}')
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
