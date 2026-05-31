import startupImageUrl from '@assets/Lamprey Startup FINAL.png'

const QUICK_PROMPTS: { title: string; body: string }[] = [
  {
    title: 'Plan a refactor',
    body: 'Plan a multi-step refactor of'
  },
  {
    title: 'Fix a bug',
    body: 'Find and fix the bug in'
  },
  {
    title: 'Write a feature',
    body: 'Implement the following feature end-to-end:'
  },
  {
    title: 'Review a diff',
    body: 'Review the following diff for correctness and regressions:'
  }
]

export function WelcomeScreen() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col items-center text-center">
        <img
          src={startupImageUrl}
          alt=""
          aria-hidden
          className="icon-asset mb-6 h-40 w-40 object-contain"
        />
        <h1 className="font-mono text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          Lamprey Harness
        </h1>
        <h2 className="mt-2 text-sm font-normal text-[var(--text-secondary)]">
          Multi-agent coding UI · DeepSeek V4 Pro · V4 Flash · Gemma · Qwen
        </h2>
        <p className="mt-3 max-w-lg text-[12px] leading-relaxed text-[var(--text-muted)]">
          Switch models per turn, or flip Multi-agent mode in Settings → Agents to run a
          Planner → Coder → Reviewer pipeline across providers.
        </p>

        <div className="mt-8 grid w-full grid-cols-2 gap-2">
          {QUICK_PROMPTS.map((p) => (
            <button
              key={p.title}
              onClick={() => {
                const input = document.querySelector<HTMLTextAreaElement>('textarea[data-chat-input]')
                if (input) {
                  input.value = p.body + ' '
                  input.dispatchEvent(new Event('input', { bubbles: true }))
                  input.focus()
                }
              }}
              className="rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] p-3 text-left transition-colors hover:border-[var(--accent)]"
            >
              <div className="font-mono text-xs font-semibold text-[var(--text-primary)]">
                {p.title}
              </div>
              <div className="mt-1 text-[11px] text-[var(--text-muted)]">{p.body}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
