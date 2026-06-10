import { describe, it, expect } from 'vitest'
import { routeAgentMode } from './agent-router'

describe('routeAgentMode — explicit flags (precedence 1)', () => {
  it('promotes to multi when --multi flag is present', () => {
    const r = routeAgentMode('Do this --multi please')
    expect(r.mode).toBe('multi')
    expect(r.reason).toMatch(/--multi/)
    expect(r.cleanedText).toBe('Do this please')
  })

  it('forces single when --single flag is present, even on a long prompt', () => {
    const longPrompt = '--single ' + 'lorem ipsum dolor sit amet '.repeat(80)
    const r = routeAgentMode(longPrompt)
    expect(r.mode).toBe('single')
    expect(r.cleanedText.startsWith('--single')).toBe(false)
  })

  it('is case-insensitive on the flag', () => {
    expect(routeAgentMode('Do --MULTI please').mode).toBe('multi')
    expect(routeAgentMode('Do --Single please').mode).toBe('single')
  })

  it('strips the flag from cleanedText and collapses spaces', () => {
    const r = routeAgentMode('Fix the thing --multi today')
    expect(r.cleanedText).toBe('Fix the thing today')
  })
})

describe('routeAgentMode — implicit signals', () => {
  it('promotes to multi on a long prompt (> 800 bytes)', () => {
    const longPrompt = 'word '.repeat(200) // 1000 chars
    const r = routeAgentMode(longPrompt)
    expect(r.mode).toBe('multi')
    expect(r.reason).toMatch(/long prompt/)
  })

  it('stays single on a short prompt', () => {
    const r = routeAgentMode('What does the keychain do?')
    expect(r.mode).toBe('single')
    expect(r.reason).toMatch(/short/)
  })

  it('promotes on the STS phrase phrase', () => {
    const r = routeAgentMode('STS the new error-boundary phase')
    expect(r.mode).toBe('multi')
    expect(r.reason).toMatch(/STS/)
  })

  it('promotes on the P-SPR phrase', () => {
    expect(routeAgentMode('Draft a P-SPR for telemetry').mode).toBe('multi')
    expect(routeAgentMode('write a PSPR for it').mode).toBe('multi')
  })

  it('promotes on "stem to stern"', () => {
    const r = routeAgentMode('Run this stem to stern')
    expect(r.mode).toBe('multi')
  })

  it('promotes on build-from-scratch phrases', () => {
    expect(routeAgentMode('Build me a full game').mode).toBe('multi')
    expect(routeAgentMode('Create a complete system').mode).toBe('multi')
    expect(routeAgentMode('Scaffold an entire pipeline').mode).toBe('multi')
    expect(routeAgentMode('Implement the whole tool').mode).toBe('multi')
  })

  it('does NOT promote on build/create without scope qualifier', () => {
    const r = routeAgentMode('Create the file foo.ts with this content')
    expect(r.mode).toBe('single')
  })

  it('promotes on multi-file refactor / audit / migrate phrases', () => {
    expect(routeAgentMode('Refactor the store across every component').mode).toBe('multi')
    expect(routeAgentMode('Audit the entire codebase').mode).toBe('multi')
    expect(routeAgentMode('Rewrite all the tests').mode).toBe('multi')
    expect(routeAgentMode('Migrate every model id').mode).toBe('multi')
  })

  it('promotes on ≥ 2 sequential-step markers', () => {
    const r = routeAgentMode('First do A and then B. After that, do C.')
    expect(r.mode).toBe('multi')
    expect(r.reason).toMatch(/sequential/)
  })

  it('stays single on a single sequential marker', () => {
    const r = routeAgentMode('Run the build and then commit it')
    expect(r.mode).toBe('single')
  })

  it('promotes on ≥ 3 bulleted deliverables', () => {
    const r = routeAgentMode(
      'Please do these:\n- add a button\n- add a tooltip\n- add an icon'
    )
    expect(r.mode).toBe('multi')
    expect(r.reason).toMatch(/deliverables/)
  })

  it('promotes on ≥ 3 comma-separated deliverables', () => {
    const r = routeAgentMode('Add a button, a tooltip, an icon, and a test')
    expect(r.mode).toBe('multi')
  })

  it('does NOT count parenthesised aside commas toward deliverables', () => {
    // Three commas inside parens, one outside — should NOT promote
    const r = routeAgentMode('Fix this (which was added in 2024, by Sam, last week, on a Tuesday) please')
    expect(r.mode).toBe('single')
  })

  it('does NOT count code-block commas toward deliverables', () => {
    const r = routeAgentMode(
      'Add this import:\n```ts\nimport { a, b, c, d } from "./mod"\n```'
    )
    expect(r.mode).toBe('single')
  })

  it('stays single on canonical short-ask scenarios', () => {
    expect(routeAgentMode('What does the keychain module do?').mode).toBe('single')
    expect(routeAgentMode('Rename runChatRound to dispatchTurn in chat.ts').mode).toBe('single')
    expect(routeAgentMode("Fix the typo 'lampshde' in the README").mode).toBe('single')
    expect(routeAgentMode('Why is the build failing?').mode).toBe('single')
  })
})

describe('routeAgentMode — return shape', () => {
  it('always returns the four required fields (CR-3 added matchedRule)', () => {
    const r = routeAgentMode('test')
    expect(r).toHaveProperty('mode')
    expect(r).toHaveProperty('reason')
    expect(r).toHaveProperty('cleanedText')
    expect(r).toHaveProperty('matchedRule')
  })

  it('reason is never empty', () => {
    expect(routeAgentMode('').reason.length).toBeGreaterThan(0)
    expect(routeAgentMode('short ask').reason.length).toBeGreaterThan(0)
    expect(routeAgentMode('a '.repeat(500)).reason.length).toBeGreaterThan(0)
  })

  it('handles empty and null-ish input gracefully', () => {
    expect(routeAgentMode('').mode).toBe('single')
    expect(routeAgentMode('').matchedRule).toBe('default_single')
    // @ts-expect-error — testing runtime robustness
    expect(routeAgentMode(undefined).mode).toBe('single')
    // @ts-expect-error — testing runtime robustness
    expect(routeAgentMode(null).mode).toBe('single')
  })
})

// CR-3 (Cogency Restore Phase, 2026-06-09) — explicit per-rule matchedRule
// assertions. Each rule path in routeAgentMode must name itself; silent
// fallthroughs are caught by the LL_SMOKE_PLAYBOOK ask assertions below.
describe('CR-3 routeAgentMode — matchedRule per rule', () => {
  it('explicit_flag', () => {
    expect(routeAgentMode('do this --multi').matchedRule).toBe('explicit_flag')
    expect(routeAgentMode('do this --single').matchedRule).toBe('explicit_flag')
  })

  it('long_prompt', () => {
    expect(routeAgentMode('word '.repeat(200)).matchedRule).toBe('long_prompt')
  })

  it('phase_phrase', () => {
    expect(routeAgentMode('STS the new error-boundary phase').matchedRule).toBe('phase_phrase')
    expect(routeAgentMode('Show me the P-SPR for adding telemetry').matchedRule).toBe('phase_phrase')
    expect(routeAgentMode('Run this stem to stern').matchedRule).toBe('phase_phrase')
  })

  it('build_from_scratch', () => {
    expect(routeAgentMode('Build me a full game').matchedRule).toBe('build_from_scratch')
  })

  it('multi_file_phrase', () => {
    expect(routeAgentMode('Refactor the chat store to use Zustand 5 slices across every consuming component').matchedRule).toBe('multi_file_phrase')
  })

  it('sequential_steps', () => {
    expect(routeAgentMode('First do A and then B. After that, do C.').matchedRule).toBe('sequential_steps')
  })

  it('deliverable_count', () => {
    expect(
      routeAgentMode('Please do these:\n- add a button\n- add a tooltip\n- add an icon').matchedRule
    ).toBe('deliverable_count')
  })

  it('default_single', () => {
    expect(routeAgentMode('What does the keychain module do?').matchedRule).toBe('default_single')
  })
})

// CR-3 — locks the LL_SMOKE_PLAYBOOK asks to their expected (route,
// matchedRule) pair. v0.11.0 playbook observed asks 2/3/4/5 going multi at
// runtime even though the router says single; that discrepancy lives ABOVE
// the router (the chat layer's agentMode resolution). These assertions
// confirm the router itself is correct, so CR-4 can focus on the dispatch
// layer rather than tuning regexes that are already right.
describe('CR-3 LL_SMOKE_PLAYBOOK route lock', () => {
  const asks: Array<{ ask: string; prompt: string; mode: 'single' | 'multi'; rule: string }> = [
    {
      ask: 'Ask 2 — rename in a specific file',
      prompt: 'Rename runChatRound to dispatchSingleAgentTurn in electron/ipc/chat.ts',
      mode: 'single',
      rule: 'default_single'
    },
    {
      ask: 'Ask 3 — typo fix in README',
      prompt: "Fix the typo 'Lampshde' in the README",
      mode: 'single',
      rule: 'default_single'
    },
    {
      ask: 'Ask 4 — diagnostic question',
      prompt: 'Why is the build failing?',
      mode: 'single',
      rule: 'default_single'
    },
    {
      ask: 'Ask 5 — single-feature build',
      prompt: 'Add a button to the chat header that exports the transcript as markdown',
      mode: 'single',
      rule: 'default_single'
    },
    {
      ask: 'Ask 6 — multi-file refactor phrase',
      prompt: 'Refactor the chat store to use Zustand 5 slices across every consuming component',
      mode: 'multi',
      rule: 'multi_file_phrase'
    },
    {
      ask: 'Ask 7 — STS phase',
      prompt: 'STS the new error-boundary phase',
      mode: 'multi',
      rule: 'phase_phrase'
    },
    {
      ask: 'Ask 8 — P-SPR phase',
      prompt: 'Show me the P-SPR for adding telemetry',
      mode: 'multi',
      rule: 'phase_phrase'
    }
  ]

  for (const { ask, prompt, mode, rule } of asks) {
    it(`${ask} → ${mode} via ${rule}`, () => {
      const r = routeAgentMode(prompt)
      expect(r.mode).toBe(mode)
      expect(r.matchedRule).toBe(rule)
    })
  }
})
