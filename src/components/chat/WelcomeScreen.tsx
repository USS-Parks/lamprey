import { useUiStore } from '@/stores/ui-store'
import startupImageUrl from '@assets/Lamprey Start Up Image.png'

interface QuickPrompt {
  label: string
  description: string
  template: string
}

const QUICK_PROMPTS: QuickPrompt[] = [
  {
    label: 'Review code',
    description: 'Walk through a snippet for bugs, security, and clarity.',
    template:
      'Review this code for bugs, security issues, performance traps, and clarity. Use severity tags and end with a ship / fix / revise call.\n\n```\n\n```\n'
  },
  {
    label: 'Explain a concept',
    description: 'Distill an idea with examples and trade-offs.',
    template:
      'Explain how '
  },
  {
    label: 'Draft a commit',
    description: 'Conventional-commit message from a diff or change summary.',
    template:
      'Draft a conventional-commit message for the following change. Include a body that explains the why.\n\n'
  }
]

export function WelcomeScreen() {
  const seedComposeDraft = useUiStore((s) => s.seedComposeDraft)

  const handlePrompt = (prompt: QuickPrompt) => {
    seedComposeDraft(prompt.template)
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-2xl">
        <div className="flex flex-col items-center text-center">
          <img
            src={startupImageUrl}
            alt=""
            aria-hidden
            className="mb-5 h-32 w-32 object-contain opacity-95"
          />
          <h1 className="font-mono text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
            <span className="mr-2 text-[var(--accent)]">✱</span>What should we build?
          </h1>
          <p className="mt-3 text-sm text-[var(--text-secondary)]">
            Type below, or pick a starting point.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt.label}
              onClick={() => handlePrompt(prompt)}
              className="group flex h-full flex-col items-start gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-3 text-left transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-tertiary)]"
            >
              <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)] group-hover:text-[var(--accent)]">
                {prompt.label}
              </span>
              <span className="text-xs leading-relaxed text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">
                {prompt.description}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
