import { useEffect, useMemo, useState } from 'react'
import { toast } from '@/stores/toast-store'
import {
  useHooksStore,
  type Hook,
  type HookEvent,
  type HookLanguage,
  type HookSampleContext
} from '@/stores/hooks-store'

// Track 2 / C2 — HooksSettings. Per-event tab strip with count badges,
// per-hook editor pane (label, code, language, timeout, enabled), and a
// test-run panel beneath the editor. Hooks created here default to the
// JavaScript sandbox; legacy shell hooks created before C2 keep showing
// up with a 'shell' badge and stay read-only here.

const EVENT_OPTIONS: HookEvent[] = [
  'sessionStart',
  'promptSubmit',
  'preToolUse',
  'postToolUse',
  'agentStop'
]

const EVENT_DESCRIPTIONS: Record<HookEvent, string> = {
  sessionStart: 'Fires once when the app launches.',
  promptSubmit: 'Fires when a user prompt is submitted. Sandbox: `promptBody`, `conversationId`.',
  preToolUse:
    'Fires before any tool runs. Sandbox: `toolName`, `args`, `conversationId`. Throw any value to BLOCK the call — the thrown message reaches the model as the tool result.',
  postToolUse:
    'Fires after a tool returns. Sandbox: `toolName`, `args`, `result`, `conversationId`. Throws are logged but cannot unblock the call.',
  agentStop:
    'Fires when a model finishes streaming. Sandbox: `conversationId`. Useful for chime-on-done style hooks.'
}

const SAMPLE_CONTEXT: Record<HookEvent, HookSampleContext> = {
  sessionStart: { cwd: 'C:\\workspace' },
  promptSubmit: {
    conversationId: 'sample-conv',
    promptBody: 'Refactor the auth module.',
    cwd: 'C:\\workspace'
  },
  preToolUse: {
    conversationId: 'sample-conv',
    toolName: 'shell_command',
    args: { command: 'rm -rf node_modules' },
    cwd: 'C:\\workspace'
  },
  postToolUse: {
    conversationId: 'sample-conv',
    toolName: 'shell_command',
    args: { command: 'ls' },
    result: 'file_a.ts\nfile_b.ts',
    cwd: 'C:\\workspace'
  },
  agentStop: { conversationId: 'sample-conv' }
}

const STARTER_TEMPLATE: Record<HookEvent, string> = {
  sessionStart: '// Lamprey just started.\nlog("session started at", new Date().toISOString())',
  promptSubmit:
    '// Inspect or log the submitted prompt.\nlog("prompt:", promptBody?.slice(0, 80))',
  preToolUse:
    '// Block dangerous shell commands.\nif (toolName === "shell_command" && /rm\\s+-rf/.test(args?.command ?? "")) {\n  throw "rm -rf blocked by hook"\n}',
  postToolUse:
    '// Log every tool call.\nlog(toolName, "→", (result ?? "").slice(0, 120))',
  agentStop: '// Notify on completion.\nlog("run finished for", conversationId)'
}

interface EditorState {
  hookId: string | null
  event: HookEvent
  label: string
  code: string
  language: HookLanguage
  timeoutMs: number
  enabled: boolean
}

function emptyEditor(event: HookEvent): EditorState {
  return {
    hookId: null,
    event,
    label: '',
    code: STARTER_TEMPLATE[event],
    language: 'js',
    timeoutMs: 5000,
    enabled: true
  }
}

function editorFromHook(h: Hook): EditorState {
  return {
    hookId: h.id,
    event: h.event,
    label: h.label,
    code: h.command,
    language: h.language,
    timeoutMs: h.timeoutMs,
    enabled: h.enabled
  }
}

export function HooksSettings() {
  const hooks = useHooksStore((s) => s.hooks)
  const loaded = useHooksStore((s) => s.loaded)
  const lastTest = useHooksStore((s) => s.lastTest)
  const load = useHooksStore((s) => s.load)
  const create = useHooksStore((s) => s.create)
  const update = useHooksStore((s) => s.update)
  const remove = useHooksStore((s) => s.remove)
  const test = useHooksStore((s) => s.test)
  const clearLastTest = useHooksStore((s) => s.clearLastTest)

  const [activeEvent, setActiveEvent] = useState<HookEvent>('preToolUse')
  const [editor, setEditor] = useState<EditorState>(() => emptyEditor('preToolUse'))
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  const hooksForEvent = useMemo(
    () => hooks.filter((h) => h.event === activeEvent),
    [hooks, activeEvent]
  )
  const countsByEvent = useMemo(() => {
    const m: Record<HookEvent, number> = {
      sessionStart: 0,
      promptSubmit: 0,
      preToolUse: 0,
      postToolUse: 0,
      agentStop: 0
    }
    for (const h of hooks) m[h.event]++
    return m
  }, [hooks])

  const switchTab = (ev: HookEvent) => {
    setActiveEvent(ev)
    setEditor(emptyEditor(ev))
    clearLastTest()
  }

  const editHook = (h: Hook) => {
    setEditor(editorFromHook(h))
    clearLastTest()
  }

  const newHook = () => {
    setEditor(emptyEditor(activeEvent))
    clearLastTest()
  }

  const save = async () => {
    if (!editor.label.trim()) {
      toast.error('label required')
      return
    }
    if (!editor.code.trim()) {
      toast.error('code required')
      return
    }
    setSaving(true)
    try {
      if (editor.hookId) {
        const ok = await update(editor.hookId, {
          event: editor.event,
          label: editor.label.trim(),
          command: editor.code,
          enabled: editor.enabled,
          language: editor.language,
          timeoutMs: editor.timeoutMs
        })
        if (!ok) toast.error('update failed')
        else toast.success('saved')
      } else {
        const created = await create({
          event: editor.event,
          label: editor.label.trim(),
          command: editor.code,
          language: editor.language,
          timeoutMs: editor.timeoutMs
        })
        if (!created) toast.error('create failed')
        else {
          toast.success('created')
          setEditor(editorFromHook(created))
        }
      }
    } finally {
      setSaving(false)
    }
  }

  const runTest = async () => {
    setTesting(true)
    try {
      const r = await test({
        code: editor.code,
        event: editor.event,
        context: SAMPLE_CONTEXT[editor.event],
        timeoutMs: editor.timeoutMs
      })
      if (!r) toast.error('test failed')
    } finally {
      setTesting(false)
    }
  }

  const handleDelete = async () => {
    if (!editor.hookId) return
    if (!confirm(`Delete hook "${editor.label}"?`)) return
    const ok = await remove(editor.hookId)
    if (!ok) toast.error('delete failed')
    else {
      toast.success('deleted')
      setEditor(emptyEditor(activeEvent))
    }
  }

  const toggleEnabled = async (h: Hook) => {
    await update(h.id, { enabled: !h.enabled })
    if (editor.hookId === h.id) setEditor((e) => ({ ...e, enabled: !h.enabled }))
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-[14px] font-medium text-[var(--text-primary)]">Hooks</h2>
        <p className="mt-1 text-[12px] text-[var(--text-muted)]">
          Run JavaScript inside a sandboxed <code className="font-mono">vm</code> on lifecycle
          events. <code className="font-mono">preToolUse</code> hooks can <em>block</em> a tool
          call by throwing — the message is surfaced to the model. Bindings: <code>event</code>,{' '}
          <code>conversationId</code>, <code>toolName</code>, <code>args</code>, <code>result</code>,{' '}
          <code>promptBody</code>, <code>cwd</code>, <code>log(...)</code>.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] p-1">
        {EVENT_OPTIONS.map((ev) => {
          const active = ev === activeEvent
          const count = countsByEvent[ev]
          return (
            <button
              key={ev}
              onClick={() => switchTab(ev)}
              className={
                'rounded px-3 py-1 text-[12px] transition-colors ' +
                (active
                  ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] ring-1 ring-[var(--accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]')
              }
              title={EVENT_DESCRIPTIONS[ev]}
            >
              {ev}
              <span className="ml-1.5 inline-block min-w-[1.25rem] rounded-full bg-[var(--bg-secondary)] px-1.5 text-center text-[10px] text-[var(--text-muted)]">
                {count}
              </span>
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-[260px_1fr] gap-3">
        <div className="rounded border border-[var(--border)] bg-[var(--bg-primary)]">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-2 py-1.5">
            <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
              Hooks ({hooksForEvent.length})
            </span>
            <button
              onClick={newHook}
              className="rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[11px] hover:border-[var(--accent)]"
            >
              + new
            </button>
          </div>
          <div className="max-h-[300px] overflow-y-auto p-1">
            {!loaded && (
              <div className="px-2 py-3 text-[11px] text-[var(--text-muted)]">Loading…</div>
            )}
            {loaded && hooksForEvent.length === 0 && (
              <div className="px-2 py-3 text-[11px] text-[var(--text-muted)]">
                No hooks for this event yet.
              </div>
            )}
            {hooksForEvent.map((h) => {
              const active = editor.hookId === h.id
              return (
                <div
                  key={h.id}
                  className={
                    'mb-1 flex items-center gap-2 rounded px-2 py-1 text-[12px] ' +
                    (active
                      ? 'bg-[var(--bg-secondary)] ring-1 ring-[var(--accent)]'
                      : 'hover:bg-[var(--bg-secondary)]')
                  }
                >
                  <input
                    type="checkbox"
                    checked={h.enabled}
                    onChange={(e) => {
                      e.stopPropagation()
                      void toggleEnabled(h)
                    }}
                    onClick={(e) => e.stopPropagation()}
                    title={h.enabled ? 'enabled' : 'disabled'}
                  />
                  <button
                    onClick={() => editHook(h)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate font-medium">{h.label}</span>
                    <span className="block truncate text-[10px] text-[var(--text-muted)]">
                      {h.language === 'shell' ? 'shell' : 'js'} · {h.timeoutMs} ms
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded border border-[var(--border)] bg-[var(--bg-primary)] p-3">
          <p className="mb-2 text-[11px] text-[var(--text-muted)]">
            {EVENT_DESCRIPTIONS[editor.event]}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)]">
              Label
              <input
                value={editor.label}
                onChange={(e) => setEditor((s) => ({ ...s, label: e.target.value }))}
                placeholder="block-rm-rf"
                className="rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)]">
              Timeout (ms)
              <input
                type="number"
                min={100}
                max={60000}
                value={editor.timeoutMs}
                onChange={(e) =>
                  setEditor((s) => ({
                    ...s,
                    timeoutMs: Math.max(100, Math.min(60000, Number(e.target.value) || 5000))
                  }))
                }
                className="rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            </label>
          </div>

          {editor.language === 'shell' && (
            <p className="mt-2 rounded border border-[var(--warning)] bg-[var(--bg-secondary)] px-2 py-1 text-[11px] text-[var(--warning)]">
              Legacy shell hook (pre-C2). Edits keep the shell runtime; new hooks use the JS sandbox.
            </p>
          )}

          <label className="mt-3 block text-[11px] text-[var(--text-muted)]">Body (JS)</label>
          <textarea
            value={editor.code}
            onChange={(e) => setEditor((s) => ({ ...s, code: e.target.value }))}
            spellCheck={false}
            className="mt-1 h-[200px] w-full resize-y rounded border border-[var(--border)] bg-[var(--bg-secondary)] p-2 font-mono text-[12px] leading-relaxed text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1 text-[12px] hover:border-[var(--accent)] disabled:opacity-50"
            >
              {saving ? 'Saving…' : editor.hookId ? 'Save' : 'Create'}
            </button>
            <button
              onClick={runTest}
              disabled={testing || editor.language !== 'js'}
              title={editor.language !== 'js' ? 'test-run is JS-only' : undefined}
              className="rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1 text-[12px] hover:border-[var(--accent)] disabled:opacity-50"
            >
              {testing ? 'Running…' : 'Test'}
            </button>
            {editor.hookId && (
              <button
                onClick={handleDelete}
                className="rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1 text-[12px] text-[var(--error)] hover:border-[var(--error)]"
              >
                Delete
              </button>
            )}
            <label className="ml-auto flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
              <input
                type="checkbox"
                checked={editor.enabled}
                onChange={(e) => setEditor((s) => ({ ...s, enabled: e.target.checked }))}
              />
              enabled
            </label>
          </div>

          {lastTest && (
            <div className="mt-3 rounded border border-[var(--border)] bg-[var(--bg-secondary)] p-2 text-[11px]">
              <div className="mb-1 flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--accent)]">
                  test {lastTest.event}
                </span>
                {lastTest.result.thrown ? (
                  <span className="rounded bg-[var(--error)] px-1.5 py-0.5 text-[10px] text-white">
                    BLOCKED
                  </span>
                ) : (
                  <span className="rounded bg-[var(--success)] px-1.5 py-0.5 text-[10px] text-white">
                    OK
                  </span>
                )}
                <button
                  onClick={() => clearLastTest()}
                  className="ml-auto text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  clear
                </button>
              </div>
              {lastTest.result.thrown && (
                <pre className="m-0 mb-1 whitespace-pre-wrap break-all font-mono text-[11px] text-[var(--error)]">
                  thrown: {lastTest.result.thrown}
                </pre>
              )}
              {lastTest.result.logs.length === 0 && !lastTest.result.thrown && (
                <p className="m-0 text-[var(--text-muted)]">(no log output)</p>
              )}
              {lastTest.result.logs.map((l, i) => (
                <pre
                  key={i}
                  className={
                    'm-0 whitespace-pre-wrap break-all font-mono text-[11px] ' +
                    (l.kind === 'error'
                      ? 'text-[var(--error)]'
                      : 'text-[var(--text-muted)]')
                  }
                >
                  {l.kind === 'error' ? '⚠ ' : '› '}
                  {l.message}
                </pre>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
