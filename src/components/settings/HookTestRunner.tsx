import { useMemo, useState } from 'react'
import type {
  HookEvent,
  HookLanguage,
  HookSampleContext,
  HookTestResult
} from '@/stores/hooks-store'

interface SamplePayload {
  id: string
  label: string
  context: HookSampleContext
}

const SAMPLE_PAYLOADS: Record<HookEvent, SamplePayload[]> = {
  sessionStart: [
    { id: 'workspace', label: 'Workspace launch', context: { cwd: 'C:\\workspace' } },
    { id: 'project', label: 'Project launch', context: { cwd: 'C:\\workspace\\production-app' } }
  ],
  promptSubmit: [
    {
      id: 'refactor',
      label: 'Refactor prompt',
      context: {
        conversationId: 'sample-conv',
        promptBody: 'Refactor the auth module.',
        cwd: 'C:\\workspace'
      }
    },
    {
      id: 'prod',
      label: 'Production request',
      context: {
        conversationId: 'sample-conv',
        promptBody: 'Deploy the production hotfix.',
        cwd: 'C:\\workspace\\production-app'
      }
    }
  ],
  preToolUse: [
    {
      id: 'risky-shell',
      label: 'Risky shell',
      context: {
        conversationId: 'sample-conv',
        toolName: 'shell_command',
        args: { command: 'rm -rf node_modules' },
        cwd: 'C:\\workspace\\production-app'
      }
    },
    {
      id: 'read-file',
      label: 'Read file',
      context: {
        conversationId: 'sample-conv',
        toolName: 'read_file',
        args: { path: 'src/App.tsx' },
        cwd: 'C:\\workspace'
      }
    }
  ],
  postToolUse: [
    {
      id: 'shell-result',
      label: 'Shell result',
      context: {
        conversationId: 'sample-conv',
        toolName: 'shell_command',
        args: { command: 'npm test' },
        result: '1152 tests passed',
        cwd: 'C:\\workspace'
      }
    },
    {
      id: 'write-result',
      label: 'File write',
      context: {
        conversationId: 'sample-conv',
        toolName: 'apply_patch',
        args: { path: 'src/App.tsx' },
        result: 'updated 1 file',
        cwd: 'C:\\workspace'
      }
    }
  ],
  agentStop: [
    { id: 'complete', label: 'Completed run', context: { conversationId: 'sample-conv' } },
    { id: 'review', label: 'Review run', context: { conversationId: 'review-conv' } }
  ]
}

interface HookTestRunnerProps {
  event: HookEvent
  language: HookLanguage
  code: string
  timeoutMs: number
  testing: boolean
  lastTest: { code: string; event: HookEvent; result: HookTestResult } | null
  onRun: (context: HookSampleContext) => void
  onClear: () => void
}

export function HookTestRunner({
  event,
  language,
  code,
  timeoutMs,
  testing,
  lastTest,
  onRun,
  onClear
}: HookTestRunnerProps) {
  const samples = SAMPLE_PAYLOADS[event]
  const [sampleId, setSampleId] = useState(samples[0]?.id ?? '')

  const sample = useMemo(
    () => samples.find((item) => item.id === sampleId) ?? samples[0],
    [sampleId, samples]
  )

  const payloadText = useMemo(() => JSON.stringify(sample?.context ?? {}, null, 2), [sample])

  const blocked = Boolean(lastTest?.result.thrown)
  const hasLogs = Boolean(lastTest?.result.logs.length)

  return (
    <div className="mt-3 rounded border border-[var(--panel-border)] bg-[var(--bg-secondary)] p-2">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
          Test runner
        </span>
        <select
          value={sample?.id ?? ''}
          onChange={(e) => setSampleId(e.target.value)}
          className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        >
          {samples.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => sample && onRun(sample.context)}
          disabled={testing || language !== 'js' || !code.trim()}
          title={language !== 'js' ? 'test-run is JS-only' : undefined}
          className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-3 py-1 text-[12px] hover:border-[var(--accent)] disabled:opacity-50"
        >
          {testing ? 'Running...' : 'Run sample'}
        </button>
        <span className="text-[10px] text-[var(--text-muted)]">{timeoutMs} ms timeout</span>
      </div>

      <pre className="max-h-28 overflow-auto rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-2 font-mono text-[11px] leading-relaxed text-[var(--text-muted)]">
        {payloadText}
      </pre>

      {lastTest && (
        <div className="mt-2 rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-2 text-[11px]">
          <div className="mb-1 flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--accent)]">
              result {lastTest.event}
            </span>
            {blocked ? (
              <span className="rounded bg-[var(--error)] px-1.5 py-0.5 text-[10px] text-white">
                BLOCKED
              </span>
            ) : (
              <span className="rounded bg-[var(--success)] px-1.5 py-0.5 text-[10px] text-white">
                OK
              </span>
            )}
            <button
              onClick={onClear}
              className="ml-auto text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              clear
            </button>
          </div>
          {lastTest.result.thrown && (
            <pre className="m-0 mb-1 whitespace-pre-wrap break-all font-mono text-[11px] text-[var(--error)]">
              sandbox error: {lastTest.result.thrown}
            </pre>
          )}
          {!hasLogs && !blocked && <p className="m-0 text-[var(--text-muted)]">(no log output)</p>}
          {lastTest.result.logs.map((line, index) => (
            <pre
              key={index}
              className={
                'm-0 whitespace-pre-wrap break-all font-mono text-[11px] ' +
                (line.kind === 'error' ? 'text-[var(--error)]' : 'text-[var(--text-muted)]')
              }
            >
              {line.kind === 'error' ? '! ' : '> '}
              {line.message}
            </pre>
          ))}
        </div>
      )}
    </div>
  )
}
