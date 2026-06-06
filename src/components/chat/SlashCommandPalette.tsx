import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useSlashCommandsStore,
  type SlashCommand
} from '@/stores/slash-commands-store'

// Track 2 / C4 — slash-command autocomplete popover. Mounted by
// ChatInput; visible whenever the input begins with `/`. The list
// reflects every non-hidden command (built-ins + user overrides from
// userData/slash-commands), filtered by the typed prefix and ranked
// by name overlap.
//
// Keyboard:
//   ↑ / ↓     change the focused entry (Home/End wrap)
//   Tab / Enter  insert the focused command into the input (with one trailing space)
//   Esc       close the palette without inserting
//
// `onApply(name)` is what ChatInput uses to write the selection back
// to the textarea. `onClose` closes the popover (e.g. Esc) so ChatInput
// can keep focus.

interface SlashCommandPaletteProps {
  query: string
  onApply: (name: string) => void
  onClose: () => void
  onActiveChange?: (name: string | null) => void
}

function rank(commands: SlashCommand[], query: string): SlashCommand[] {
  const q = query.toLowerCase()
  if (!q) return commands
  const matches: { cmd: SlashCommand; score: number }[] = []
  for (const c of commands) {
    if (c.hidden) continue
    const name = c.name.toLowerCase()
    let score = 0
    if (name === q) score += 100
    else if (name.startsWith(q)) score += 50
    else if (name.includes(q)) score += 10
    if (c.description.toLowerCase().includes(q)) score += 1
    if (score > 0) matches.push({ cmd: c, score })
  }
  matches.sort((a, b) => b.score - a.score)
  return matches.map((m) => m.cmd)
}

export function SlashCommandPalette({
  query,
  onApply,
  onClose,
  onActiveChange
}: SlashCommandPaletteProps) {
  const commands = useSlashCommandsStore((s) => s.commands)
  const loaded = useSlashCommandsStore((s) => s.loaded)
  const load = useSlashCommandsStore((s) => s.load)
  const applyChange = useSlashCommandsStore((s) => s.applyChange)
  const [activeIdx, setActiveIdx] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  // Live updates: chokidar fires `slash:changed` whenever a markdown
  // file in userData/slash-commands changes. The renderer just swaps
  // the array.
  useEffect(() => {
    if (!window.api?.slash?.onChanged) return
    return window.api.slash.onChanged((next) => {
      if (Array.isArray(next)) applyChange(next as SlashCommand[])
    })
  }, [applyChange])

  const ranked = useMemo(() => rank(commands, query), [commands, query])

  useEffect(() => {
    if (activeIdx >= ranked.length) setActiveIdx(0)
  }, [ranked, activeIdx])

  useEffect(() => {
    onActiveChange?.(ranked[activeIdx]?.name ?? null)
  }, [ranked, activeIdx, onActiveChange])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (ranked.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx((i) => (i + 1) % ranked.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx((i) => (i - 1 + ranked.length) % ranked.length)
      } else if (e.key === 'Tab') {
        e.preventDefault()
        const picked = ranked[activeIdx]
        if (picked) onApply(picked.name)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [ranked, activeIdx, onApply, onClose])

  if (ranked.length === 0) {
    return (
      <div className="pointer-events-auto absolute bottom-full left-0 mb-2 w-full max-w-md rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)] p-2 text-[11px] text-[var(--text-muted)] shadow-md">
        No slash command matches “/{query}”. Drop a markdown file in{' '}
        <code className="font-mono">userData/slash-commands/</code> to add one.
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      className="pointer-events-auto absolute bottom-full left-0 mb-2 max-h-[260px] w-full max-w-md overflow-y-auto rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)] shadow-md"
    >
      {ranked.map((c, i) => {
        const active = i === activeIdx
        return (
          <button
            key={c.name}
            onMouseEnter={() => setActiveIdx(i)}
            onClick={() => onApply(c.name)}
            className={
              'flex w-full items-start gap-2 border-b border-[var(--panel-border)] px-2 py-1.5 text-left last:border-b-0 ' +
              (active ? 'bg-[var(--bg-secondary)]' : 'hover:bg-[var(--bg-secondary)]')
            }
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12px] text-[var(--accent)]">/{c.name}</span>
                <span className="rounded bg-[var(--bg-secondary)] px-1 text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
                  {c.source}
                </span>
                {c.args.length > 0 && (
                  <span className="font-mono text-[10px] text-[var(--text-muted)]">
                    {c.args.map((a) => `<${a}>`).join(' ')}
                  </span>
                )}
              </div>
              <p className="m-0 mt-0.5 line-clamp-2 text-[11px] text-[var(--text-muted)]">
                {c.description}
              </p>
            </div>
          </button>
        )
      })}
    </div>
  )
}
