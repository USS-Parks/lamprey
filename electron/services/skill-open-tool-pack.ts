// HY4 — `skill_open` native tool. When skills are injected as name+description
// stubs (lazy skill bodies), the model calls this to load a skill's full
// instructions on demand. Side-effect registration, loaded by tool-packs.ts.

import { toolRegistry } from './tool-registry'
import { listSkills, getSkillContent } from './skill-loader'

toolRegistry.registerNative(
  {
    id: 'skill_open',
    name: 'skill_open',
    title: 'Open skill instructions',
    description:
      'Load the full instructions for an active skill that was listed as a stub in the ' +
      'system prompt (status="available"). Pass the skill name shown on the stub. Returns the ' +
      'skill body so you can follow it.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The skill name from a <skill name="…" status="available"> stub.'
        }
      },
      required: ['name'],
      additionalProperties: false
    },
    risks: ['read'],
    requiresApproval: false,
    enabled: true,
    parallelizable: true
  },
  async (args) => {
    const name = String((args as { name?: unknown }).name ?? '').trim()
    if (!name) return JSON.stringify({ error: 'skill_open requires a "name".' })
    const skill = listSkills().find((s) => s.name === name || s.id === name)
    if (!skill) {
      return JSON.stringify({ error: `No active skill named "${name}".` })
    }
    const content = getSkillContent(skill.id)
    if (!content) {
      return JSON.stringify({ error: `Skill "${name}" has no loadable body.` })
    }
    return JSON.stringify({ name: skill.name, content })
  }
)
