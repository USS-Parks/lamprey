export const meta = {
  name: 'adversarial-verify',
  description:
    'Spawn N independent skeptics to refute a claim. Returns refuted:true when a majority say the claim fails. Default-to-refuted on uncertainty.',
  phases: [{ title: 'Refute', detail: 'N skeptics independently attempt refutation' }]
}

const VOTE_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' }
  },
  required: ['refuted']
}

const claim = args && args.claim ? String(args.claim) : ''
const skepticCount = args && Number.isInteger(args.skepticCount) ? args.skepticCount : 3
if (!claim) {
  return { refuted: true, reason: 'no claim supplied', votes: [] }
}

phase('Refute')
const votes = await parallel(
  Array.from({ length: skepticCount }, (_unused, i) => () =>
    agent(
      `You are skeptic #${i + 1} of ${skepticCount}. Try to REFUTE this claim:\n\n${claim}\n\nDefault to refuted=true if you are uncertain. Reply with JSON {refuted: bool, reason: string}.`,
      {
        label: 'skeptic-' + (i + 1),
        phase: 'Refute',
        agentType: 'general',
        // B5: skeptics use the cheap tier — refutation is high-volume and
        // doesn't need top-tier reasoning depth.
        model: 'cheap',
        schema: VOTE_SCHEMA
      }
    )
  )
)

const realVotes = votes.filter(Boolean)
const refutedCount = realVotes.filter((v) => v && v.refuted === true).length
const total = realVotes.length
const majority = total > 0 && refutedCount * 2 > total
log(`${refutedCount}/${total} skeptics refuted the claim — ${majority ? 'REFUTED' : 'survives'}`)

return {
  refuted: majority,
  refutedCount,
  total,
  votes: realVotes
}
