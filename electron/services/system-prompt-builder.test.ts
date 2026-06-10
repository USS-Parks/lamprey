import { describe, it, expect } from 'vitest'
import {
  AGENT_ROLE_PROMPTS,
  COMPOSER_SYSTEM,
  PSEUDO_TAG_GUARD,
  buildAgentSystemPrompt,
  buildSystemPrompt,
  getRoleFragment,
  renderContract,
  type ContractRole
} from './system-prompt-builder'

// The model-resolver path in identityHead reads from providers/registry. To
// keep these tests pure / network-free, we call buildSystemPrompt without a
// modelId — that takes the no-model branch of identityHead, which is a stable
// hard-coded string. The modelId-path is exercised by chat.ts at runtime.

// L2 (Lampshade Phase, 2026-06-09) — the 9-section / 52-bullet contract was
// collapsed into one tight "How you work" block. The historical headings list
// is preserved as a comment so the diff explains itself for future readers.
//   Pre-L2 headings (deleted): Chain-of-thought (REQUIRED), Understand intent,
//   Gather context before editing, Use tools as evidence, Protect user work,
//   Verify before claiming done, Progress updates, Standalone deliverables,
//   Final response.
// CR-1 (Cogency Restore Phase, 2026-06-09) — added "Project conventions" section
// with STS / P-SPR / Bucket / Stem to Stern vocab. The Lampshade L2 collapse
// dropped these as "redundant prose" but the LL_SMOKE_PLAYBOOK proved Asks 7 + 8
// failed because the Planner had no idea what those terms meant. The new section
// follows the existing "How you work" block.
const EXPECTED_SECTION_HEADINGS = ['How you work', 'Project conventions']

const ALL_ROLES: ContractRole[] = [
  'coding',
  'review',
  'planning',
  'frontend',
  'document',
  'non_technical_user'
]

describe('renderContract', () => {
  it('wraps the contract in <contract>…</contract>', () => {
    const out = renderContract()
    expect(out.startsWith('<contract>')).toBe(true)
    expect(out.endsWith('</contract>')).toBe(true)
  })

  it('emits all expected section headings in order', () => {
    const out = renderContract()
    let cursor = 0
    for (const heading of EXPECTED_SECTION_HEADINGS) {
      const idx = out.indexOf(`## ${heading}`, cursor)
      expect(idx, `expected heading "## ${heading}" at/after offset ${cursor}`).toBeGreaterThanOrEqual(cursor)
      cursor = idx + heading.length
    }
  })

  it('renders each section with at least one bullet', () => {
    const out = renderContract()
    for (const heading of EXPECTED_SECTION_HEADINGS) {
      const sectionStart = out.indexOf(`## ${heading}`)
      const after = out.slice(sectionStart)
      const firstBulletIdx = after.indexOf('\n- ')
      expect(firstBulletIdx, `expected a bullet under "${heading}"`).toBeGreaterThan(0)
    }
  })

  // CR-1 (Cogency Restore Phase) — the canonical project planning vocabulary
  // MUST appear exactly once in the rendered contract. Asks 7 + 8 of the
  // LL_SMOKE_PLAYBOOK proved the Planner has no concept of STS or P-SPR when
  // these aren't in the prompt. The test guards against future contract cuts
  // silently dropping the bullets again.
  it('CR-1: includes the canonical project vocabulary (STS / P-SPR / Bucket / Stem to Stern)', () => {
    const out = renderContract()
    expect(out).toContain('STS')
    expect(out).toContain('P-SPR')
    expect(out).toContain('Bucket')
    expect(out).toContain('Stem to Stern')
    expect(out).toContain('Sequential Prompt Roster')
    expect(out).toContain('Project conventions')
  })

  // CR-1 F13 — the fifth bullet locks the "vocab clarification ≠ build
  // directive" behavior surfaced by Asks 6 + 8 v0.11.1 (Coder building entire
  // Python p_spr package + Vite/Zustand React scaffold from terse clarifications).
  it('CR-1: includes the F13 vocab-vs-build clarification bullet', () => {
    const out = renderContract()
    expect(out).toContain('consume it as vocabulary')
  })

  // CR-7 (Cogency Restore Phase, 2026-06-09) — terse Reviewer-stage exemplar
  // that steers DeepSeek/Gemma/Qwen away from the 4-section enumerated review
  // template observed in the v0.11.1 playbook (Asks 3, 4, 5, 8). Locked in
  // shape + an envelope-byte guard so future verbose additions to the
  // exemplar trigger CI failure.
  it('CR-7: includes the terse Reviewer exemplar shape', () => {
    const out = renderContract()
    expect(out).toContain('Reviewer:')
    expect(out).toContain('Reviewed:')
    // Verdict line on its own — exactly what the L4-slim review fragment
    // requires AND the L9 verdict-line guard requires.
    expect(out).toMatch(/\nCHANGES\n<\/example>/)
  })

  it('CR-7: reviewer exemplar bytes ≤ 300 (envelope guard)', async () => {
    const { IDEAL_REVIEWER_EXEMPLAR } = await import('./system-prompt-builder')
    expect(IDEAL_REVIEWER_EXEMPLAR.length).toBeLessThanOrEqual(300)
  })

  // CR-8 (Cogency Restore Phase, 2026-06-09) — three Coder operational
  // rules added to the multi-agent Coder sub-agent's operating-principles
  // excerpt. Each addresses a finding from the LL_SMOKE_PLAYBOOK.
  it('CR-8: Coder operating principles include the F7 shell-adapt rule', () => {
    const out = buildAgentSystemPrompt('coder')
    expect(out).toContain('switch to the host shell native syntax')
    expect(out).toContain('Pivot after one failure')
  })

  it('CR-8: Coder operating principles include the F9 no-shell-edit rule', () => {
    const out = buildAgentSystemPrompt('coder')
    expect(out).toContain('Never edit files via shell pipelines')
    expect(out).toContain('Set-Content')
    expect(out).toContain('apply_patch fails')
  })

  it('CR-8: Coder operating principles include the F13 minimum-fix rule', () => {
    const out = buildAgentSystemPrompt('coder')
    expect(out).toContain('Default to the smallest correct fix')
    expect(out).toContain('parallel architectures')
  })

  it('CR-8: Reviewer / Planner / Coworker sub-agents do NOT receive the Coder rules', () => {
    // These rules only make sense for the role that mutates files.
    const reviewer = buildAgentSystemPrompt('reviewer')
    const planner = buildAgentSystemPrompt('planner')
    const coworker = buildAgentSystemPrompt('coworker')
    for (const out of [reviewer, planner, coworker]) {
      expect(out).not.toContain('Never edit files via shell pipelines')
      expect(out).not.toContain('parallel architectures')
    }
  })

  // CR-9 (Cogency Restore Phase, 2026-06-09) — exploration budget. Ask 5
  // v0.11.0 ran 15 rounds of zero-match searches; Ask 6 v0.11.1 ran 54 tool
  // calls before stalling. The rule escalates to ask_user_question after
  // three consecutive zero-match searches.
  it('CR-9: Coder operating principles include the three-zero-matches budget rule', () => {
    const out = buildAgentSystemPrompt('coder')
    expect(out).toContain('three consecutive searches return zero matches')
    expect(out).toContain('ask_user_question')
    expect(out).toContain('Do not loop into a fourth search')
  })
})

describe('buildSystemPrompt — default base', () => {
  it('includes the honest-identity sentence', () => {
    const out = buildSystemPrompt([], '')
    expect(out).toContain('Lamprey is the interface, not the model')
  })

  it('includes the operating block', () => {
    const out = buildSystemPrompt([], '')
    for (const heading of EXPECTED_SECTION_HEADINGS) {
      expect(out).toContain(`## ${heading}`)
    }
  })

  // L2 — the contract drops at least 60% vs L1 baseline (9,311 bytes).
  // Target: under 3,700 bytes. Locks the win against future bloat.
  it('renders under the L2 size target (< 3,700 bytes, ≥60% drop from L1)', () => {
    const out = renderContract()
    expect(out.length).toBeLessThan(3700)
  })

  // L3 — the <think> block is conditional, not mandatory. The contract must
  // contain the conditional bullet exactly once, must NOT contain the L1
  // "every single turn MUST begin with a <think>" mandate, and must NOT
  // contain the heading "Chain-of-thought (REQUIRED)" anymore.
  it('uses the conditional <think> bullet, not the every-turn mandate', () => {
    const out = renderContract()
    expect(out).toContain('When the answer involves planning')
    expect(out).not.toContain('Every single assistant turn MUST begin with a <think>')
    expect(out).not.toContain('Chain-of-thought (REQUIRED)')
  })
})

// L9 (Lampshade Phase, 2026-06-09) — locks the envelope shape against
// silent regrowth. Six discrete guards: one positive (the operating block
// is present), one explicit-size lock on the coding-mode prompt, and four
// negative locks naming phrases that defined the pre-L2 over-instruction
// shape. Reviewer's size lock is already in the L6 block above. The
// native-tools strip locks are in the L3 block below.
describe('Lampshade L9 — envelope shape guards', () => {
  it('positive: "## How you work" heading is present in single-agent prompts', () => {
    expect(buildSystemPrompt([], '')).toContain('## How you work')
    expect(buildSystemPrompt([], '', undefined, undefined, undefined, 'coding')).toContain(
      '## How you work'
    )
  })

  // CR-7 (Cogency Restore Phase, 2026-06-09) — bumped the L9 4,096 size guard
  // to 4,400 bytes. The CR phase added: CR-1 ~520 bytes of Project conventions
  // vocab (5 bullets) and CR-7 ~285 bytes of the terse Reviewer exemplar. Net
  // contract regrowth is ~800 bytes — still well under the byte savings L2
  // delivered (~7,200 bytes) and 4,400 is the post-CR coding-mode prompt
  // size + ~150 bytes of headroom for future thin additions.
  it('size: coding-mode single-agent prompt stays under 4,400 bytes (post-CR floor)', () => {
    const out = buildSystemPrompt([], '', undefined, undefined, undefined, 'coding')
    expect(out.length).toBeLessThan(4400)
  })

  it('negative: no rendered prompt names the pre-L2 hedging phrases', () => {
    const surfaces = [
      buildSystemPrompt([], ''),
      buildSystemPrompt([], '', undefined, undefined, undefined, 'coding'),
      buildSystemPrompt([], '', undefined, undefined, undefined, 'review'),
      buildSystemPrompt([], '', undefined, undefined, undefined, 'frontend'),
      buildAgentSystemPrompt('planner'),
      buildAgentSystemPrompt('coder'),
      buildAgentSystemPrompt('reviewer'),
      buildAgentSystemPrompt('coworker')
    ]
    const forbidden = [
      '<bash>',
      'Every single assistant turn',
      'MUST begin with a <think>',
      'Chain-of-thought (REQUIRED)',
      'Never write "task complete"',
      'fenced Markdown block with a language tag'
    ]
    for (const surface of surfaces) {
      for (const phrase of forbidden) {
        expect(
          surface,
          `forbidden phrase "${phrase}" appeared in a rendered prompt (length ${surface.length})`
        ).not.toContain(phrase)
      }
    }
  })

  it('size: rendered planner/coder/reviewer/coworker agent prompts each under 1,500 bytes', () => {
    for (const role of ['planner', 'coder', 'reviewer', 'coworker'] as const) {
      const out = buildAgentSystemPrompt(role)
      expect(out.length, `role "${role}" rendered prompt over 1,500 bytes`).toBeLessThan(1500)
    }
  })

  it('exactness: the conditional <think> sentence appears at most once in any rendered prompt', () => {
    const surfaces = [
      buildSystemPrompt([], ''),
      buildSystemPrompt([], '', undefined, undefined, undefined, 'coding'),
      buildAgentSystemPrompt('coder')
    ]
    for (const surface of surfaces) {
      const matches = surface.match(/When the answer involves planning/g) ?? []
      expect(matches.length).toBeLessThanOrEqual(1)
    }
  })
})

describe('buildSystemPrompt — supportsNativeTools strips the <think> bullet (L3)', () => {
  it('keeps the conditional think bullet when supportsNativeTools is false/undefined', () => {
    const out = buildSystemPrompt([], '')
    expect(out).toContain('When the answer involves planning')
  })

  it('strips the conditional think bullet when supportsNativeTools is true', () => {
    const out = buildSystemPrompt(
      [],
      '',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true // supportsNativeTools
    )
    expect(out).not.toContain('When the answer involves planning')
  })

  it('places AGENTS.md after the base contract', () => {
    const out = buildSystemPrompt([], '', undefined, 'repo-specific guidance here')
    const contractIdx = out.indexOf('</contract>')
    const agentsIdx = out.indexOf('<agents_md>')
    expect(contractIdx).toBeGreaterThan(-1)
    expect(agentsIdx).toBeGreaterThan(contractIdx)
    expect(out).toContain('repo-specific guidance here')
  })

  it('places the memory block after AGENTS.md', () => {
    const out = buildSystemPrompt([], '<memory>fact</memory>', undefined, 'agents content')
    const agentsIdx = out.indexOf('<agents_md>')
    const memoryIdx = out.indexOf('<memory>')
    expect(agentsIdx).toBeGreaterThan(-1)
    expect(memoryIdx).toBeGreaterThan(agentsIdx)
  })

  it('appends skill blocks after everything else', () => {
    const out = buildSystemPrompt(
      [{ name: 'test-skill', content: 'skill body' }],
      '<memory>fact</memory>',
      undefined,
      'agents content'
    )
    const memoryIdx = out.indexOf('<memory>')
    const skillIdx = out.indexOf('<skill name="test-skill">')
    expect(memoryIdx).toBeGreaterThan(-1)
    expect(skillIdx).toBeGreaterThan(memoryIdx)
    expect(out).toContain('skill body')
  })

  // D2 — the always-loaded `<memory_index>` block sits between the
  // legacy `<memory>` block and the skill blocks. Per the parity-plan
  // §2 invariant, the inter-block order is
  //   memory_index → skills → retrieved_context → chapters → conversation
  // so the index must precede skills.
  it('places the <memory_index> block between <memory> and skills', () => {
    const out = buildSystemPrompt(
      [{ name: 'test-skill', content: 'skill body' }],
      '<memory>m</memory>',
      undefined,
      undefined,
      undefined,
      undefined,
      '<memory_index>\n- [a](a.md) — A\n</memory_index>'
    )
    const memIdx = out.indexOf('<memory>')
    const idxIdx = out.indexOf('<memory_index>')
    const skillIdx = out.indexOf('<skill name="test-skill">')
    expect(memIdx).toBeGreaterThan(-1)
    expect(idxIdx).toBeGreaterThan(memIdx)
    expect(skillIdx).toBeGreaterThan(idxIdx)
  })

  it('drops the <memory_index> block entirely when empty', () => {
    const out = buildSystemPrompt([], '', undefined, undefined, undefined, undefined, '   ')
    expect(out).not.toContain('<memory_index>')
  })

  it('places task notifications after memory index and before skills', () => {
    const out = buildSystemPrompt(
      [{ name: 'test-skill', content: 'skill body' }],
      '<memory>fact</memory>',
      undefined,
      undefined,
      undefined,
      undefined,
      '<memory_index>\n- [a](a.md) — A\n</memory_index>',
      '<task-notifications>\n- done\n</task-notifications>'
    )
    const memoryIdx = out.indexOf('<memory>')
    const memoryIndexIdx = out.indexOf('<memory_index>')
    const notifyIdx = out.indexOf('<task-notifications>')
    const skillIdx = out.indexOf('<skill name="test-skill">')
    expect(memoryIndexIdx).toBeGreaterThan(memoryIdx)
    expect(notifyIdx).toBeGreaterThan(memoryIndexIdx)
    expect(skillIdx).toBeGreaterThan(notifyIdx)
  })

  it('places chapters after task notifications and before skills', () => {
    const out = buildSystemPrompt(
      [{ name: 'test-skill', content: 'skill body' }],
      '<memory>fact</memory>',
      undefined,
      undefined,
      undefined,
      undefined,
      '<memory_index>\n- [a](a.md) - A\n</memory_index>',
      '<task-notifications>\n- done\n</task-notifications>',
      '<chapters>\n- Schema migration\n</chapters>'
    )
    const notifyIdx = out.indexOf('<task-notifications>')
    const chaptersIdx = out.indexOf('<chapters>')
    const skillIdx = out.indexOf('<skill name="test-skill">')
    expect(chaptersIdx).toBeGreaterThan(notifyIdx)
    expect(skillIdx).toBeGreaterThan(chaptersIdx)
  })
})

describe('buildSystemPrompt — override path', () => {
  it('uses the override verbatim and omits the default contract', () => {
    const out = buildSystemPrompt([], '', 'I am a custom prompt.')
    expect(out).toContain('I am a custom prompt.')
    expect(out).not.toContain('Lamprey is the interface')
    expect(out).not.toContain('<contract>')
  })

  it('still appends AGENTS.md / memory / skills under an override', () => {
    const out = buildSystemPrompt(
      [{ name: 'skill-x', content: 'body' }],
      '<memory>m</memory>',
      'OVERRIDE',
      'AGENTS'
    )
    expect(out.startsWith('OVERRIDE')).toBe(true)
    expect(out).toContain('AGENTS')
    expect(out).toContain('<memory>m</memory>')
    expect(out).toContain('<skill name="skill-x">')
  })

  it('treats a whitespace-only override as absent', () => {
    const out = buildSystemPrompt([], '', '   \n\t  ')
    expect(out).toContain('Lamprey is the interface')
    expect(out).toContain('<contract>')
  })
})

describe('buildSystemPrompt — contract role layering', () => {
  it('injects the requested role fragment after the base contract', () => {
    const out = buildSystemPrompt([], '', undefined, undefined, undefined, 'coding')
    expect(out).toContain('<role mode="coding">')
    // L4 — fragment opener is "You are writing code." (was "You are in coding mode.")
    expect(out).toContain('You are writing code.')
    const contractIdx = out.indexOf('</contract>')
    const roleIdx = out.indexOf('<role mode="coding">')
    expect(roleIdx).toBeGreaterThan(contractIdx)
  })

  it('omits the role block when no role is supplied', () => {
    const out = buildSystemPrompt([], '')
    expect(out).not.toContain('<role mode=')
  })

  it('layers the role on top of an override too', () => {
    const out = buildSystemPrompt(
      [],
      '',
      'CUSTOM',
      undefined,
      undefined,
      'review'
    )
    expect(out).toContain('CUSTOM')
    expect(out).toContain('<role mode="review">')
    expect(out).toContain('SHIP if the change is good to merge')
  })
})

describe('getRoleFragment', () => {
  it('returns a non-empty string for every defined role', () => {
    for (const role of ALL_ROLES) {
      const text = getRoleFragment(role)
      expect(text.length, `role "${role}" should have a fragment`).toBeGreaterThan(40)
    }
  })

  // L4 — each fragment is 2–3 tight imperatives, not a meta-explanation
  // paragraph. The 280-byte upper bound locks the win against future bloat.
  it('keeps each fragment under 280 bytes (L4 tight-imperatives bound)', () => {
    for (const role of ALL_ROLES) {
      const text = getRoleFragment(role)
      expect(text.length, `role "${role}" fragment too long: ${text.length} bytes`).toBeLessThan(280)
    }
  })

  it('coding fragment references apply_patch and verification', () => {
    const text = getRoleFragment('coding')
    expect(text).toContain('apply_patch')
    expect(text.toLowerCase()).toMatch(/verif|typecheck|test script/)
  })

  it('frontend fragment requires visual verification, not just typecheck', () => {
    const text = getRoleFragment('frontend')
    expect(text).toContain('browser_screenshot')
    expect(text.toLowerCase()).toContain('typecheck')
  })

  it('non_technical_user fragment forbids developer jargon by example', () => {
    const text = getRoleFragment('non_technical_user')
    expect(text.toLowerCase()).toContain('jargon')
    expect(text).toContain('tsc')
  })
})

describe('buildAgentSystemPrompt (multi-agentic primitive)', () => {
  it('emits the role tag and role-specific block', () => {
    const out = buildAgentSystemPrompt('planner')
    expect(out).toContain('<role>planner</role>')
    expect(out).toContain(AGENT_ROLE_PROMPTS.planner)
  })

  // L5 — sub-agent stages no longer receive the full single-agent contract.
  // They receive a slim identity head, an optional operating-principles
  // excerpt (coder only), and the role prompt.
  it('uses the slim identity head, not the full contract (L5)', () => {
    const out = buildAgentSystemPrompt('coder')
    expect(out).toContain('Lamprey multi-agent coding harness')
    expect(out).toContain('Be honest about which underlying model you are.')
    expect(out).not.toContain('<contract>')
    expect(out).not.toContain('## How you work')
  })

  it('adds the coder operating-principles block for the coder role only (L5)', () => {
    const coderOut = buildAgentSystemPrompt('coder')
    expect(coderOut).toContain('<operating_principles>')
    expect(coderOut).toContain('Make the smallest correct change')

    const plannerOut = buildAgentSystemPrompt('planner')
    expect(plannerOut).not.toContain('<operating_principles>')

    const reviewerOut = buildAgentSystemPrompt('reviewer')
    expect(reviewerOut).not.toContain('<operating_principles>')
  })

  // L5 — rendered Reviewer prompt drops at least 70% vs L1 baseline (the
  // plan's L5-only acceptance bound). L6 will tighten to ≥ 90% once the
  // PSEUDO_TAG_GUARD bake-in is removed from the reviewer role text.
  // L1 baseline was 11,016 bytes; ≥70% drop = under 3,305 bytes.
  it('renders the reviewer prompt under the L5 size target (< 3,305 bytes, ≥70% drop from L1)', () => {
    const out = buildAgentSystemPrompt('reviewer')
    expect(out.length).toBeLessThan(3305)
  })

  it('respects an explicit base override', () => {
    const out = buildAgentSystemPrompt('reviewer', 'BASE')
    expect(out.startsWith('BASE')).toBe(true)
    expect(out).toContain('<role>reviewer</role>')
    expect(out).not.toContain('<contract>')
  })
})

// RT1 + HX2 — load-bearing reviewer rules that survive L6 unchanged. The
// pseudo-tag-listing tests are gone (L6 dropped PSEUDO_TAG_GUARD from every
// injection site; `sanitizePseudoTags` in `sanitize-pseudo-tags.ts` is now
// the safety net), but the no-tools / SHIP-CHANGES / file:line / checked-
// failure-modes invariants still must hold.
describe('AGENT_ROLE_PROMPTS.reviewer — invariants preserved through L6', () => {
  const reviewer = AGENT_ROLE_PROMPTS.reviewer

  it('declares the reviewer has no tools in this stage', () => {
    expect(reviewer).toMatch(/no tools available/i)
    expect(reviewer).toMatch(/do not emit tool calls/i)
  })

  it('preserves the SHIP / CHANGES / file:line contract', () => {
    expect(reviewer).toContain('SHIP')
    expect(reviewer).toContain('CHANGES')
    expect(reviewer.toLowerCase()).toContain('file:line')
  })

  it('requires checked failure modes and evidence', () => {
    expect(reviewer).toMatch(/checked failure modes/i)
    expect(reviewer).toMatch(/receipts, diffs, contracts, or tool metadata/i)
    expect(reviewer).toMatch(/unchecked gaps/i)
  })

  // L6 — propagation test now asserts no-tools + SHIP land in the rendered
  // prompt. The prior `<bash>` / fenced-Markdown assertions are gone — L6
  // intentionally removed PSEUDO_TAG_GUARD from every injection site.
  it('propagates the load-bearing rules into buildAgentSystemPrompt output', () => {
    const out = buildAgentSystemPrompt('reviewer')
    expect(out).toMatch(/no tools available/i)
    expect(out).toContain('SHIP')
  })
})

// L6 (Lampshade Phase, 2026-06-09) — PSEUDO_TAG_GUARD is no longer injected
// into any prompt. The exported constant stays for backward compatibility
// (@deprecated). The persist-side `sanitizePseudoTags` is the safety net.
describe('PSEUDO_TAG_GUARD — deprecated; absent from every prompt path (L6)', () => {
  it('the constant is still exported (backward compat)', () => {
    expect(typeof PSEUDO_TAG_GUARD).toBe('string')
    expect(PSEUDO_TAG_GUARD.length).toBeGreaterThan(100)
  })

  it('is absent from every AGENT_ROLE_PROMPTS entry', () => {
    for (const role of Object.keys(AGENT_ROLE_PROMPTS)) {
      expect(AGENT_ROLE_PROMPTS[role], `role "${role}" still embeds PSEUDO_TAG_GUARD`).not.toContain(
        PSEUDO_TAG_GUARD
      )
    }
  })

  it('is absent from COMPOSER_SYSTEM', () => {
    expect(COMPOSER_SYSTEM).not.toContain(PSEUDO_TAG_GUARD)
  })

  it('every rendered agent prompt is free of the literal <bash> substring', () => {
    for (const role of Object.keys(AGENT_ROLE_PROMPTS) as Array<keyof typeof AGENT_ROLE_PROMPTS>) {
      const out = buildAgentSystemPrompt(role)
      expect(out, `role "${role}" rendered prompt still names <bash>`).not.toContain('<bash>')
    }
  })

  it('rendered single-agent prompt is free of the literal <bash> substring', () => {
    expect(buildSystemPrompt([], '')).not.toContain('<bash>')
    expect(
      buildSystemPrompt([], '', undefined, undefined, undefined, 'coding')
    ).not.toContain('<bash>')
  })

  // L6 — tightened reviewer size lock. Now that PSEUDO_TAG_GUARD (~700 B)
  // is gone from the reviewer role text, the L5 size lock can tighten to
  // the original plan target of <1,024 bytes (≥90% drop from L1's 11,016).
  it('rendered reviewer prompt under 1,024 bytes (L6 tightens L5)', () => {
    const out = buildAgentSystemPrompt('reviewer')
    expect(out.length).toBeLessThan(1024)
  })
})

describe('HY4 — lazy skill bodies', () => {
  const SKILL = {
    name: 'deep-research',
    description: 'Fan-out web searches and synthesize a cited report.',
    content: '# Deep Research\n\nStep 1: do X.\nStep 2: do Y.\n'.repeat(20)
  }

  it('default (eager) injects the full skill body', () => {
    const out = buildSystemPrompt([SKILL], '')
    expect(out).toContain('<skill name="deep-research">')
    expect(out).toContain('Step 1: do X')
    expect(out).not.toContain('skill_open')
  })

  it('lazy=true injects a name+description stub + skill_open hint, not the body', () => {
    const out = buildSystemPrompt(
      [SKILL], '', undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, true /* lazySkillBodies */
    )
    expect(out).toContain('status="available"')
    expect(out).toContain('Fan-out web searches')
    expect(out).toContain('skill_open("deep-research")')
    // the full repeated body is NOT inlined
    expect(out).not.toContain('Step 1: do X.\nStep 2: do Y.\n# Deep Research')
  })

  it('lazy stub falls back to the first content line when no description', () => {
    const out = buildSystemPrompt(
      [{ name: 'x', content: 'First meaningful line\nmore' }],
      '', undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, true
    )
    expect(out).toContain('First meaningful line')
    expect(out).toContain('skill_open("x")')
  })

  it('lazy stub is materially smaller than the eager body for a large skill', () => {
    const eager = buildSystemPrompt([SKILL], '').length
    const lazy = buildSystemPrompt(
      [SKILL], '', undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, true
    ).length
    expect(lazy).toBeLessThan(eager)
  })
})

describe('HY6 — exemplar-based steering (CR-7 added the reviewer exemplar)', () => {
  it('embeds the HY6 ideal tool-using exemplar inside the contract', () => {
    const out = renderContract()
    expect(out).toContain('<example>')
    expect(out).toContain('</example>')
    expect(out).toContain('shell_command: grep')
    expect(out).toContain('apply_patch')
    expect(out).toContain('verify_workspace')
  })

  // CR-7 (Cogency Restore Phase, 2026-06-09) — CR-7 adds a Reviewer-stage
  // exemplar alongside the HY6 ideal-turn exemplar. The contract now contains
  // exactly TWO `<example>` blocks (was 1 pre-CR-7); future additions to the
  // exemplar set need to deliberately update this assertion.
  it('CR-7: contains exactly two exemplars (HY6 ideal turn + CR-7 reviewer)', () => {
    const out = renderContract()
    expect(out.split('<example>').length - 1).toBe(2)
    expect(out.split('</example>').length - 1).toBe(2)
  })

  it('keeps both exemplars inside <contract> and stays under the size guard', () => {
    const out = renderContract()
    expect(out.startsWith('<contract>')).toBe(true)
    expect(out.endsWith('</contract>')).toBe(true)
    const firstEx = out.indexOf('<example>')
    const close = out.indexOf('</contract>')
    expect(firstEx).toBeGreaterThan(0)
    expect(firstEx).toBeLessThan(close)
    // HY6 byte guard — exemplars are additive but the contract stays lean.
    // CR-7 budget allowance: ≤ 3,700 holds (CR-7 + CR-1 additions fit).
    expect(out.length).toBeLessThan(3700)
  })
})
