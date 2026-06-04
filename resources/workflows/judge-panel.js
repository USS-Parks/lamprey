export const meta = {
  name: 'judge-panel',
  description:
    'Generate N candidate plans from different angles, score each with parallel judges, then synthesise the winner with grafting from runners-up.',
  phases: [
    { title: 'Generate' },
    { title: 'Judge' },
    { title: 'Synthesise' }
  ]
}

const SCORE_SCHEMA = {
  type: 'object',
  properties: { score: { type: 'number' }, notes: { type: 'string' } },
  required: ['score']
}

const prompt = args && args.prompt ? String(args.prompt) : ''
const angles =
  args && Array.isArray(args.angles) && args.angles.length > 0
    ? args.angles
    : ['MVP-first', 'risk-first', 'user-first']
if (!prompt) {
  return { winner: null, scores: [], note: 'no prompt supplied' }
}

phase('Generate')
const candidates = await parallel(
  angles.map((angle, i) => () =>
    agent(
      `Propose a plan for the following request from a ${angle} angle.\n\n${prompt}`,
      {
        label: 'candidate-' + (i + 1) + ':' + angle,
        phase: 'Generate',
        agentType: 'Plan',
        // B5: candidates on cheap tier — generating N variants is volume work.
        model: 'cheap'
      }
    )
  )
)

const realCandidates = candidates.filter(Boolean)
if (realCandidates.length === 0) {
  return { winner: null, scores: [], note: 'no candidate plans returned' }
}

phase('Judge')
const judged = await parallel(
  realCandidates.map((c, i) => () =>
    agent(
      `Score this plan from 0 to 10 for goal alignment and feasibility. Plan:\n\n${typeof c === 'string' ? c : JSON.stringify(c)}\n\nReply with JSON {score: number, notes: string}.`,
      {
        label: 'judge-' + (i + 1),
        phase: 'Judge',
        agentType: 'code-reviewer',
        // B5: judges on cheap tier — rubric scoring is well-bounded.
        model: 'cheap',
        schema: SCORE_SCHEMA
      }
    )
  )
)

const scored = realCandidates.map((c, i) => ({
  candidate: c,
  score: judged[i] && typeof judged[i].score === 'number' ? judged[i].score : 0,
  notes: judged[i] && judged[i].notes ? judged[i].notes : ''
}))
scored.sort((a, b) => b.score - a.score)
const winner = scored[0]
const runners = scored.slice(1)

phase('Synthesise')
const synthesis = await agent(
  `Synthesise a final plan starting from the WINNER, grafting useful ideas from the runners-up.\n\nWINNER (score ${winner.score}):\n${typeof winner.candidate === 'string' ? winner.candidate : JSON.stringify(winner.candidate)}\n\nRUNNERS-UP:\n${runners
    .map(
      (r, i) =>
        '- (score ' + r.score + ') ' + (typeof r.candidate === 'string' ? r.candidate : JSON.stringify(r.candidate))
    )
    .join('\n')}`,
  {
    label: 'synthesise',
    phase: 'Synthesise',
    agentType: 'Plan',
    // B5: synthesis on the top tier — grafting + judgment benefit from depth.
    model: 'pro'
  }
)

return {
  winner: synthesis,
  attribution: { winnerScore: winner.score, runnerCount: runners.length },
  scores: scored.map((s) => ({ score: s.score, notes: s.notes }))
}
