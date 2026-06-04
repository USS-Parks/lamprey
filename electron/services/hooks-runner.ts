import { spawn } from 'child_process'
import vm from 'vm'
import {
  DEFAULT_HOOK_TIMEOUT_MS,
  listHooksForEvent,
  type Hook,
  type HookEvent
} from './hooks-store'

// Track 2 / C2 — hooks runner. Replaces the original shell-only,
// fire-and-forget runner with a synchronous `vm`-sandboxed JS path that
// can BLOCK tool dispatch when `preToolUse` hooks throw. Track 1 / B1's
// workflow runner will eventually share this same sandbox pattern (Node
// built-in `vm`, frozen sandbox, configurable timeout); this module owns
// the hook-specific surface area until B1 lands and we can extract the
// sandbox helper.
//
// Sandbox bindings exposed to hook bodies:
//
//   event           string             which event fired
//   conversationId  string | undefined the firing conversation
//   toolName        string | undefined preToolUse / postToolUse
//   args            object | undefined deep-cloned tool arguments
//   result          string | undefined postToolUse only — model-facing
//                                      result body (capped at 8 KB)
//   promptBody      string | undefined promptSubmit only — first 4 KB
//                                      of the user's input
//   cwd             string             active workspace path
//   log(...parts)   function           emit a log line back to main
//   console.log     alias for log
//   Date            stdlib Date — read-only timestamps
//   JSON            stdlib JSON
//   Math            stdlib Math
//
// To block a tool call from `preToolUse`, throw any value — its
// stringified message reaches the model as the synthetic tool result and
// becomes the call's audit record. For all other events, throws are
// captured as log entries but do not block.

export interface HookContext {
  conversationId?: string
  toolName?: string
  args?: Record<string, unknown>
  /** Set on `postToolUse`. Capped to 8 KB before reaching the sandbox so
   *  a runaway result body does not balloon the hook payload. */
  result?: string
  /** Set on `promptSubmit`. Capped to 4 KB. */
  promptBody?: string
  cwd?: string
}

export interface HookLogEntry {
  hookId: string
  hookLabel: string
  kind: 'log' | 'error'
  message: string
}

export interface HookFireResult {
  blocked: boolean
  blockReason?: string
  logs: HookLogEntry[]
}

const PROMPT_CAP = 4096
const RESULT_CAP = 8192

function clamp(s: string | undefined, cap: number): string | undefined {
  if (s === undefined) return undefined
  return s.length > cap ? s.slice(0, cap) : s
}

function makeArgsSnapshot(args: Record<string, unknown> | undefined): unknown {
  if (!args) return undefined
  // structuredClone is available in Node 17+. Used so a hook mutating its
  // `args` view cannot leak the mutation back into the dispatcher.
  try {
    return structuredClone(args)
  } catch {
    // Non-cloneable inputs (functions, native handles) → fall back to
    // JSON round-trip. Any value that isn't JSON-safe disappears, which
    // is the desired conservative behaviour for hook bodies.
    try {
      return JSON.parse(JSON.stringify(args))
    } catch {
      return {}
    }
  }
}

function buildSandbox(
  event: HookEvent,
  ctx: HookContext,
  hook: Pick<Hook, 'id' | 'label'>,
  logs: HookLogEntry[]
): Record<string, unknown> {
  const append = (kind: 'log' | 'error', parts: unknown[]): void => {
    const message = parts
      .map((p) => {
        if (typeof p === 'string') return p
        try {
          return JSON.stringify(p)
        } catch {
          return String(p)
        }
      })
      .join(' ')
    logs.push({ hookId: hook.id, hookLabel: hook.label, kind, message })
  }
  return {
    event,
    conversationId: ctx.conversationId,
    toolName: ctx.toolName,
    args: makeArgsSnapshot(ctx.args),
    result: clamp(ctx.result, RESULT_CAP),
    promptBody: clamp(ctx.promptBody, PROMPT_CAP),
    cwd: ctx.cwd ?? '',
    log: (...parts: unknown[]) => append('log', parts),
    console: {
      log: (...parts: unknown[]) => append('log', parts),
      error: (...parts: unknown[]) => append('error', parts),
      warn: (...parts: unknown[]) => append('log', parts)
    },
    Date,
    JSON,
    Math
  }
}

function runJsHook(
  hook: Pick<Hook, 'id' | 'label' | 'command' | 'timeoutMs'>,
  event: HookEvent,
  ctx: HookContext,
  logs: HookLogEntry[]
): { thrown?: string } {
  const sandbox = buildSandbox(event, ctx, hook, logs)
  const vmContext = vm.createContext(sandbox, { name: `lamprey-hook-${hook.id}` })
  const timeout =
    typeof hook.timeoutMs === 'number' && hook.timeoutMs > 0
      ? hook.timeoutMs
      : DEFAULT_HOOK_TIMEOUT_MS
  const filename = `hook-${hook.label.replace(/[^\w-]/g, '_').slice(0, 40)}.js`
  try {
    // Wrap in an IIFE so the body can use `return`, and run in strict mode
    // so accidental implicit globals fail fast at hook-author time.
    const script = new vm.Script(
      `(function(){ "use strict";\n${hook.command}\n})()`,
      { filename }
    )
    script.runInContext(vmContext, { timeout })
    return {}
  } catch (err: any) {
    return { thrown: String(err?.message ?? err) }
  }
}

function buildShellEnv(event: HookEvent, ctx: HookContext): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  env.LAMPREY_HOOK_EVENT = event
  env.LAMPREY_HOOK_TIMESTAMP = String(Date.now())
  if (ctx.conversationId) env.LAMPREY_HOOK_CONVERSATION_ID = ctx.conversationId
  if (ctx.toolName) env.LAMPREY_HOOK_TOOL_NAME = ctx.toolName
  if (ctx.promptBody) env.LAMPREY_HOOK_PROMPT_BODY = clamp(ctx.promptBody, PROMPT_CAP)!
  env.LAMPREY_HOOK_CWD = ctx.cwd || process.cwd()
  return env
}

// Legacy fire-and-forget shell path. Preserved for rows that predate the
// `language` column (migrated to 'shell' via database.ts). New rows from
// the UI are always 'js' and run through `runJsHook`. Never blocks; logs
// go to stderr.
function runShellHook(hook: Hook, event: HookEvent, ctx: HookContext): void {
  try {
    const env = buildShellEnv(event, ctx)
    const proc = spawn(hook.command, {
      shell: true,
      env,
      cwd: ctx.cwd || process.cwd(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    proc.on('error', (err) => {
      console.error(`[hook ${event}:${hook.label}] error:`, err.message)
    })
    proc.on('exit', (code) => {
      if (code && code !== 0) {
        console.warn(`[hook ${event}:${hook.label}] exited ${code}`)
      }
    })
  } catch (err: any) {
    console.error(`[hook ${event}:${hook.label}] spawn failed:`, err?.message)
  }
}

/**
 * Fire every enabled hook bound to `event`. For `preToolUse`, the first
 * hook to throw blocks the call and sets `blocked: true` / `blockReason:
 * <message>`; subsequent hooks still run so their logs are captured (and
 * so an audit-style hook keeps its postcondition even when an earlier
 * hook objected). For all other events, throws are captured as logs and
 * the result is unblocked.
 *
 * Returns a Promise but is internally synchronous — the await on the
 * call site composes cleanly with the rest of the async dispatch.
 */
export async function fireHooks(
  event: HookEvent,
  ctx: HookContext = {}
): Promise<HookFireResult> {
  const logs: HookLogEntry[] = []
  let hooks: Hook[]
  try {
    hooks = listHooksForEvent(event)
  } catch (err) {
    console.error('[hooks] list failed:', err)
    return { blocked: false, logs }
  }
  if (hooks.length === 0) return { blocked: false, logs }

  let blocked = false
  let blockReason: string | undefined

  for (const hook of hooks) {
    if (hook.language === 'shell') {
      runShellHook(hook, event, ctx)
      continue
    }
    // language === 'js' (or the defensive default).
    const r = runJsHook(hook, event, ctx, logs)
    if (r.thrown !== undefined) {
      logs.push({
        hookId: hook.id,
        hookLabel: hook.label,
        kind: 'error',
        message: r.thrown
      })
      if (event === 'preToolUse' && !blocked) {
        blocked = true
        blockReason = r.thrown
      }
    }
  }

  return { blocked, blockReason, logs }
}

/**
 * Synchronous test-run path for the HooksSettings UI. The renderer sends
 * the in-editor (unsaved) code, the target event, and a sample context;
 * we synthesize a transient `Hook` and run only the JS path. Used by the
 * "test" button in the editor — does not consult the persisted hooks
 * table at all.
 */
export function testHook(input: {
  code: string
  event: HookEvent
  context?: HookContext
  timeoutMs?: number
}): { thrown?: string; logs: HookLogEntry[] } {
  const transient: Pick<Hook, 'id' | 'label' | 'command' | 'timeoutMs'> = {
    id: 'test',
    label: 'test',
    command: input.code,
    timeoutMs:
      typeof input.timeoutMs === 'number' && input.timeoutMs > 0
        ? input.timeoutMs
        : DEFAULT_HOOK_TIMEOUT_MS
  }
  const logs: HookLogEntry[] = []
  const r = runJsHook(transient, input.event, input.context ?? {}, logs)
  return { thrown: r.thrown, logs }
}
