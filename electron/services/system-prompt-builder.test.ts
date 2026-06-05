import { describe, it, expect } from 'vitest'
import {
  AGENT_ROLE_PROMPTS,
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

const EXPECTED_SECTION_HEADINGS = [
  'Chain-of-thought (REQUIRED)',
  'Understand intent',
  'Gather context before editing',
  'Use tools as evidence',
  'Protect user work',
  'Verify before claiming done',
  'Progress updates',
  'Standalone deliverables',
  'Final response'
]

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
})

describe('buildSystemPrompt — default base', () => {
  it('includes the honest-identity sentence', () => {
    const out = buildSystemPrompt([], '')
    expect(out).toContain('Lamprey is the interface, not the model')
  })

  it('includes the full Codex Agent Contract', () => {
    const out = buildSystemPrompt([], '')
    for (const heading of EXPECTED_SECTION_HEADINGS) {
      expect(out).toContain(`## ${heading}`)
    }
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
    expect(out).toContain('You are in coding mode.')
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

  it('includes the default contract when no base override is given', () => {
    const out = buildAgentSystemPrompt('coder')
    expect(out).toContain('Lamprey is the interface, not the model')
    expect(out).toContain('<contract>')
  })

  it('respects an explicit base override', () => {
    const out = buildAgentSystemPrompt('reviewer', 'BASE')
    expect(out.startsWith('BASE')).toBe(true)
    expect(out).toContain('<role>reviewer</role>')
    expect(out).not.toContain('<contract>')
  })
})
