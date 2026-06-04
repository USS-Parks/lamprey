export const meta = {
  name: 'multi-modal-sweep',
  description:
    'Parallel finders each searching a different way (by-container, by-content, by-entity, by-time). Each is blind to what the others surface; useful when one search angle would miss things.',
  phases: [{ title: 'Sweep' }, { title: 'Synthesise' }]
}

const FIND_SCHEMA = {
  type: 'object',
  properties: { findings: { type: 'array' } },
  required: ['findings']
}

const target = args && args.target ? String(args.target) : ''
const lenses =
  args && Array.isArray(args.lenses) && args.lenses.length > 0
    ? args.lenses
    : ['by-container', 'by-content', 'by-entity', 'by-time']
if (!target) return { findings: [], lensesRun: 0, note: 'no target supplied' }

phase('Sweep')
const sweeps = await parallel(
  lenses.map((lens, i) => () =>
    agent(
      `Search angle: ${lens}\n\nFind everything you can about: ${target}\n\nReply with JSON {findings: array}. Use only the search angle you were assigned; do not duplicate other angles' work.`,
      {
        label: 'sweep-' + lens,
        phase: 'Sweep',
        agentType: 'Explore',
        // B5: lenses on cheap tier — parallel discovery is volume work.
        model: 'cheap',
        schema: FIND_SCHEMA
      }
    )
  )
)

// Dedup across all lenses' findings. Stringify objects for key building.
const seen = new Set()
const merged = []
for (let i = 0; i < sweeps.length; i++) {
  const r = sweeps[i]
  if (!r) continue
  const arr = Array.isArray(r.findings) ? r.findings : []
  for (const f of arr) {
    const key = typeof f === 'string' ? f : JSON.stringify(f)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push({ lens: lenses[i], finding: f })
  }
}

phase('Synthesise')
log('merged ' + merged.length + ' unique findings across ' + lenses.length + ' lenses')
const summary = await agent(
  `Summarise the unified result set below into 3-5 bullets capturing the top themes.\n\n${JSON.stringify(merged)}`,
  {
    label: 'synthesise',
    phase: 'Synthesise',
    agentType: 'general',
    // B5: synthesis on top tier — themes need a stronger summariser.
    model: 'pro'
  }
)

return {
  findings: merged,
  lensesRun: lenses.length,
  summary
}
