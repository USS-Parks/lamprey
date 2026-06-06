import type { HookEvent } from '@/stores/hooks-store'

export interface HookTemplate {
  id: string
  label: string
  event: HookEvent
  description: string
  timeoutMs: number
  code: string
}

export const HOOK_TEMPLATES: HookTemplate[] = [
  {
    id: 'block-shell-in-prod',
    label: 'Block shell in prod',
    event: 'preToolUse',
    description: 'Stops destructive shell commands when the current folder looks production-like.',
    timeoutMs: 3000,
    code:
      'const command = String(args?.command ?? "")\n' +
      'const target = String(cwd ?? "")\n' +
      'const isProd = /prod|production|release/i.test(target)\n' +
      'const isRisky = /\\b(rm|del|Remove-Item|git\\s+reset)\\b/i.test(command)\n' +
      '\n' +
      'if (toolName === "shell_command" && isProd && isRisky) {\n' +
      '  throw `Blocked risky shell command in ${target}`\n' +
      '}\n' +
      '\n' +
      'log("shell command allowed", command.slice(0, 120))'
  },
  {
    id: 'log-tools-to-memory',
    label: 'Log tools to memory',
    event: 'postToolUse',
    description: 'Records a compact audit line for each tool call result.',
    timeoutMs: 5000,
    code:
      'const renderedArgs = JSON.stringify(args ?? {})\n' +
      'const renderedResult = String(result ?? "").slice(0, 160)\n' +
      'log(`[tool] ${toolName} ${renderedArgs} => ${renderedResult}`)'
  },
  {
    id: 'auto-format-on-write',
    label: 'Auto-format on write',
    event: 'postToolUse',
    description:
      'Detects file-writing tool results and leaves a formatter reminder in the hook log.',
    timeoutMs: 4000,
    code:
      'const name = String(toolName ?? "")\n' +
      'const command = String(args?.command ?? "")\n' +
      'const writesFile = /apply_patch|write|edit|Set-Content|Out-File/i.test(name + " " + command)\n' +
      '\n' +
      'if (writesFile) {\n' +
      '  log("format-check recommended after file write", { toolName, cwd })\n' +
      '}'
  }
]

interface HookTemplatesGalleryProps {
  activeEvent: HookEvent
  applyingId: string | null
  onApply: (template: HookTemplate) => void
}

export function HookTemplatesGallery({
  activeEvent,
  applyingId,
  onApply
}: HookTemplatesGalleryProps) {
  return (
    <div className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
          Templates
        </span>
        <span className="text-[10px] text-[var(--text-muted)]">create ready-to-edit hooks</span>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        {HOOK_TEMPLATES.map((template) => {
          const matchesEvent = template.event === activeEvent
          return (
            <button
              key={template.id}
              onClick={() => onApply(template)}
              disabled={applyingId !== null}
              className={
                'min-h-[86px] rounded border bg-[var(--bg-secondary)] p-2 text-left transition-colors disabled:opacity-50 ' +
                (matchesEvent
                  ? 'border-[var(--accent)]'
                  : 'border-[var(--panel-border)] hover:border-[var(--accent)]')
              }
            >
              <span className="block text-[12px] font-medium text-[var(--text-primary)]">
                {template.label}
              </span>
              <span className="mt-1 block text-[10px] uppercase tracking-wider text-[var(--accent)]">
                {template.event} / {template.timeoutMs} ms
              </span>
              <span className="mt-1 block text-[11px] leading-snug text-[var(--text-muted)]">
                {applyingId === template.id ? 'Creating...' : template.description}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
