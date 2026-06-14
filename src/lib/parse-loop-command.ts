// Loop Phase LP-8 — pure parser for the `/loop` slash command. Kept separate
// from ChatInput so it unit-tests without React.
//
//   /loop <task>            → self-paced loop seeded with one task
//   /loop 5m <task>         → interval loop (s | m | h), seeded with one task
//   /loop --auto <mission>  → autonomous loop; mission seeds the backlog + is
//                             the standing instruction the model grows from

export interface ParsedLoopCommand {
  mode: 'interval' | 'self_paced' | 'autonomous'
  intervalSeconds?: number
  instruction?: string
  tasks?: string[]
  error?: string
}

export function parseLoopCommand(rest: string): ParsedLoopCommand {
  const trimmed = (rest ?? '').trim()
  if (!trimmed) {
    return {
      mode: 'self_paced',
      error: 'Usage: /loop <task> · /loop 5m <task> · /loop --auto <mission>'
    }
  }

  const autoMatch = /^--auto\b\s*([\s\S]*)$/.exec(trimmed)
  if (autoMatch) {
    const mission = autoMatch[1].trim()
    if (!mission) return { mode: 'autonomous', error: 'Usage: /loop --auto <mission>' }
    return { mode: 'autonomous', instruction: mission }
  }

  const intervalMatch = /^(\d+)\s*([smh])\b\s*([\s\S]*)$/i.exec(trimmed)
  if (intervalMatch) {
    const n = parseInt(intervalMatch[1], 10)
    const unit = intervalMatch[2].toLowerCase()
    const task = intervalMatch[3].trim()
    const mult = unit === 's' ? 1 : unit === 'm' ? 60 : 3600
    const intervalSeconds = n * mult
    if (!task) return { mode: 'interval', intervalSeconds, error: 'Usage: /loop 5m <task>' }
    return { mode: 'interval', intervalSeconds, tasks: [task] }
  }

  return { mode: 'self_paced', tasks: [trimmed] }
}
