import { useEffect, useState, useCallback } from 'react'
import { MarkdownRenderer } from '@/components/artifacts/MarkdownRenderer'

interface AskUserOption {
  label: string
  description?: string
  preview?: string
}

interface AskUserAwaitingEvent {
  requestId: string
  question: string
  header: string
  options: AskUserOption[]
  multiSelect: boolean
  timeoutMs: number
  askedAt: number
}

// H6 — Modal surfaced when a workflow or subagent invokes ask_user_question
// (or `askUser(...)` in workflow sandbox). Chip-style options + an
// auto-appended "Other" free-text path. The caller's promise stays parked
// in the main-process runtime until the user picks (or timeout fires); the
// modal just relays the choice back via ask-user:respond.
export function AskUserModal() {
  const [event, setEvent] = useState<AskUserAwaitingEvent | null>(null)
  const [focusIdx, setFocusIdx] = useState<number>(0)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [otherText, setOtherText] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [remainingMs, setRemainingMs] = useState<number>(0)

  useEffect(() => {
    if (!window.api?.askUser) return
    const dispose = window.api.askUser.onAwaiting((raw) => {
      const e = raw as AskUserAwaitingEvent
      setEvent(e)
      setFocusIdx(0)
      setPicked(new Set())
      setOtherText('')
      setNotes('')
      setRemainingMs(e.timeoutMs)
    })
    return typeof dispose === 'function' ? dispose : undefined
  }, [])

  // Countdown
  useEffect(() => {
    if (!event) return
    const start = Date.now()
    const id = setInterval(() => {
      const elapsed = Date.now() - start
      const left = Math.max(0, event.timeoutMs - elapsed)
      setRemainingMs(left)
      if (left === 0) clearInterval(id)
    }, 250)
    return () => clearInterval(id)
  }, [event])

  const close = useCallback(() => setEvent(null), [])

  const submit = useCallback(
    async (answer: unknown) => {
      if (!event) return
      try {
        await window.api?.askUser.respond({ requestId: event.requestId, answer })
      } catch (err) {
        console.error('[AskUserModal] respond failed:', err)
      }
      close()
    },
    [event, close]
  )

  const cancel = useCallback(() => {
    if (!event) return
    void submit({ kind: 'cancelled' })
  }, [event, submit])

  const confirm = useCallback(() => {
    if (!event) return
    const trimmedNotes = notes.trim() || undefined
    if (event.multiSelect) {
      const labels: string[] = []
      for (const idx of picked) {
        if (idx < event.options.length) labels.push(event.options[idx].label)
        else if (otherText.trim()) labels.push(otherText.trim())
      }
      if (labels.length === 0) return
      void submit({ kind: 'multi', labels, header: event.header, notes: trimmedNotes })
    } else {
      const idx = focusIdx
      if (idx === event.options.length) {
        if (!otherText.trim()) return
        void submit({
          kind: 'single',
          label: otherText.trim(),
          header: event.header,
          notes: trimmedNotes
        })
        return
      }
      void submit({
        kind: 'single',
        label: event.options[idx].label,
        header: event.header,
        notes: trimmedNotes
      })
    }
  }, [event, picked, focusIdx, otherText, notes, submit])

  // Keyboard nav
  useEffect(() => {
    if (!event) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusIdx((i) => Math.min(i + 1, (event?.options.length ?? 0)))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusIdx((i) => Math.max(0, i - 1))
      } else if (e.key === 'Enter' && !(e.target as HTMLElement)?.closest('textarea, input')) {
        e.preventDefault()
        confirm()
      } else if (event && event.multiSelect && e.key === ' ') {
        e.preventDefault()
        setPicked((prev) => {
          const next = new Set(prev)
          if (next.has(focusIdx)) next.delete(focusIdx)
          else next.add(focusIdx)
          return next
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [event, focusIdx, cancel, confirm])

  if (!event) return null

  const otherIdx = event.options.length
  const optionRows = event.options.map((opt, i) => {
    const isFocused = focusIdx === i
    const isPicked = picked.has(i)
    return (
      <button
        key={`opt-${i}`}
        type="button"
        onClick={() => {
          setFocusIdx(i)
          if (event.multiSelect) {
            setPicked((prev) => {
              const next = new Set(prev)
              if (next.has(i)) next.delete(i)
              else next.add(i)
              return next
            })
          } else {
            // single-select click = submit immediately for snappy UX
            void submit({
              kind: 'single',
              label: opt.label,
              header: event.header,
              notes: notes.trim() || undefined
            })
          }
        }}
        className={
          'w-full rounded-lg border px-3 py-2 text-left transition-colors ' +
          (isFocused
            ? 'border-[var(--accent)] bg-[var(--accent)]/10'
            : 'border-[var(--border)] bg-[var(--bg-secondary)] hover:border-[var(--accent)]/60')
        }
      >
        <div className="flex items-center gap-2">
          {event.multiSelect && (
            <span
              className={
                'inline-flex h-4 w-4 items-center justify-center rounded border ' +
                (isPicked
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                  : 'border-[var(--border)] bg-transparent')
              }
              aria-hidden
            >
              {isPicked ? '✓' : ''}
            </span>
          )}
          <span className="text-[13px] font-medium text-[var(--text-primary)]">{opt.label}</span>
        </div>
        {opt.description && (
          <div className="mt-1 text-[12px] text-[var(--text-muted)]">{opt.description}</div>
        )}
      </button>
    )
  })

  const focusedOption =
    focusIdx >= 0 && focusIdx < event.options.length ? event.options[focusIdx] : null

  const seconds = Math.ceil(remainingMs / 1000)

  return (
    <div
      role="dialog"
      aria-label="Question from agent"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
      onClick={cancel}
    >
      <div
        className="flex max-h-[80vh] w-[640px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--accent)]">
              {event.header.slice(0, 12)}
            </span>
            <span className="text-[11px] text-[var(--text-muted)]">
              {seconds}s · {event.multiSelect ? 'multi-select' : 'pick one'}
            </span>
          </div>
          <button
            type="button"
            onClick={cancel}
            className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            aria-label="Cancel"
          >
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex w-1/2 min-w-0 flex-col gap-2 overflow-y-auto border-r border-[var(--border)] p-4">
            <div className="text-[14px] font-medium text-[var(--text-primary)]">
              {event.question}
            </div>
            <div className="mt-2 flex flex-col gap-1.5">{optionRows}</div>
            <button
              type="button"
              onClick={() => setFocusIdx(otherIdx)}
              className={
                'mt-1 w-full rounded-lg border px-3 py-2 text-left text-[13px] transition-colors ' +
                (focusIdx === otherIdx
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                  : 'border-[var(--border)] bg-[var(--bg-secondary)] hover:border-[var(--accent)]/60')
              }
            >
              <div className="font-medium text-[var(--text-primary)]">Other…</div>
              <div className="mt-1 text-[12px] text-[var(--text-muted)]">
                Type a custom answer below.
              </div>
            </button>
            {focusIdx === otherIdx && (
              <input
                type="text"
                autoFocus
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                placeholder="Your answer…"
                className="rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            )}
          </div>

          <div className="flex w-1/2 min-w-0 flex-col overflow-y-auto p-4">
            {focusedOption?.preview ? (
              <div className="prose prose-sm max-w-none text-[13px] text-[var(--text-primary)]">
                <MarkdownRenderer content={focusedOption.preview} />
              </div>
            ) : (
              <div className="text-[12px] italic text-[var(--text-muted)]">
                {focusedOption?.description ?? 'Focus an option to see details.'}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes for the agent…"
            className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          <button
            type="button"
            onClick={cancel}
            className="rounded-md border border-[var(--border)] px-3 py-1 text-[12px] text-[var(--text-muted)] hover:border-[var(--accent)]/60 hover:text-[var(--text-primary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            className="rounded-md bg-[var(--accent)] px-3 py-1 text-[12px] font-medium text-white hover:opacity-90"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
