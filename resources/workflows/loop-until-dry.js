export const meta = {
  name: 'loop-until-dry',
  description:
    'Repeatedly call a finder agent until K consecutive empty rounds — the discovery loop pattern for unknown-size tasks.',
  phases: [{ title: 'Find' }]
}

const FIND_SCHEMA = {
  type: 'object',
  properties: {
    findings: { type: 'array' }
  },
  required: ['findings']
}

const prompt = args && args.prompt ? String(args.prompt) : ''
const dryRoundsTarget =
  args && Number.isInteger(args.dryRoundsTarget) ? args.dryRoundsTarget : 2
const maxRounds = args && Number.isInteger(args.maxRounds) ? args.maxRounds : 20
if (!prompt) return { findings: [], rounds: 0, note: 'no prompt supplied' }

phase('Find')
const accumulated = []
const seen = new Set()
let dry = 0
let round = 0
while (dry < dryRoundsTarget && round < maxRounds) {
  round++
  const r = await agent(
    `Round ${round}: find any items relevant to: ${prompt}\n\nAlready found (do not repeat): ${[...seen].slice(0, 10).join(', ')}\n\nReply with JSON {findings: array}. Return findings: [] if nothing new.`,
    {
      label: 'round-' + round,
      phase: 'Find',
      agentType: 'general',
      // B5: finders use cheap tier — loop-until-dry is volume-bound discovery.
      model: 'cheap',
      schema: FIND_SCHEMA
    }
  )
  const findings = r && Array.isArray(r.findings) ? r.findings : []
  const fresh = findings.filter((f) => {
    const key = typeof f === 'string' ? f : JSON.stringify(f)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (fresh.length === 0) {
    dry++
    log('round ' + round + ': dry (' + dry + '/' + dryRoundsTarget + ')')
  } else {
    dry = 0
    accumulated.push(...fresh)
    log('round ' + round + ': +' + fresh.length + ' (total ' + accumulated.length + ')')
  }
}
return { findings: accumulated, rounds: round, dryStreak: dry }
