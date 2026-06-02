#!/usr/bin/env node
// Lamprey Harness — Bundled Node REPL MCP server.
//
// Exposes three tools to the model over standard MCP stdio:
//   * js                       — evaluate JS code in a persistent VM context,
//                                with top-level await and a captured console.
//   * js_reset                 — discard the VM context and start fresh.
//   * js_add_node_module_dir   — extend the resolution paths used by the in-VM
//                                require() for subsequent js calls.
//
// The server uses Node's built-in `vm` module for state isolation and
// `module.createRequire` for require() inside the sandbox. The context is
// seeded once at startup (and again after js_reset) with: console (wired to
// an in-process buffer), setTimeout/clearTimeout/setInterval/clearInterval,
// Buffer, URL, a redacted process (env stripped), and a require that walks
// the user-extended module search paths before falling back to the script's
// own require.
//
// Top-level await is supported by wrapping the user code in
//   (async () => { ${code} })()
// and awaiting the returned promise. Bare expressions return their value
// (the wrapper appends `; return undefined` only if no explicit return is
// present and the parse succeeds as a statement list).

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { createRequire } from 'module'
import { statSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve as pathResolve } from 'path'
import { inspect } from 'util'
import vm from 'vm'

const SERVER_NAME = 'node-repl'
const SERVER_VERSION = '1.0.0'

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 300_000
const STDOUT_CAP = 30_000
const RESULT_CAP = 30_000

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Module-search paths the user has added via js_add_node_module_dir. These
// are prepended to the script's own resolution paths each time we need a
// fresh `require`.
let extraModuleDirs = []

// Resolves a module id by first walking `extraModuleDirs` (with each as the
// referrer for createRequire) and then falling back to the server's own
// require. This gives the user a way to load arbitrary local packages
// without polluting NODE_PATH globally.
function buildSandboxRequire() {
  const ownRequire = createRequire(import.meta.url)
  return function sandboxRequire(id) {
    for (const dir of extraModuleDirs) {
      try {
        // createRequire takes a path of any *file* in the directory whose
        // resolution paths we want to use; pathResolve(dir, 'noop.js')
        // gives a valid filename inside the directory even if the file
        // doesn't exist (Node only uses it to compute the parent directory).
        const dirRequire = createRequire(pathResolve(dir, 'noop.js'))
        return dirRequire(id)
      } catch (err) {
        // Only treat MODULE_NOT_FOUND as "try next dir"; anything else is a
        // real error (syntax error in the loaded module, etc.) and should
        // surface to the caller.
        if (err && err.code !== 'MODULE_NOT_FOUND') throw err
      }
    }
    return ownRequire(id)
  }
}

// Console output captured during a single js call. The console object lives
// in the VM context (it survives across calls), but we swap the underlying
// buffer at the start of each call so each call's stdout is independent.
let currentStdoutBuffer = ''
let currentStdoutTruncated = false

function appendStdout(chunk) {
  if (currentStdoutBuffer.length >= STDOUT_CAP) {
    currentStdoutTruncated = true
    return
  }
  const remaining = STDOUT_CAP - currentStdoutBuffer.length
  if (chunk.length > remaining) {
    currentStdoutBuffer += chunk.slice(0, remaining)
    currentStdoutTruncated = true
  } else {
    currentStdoutBuffer += chunk
  }
}

function formatConsoleArgs(args) {
  return args
    .map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 4, breakLength: 80 })))
    .join(' ')
}

function makeSandboxConsole() {
  const log = (...args) => appendStdout(formatConsoleArgs(args) + '\n')
  return {
    log,
    info: log,
    warn: log,
    error: log,
    debug: log,
    trace: log,
    dir: (obj, opts) => appendStdout(inspect(obj, opts ?? { depth: 4 }) + '\n')
  }
}

// process is exposed in the sandbox but with env stripped — env may contain
// API keys / tokens that the user did not intend the model to see. Other
// process fields (platform, versions, cwd, pid, arch) stay so introspection
// works as expected.
function makeSandboxProcess() {
  return {
    platform: process.platform,
    arch: process.arch,
    version: process.version,
    versions: { ...process.versions },
    pid: process.pid,
    cwd: () => process.cwd(),
    env: {},
    hrtime: process.hrtime.bind(process),
    nextTick: (fn, ...args) => queueMicrotask(() => fn(...args))
  }
}

// Build a fresh VM context with the standard seeded globals. Called at
// startup and again on js_reset.
function buildSandboxContext() {
  const sandbox = {
    console: makeSandboxConsole(),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    clearImmediate,
    queueMicrotask,
    Buffer,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    fetch: globalThis.fetch,
    Headers: globalThis.Headers,
    Request: globalThis.Request,
    Response: globalThis.Response,
    AbortController,
    AbortSignal,
    process: makeSandboxProcess(),
    require: buildSandboxRequire()
  }
  // Self-reference so `globalThis` and `global` inside the sandbox both
  // resolve to the same object.
  sandbox.globalThis = sandbox
  sandbox.global = sandbox
  return vm.createContext(sandbox)
}

let sandboxContext = buildSandboxContext()

// Persistent-binding REPL semantics.
//
// vm.runInContext runs each call as a fresh Script in the SAME global. `var`
// declarations at script top-level become globals (so they survive across
// calls); `let` and `const` are lexical and die when the script finishes.
// Node's own REPL works around this with --experimental-repl-await, which
// AST-rewrites declarations. We do a smaller version of the same trick:
//
//   1. If the code contains a top-level `await`, wrap it in an async IIFE
//      so `await` parses; otherwise run it as a bare script (then bindings
//      stick automatically).
//   2. Inside either branch, transform top-level `let X` / `const X` into
//      `var X` so the binding hoists onto the context's global object. Loss
//      of const-ness is a known REPL quirk — documented in the README.
//   3. For the async-IIFE branch, additionally mirror the discovered
//      identifiers back to `globalThis` at the end of the IIFE so the
//      values populated INSIDE the IIFE escape its function scope.

const TOP_LEVEL_AWAIT_RE = /(?:^|[\s;{(,!?=:&|+\-*/%<>~^])await\s/m

function hasTopLevelAwait(code) {
  // Best-effort: check the unindented top-level. We strip braced blocks first
  // so `function f() { await x }` inside a method body doesn't false-positive.
  // (Parsing properly would require acorn; this is the pragmatic version.)
  let stripped = code
  // Strip {…} blocks iteratively — peel innermost braces, then re-scan.
  let prev = ''
  while (stripped !== prev) {
    prev = stripped
    stripped = stripped.replace(/\{[^{}]*\}/g, ' ')
  }
  return TOP_LEVEL_AWAIT_RE.test(stripped)
}

// Rewrite top-level `let X` / `const X` to `var X`. Only matches when the
// declaration starts at the beginning of a line (post-trim), which is the
// REPL idiom. Inner-block `let`/`const` keep their lexical semantics because
// braced contexts don't match.
function rewriteLexicalDeclsToVar(code) {
  return code.replace(/(^|\n)([ \t]*)(let|const)(\s+)/g, '$1$2var$4')
}

// Collect simple top-level identifier names from `var X = ...` / `var X,Y,Z`.
// Used by the async-IIFE branch to mirror values back to globalThis.
function topLevelVarNames(code) {
  const names = new Set()
  const lines = code.split('\n')
  for (const line of lines) {
    const m = line.match(/^[ \t]*var\s+([^=;]+?)\s*(=|;|$)/)
    if (!m) continue
    for (const part of m[1].split(',')) {
      const name = part.trim().match(/^([a-zA-Z_$][\w$]*)/)
      if (name) names.add(name[1])
    }
  }
  return [...names]
}

function wrapForEvaluation(code) {
  const rewritten = rewriteLexicalDeclsToVar(code)
  const needsAwait = hasTopLevelAwait(rewritten)

  if (!needsAwait) {
    // Bare-script path: top-level `var` lands on the context global; the
    // script's final-expression value is the return value. Wrap in a Promise
    // so the caller's `await Promise.race(...)` semantics are uniform.
    return {
      source: rewritten,
      isAsync: false
    }
  }

  // Async path. Try expression form first so `await fetch(...)` evaluates
  // to its value; on parse failure (declarations, multi-statement), fall back
  // to statement form, and mirror top-level var bindings out to globalThis
  // so they survive the IIFE's function scope.
  const exprForm = `(async () => { return (${rewritten}); })()`
  try {
    new vm.Script(exprForm, { filename: 'repl-async-expr-probe.js' })
    return { source: exprForm, isAsync: true }
  } catch {
    const names = topLevelVarNames(rewritten)
    const mirror = names.map((n) => `globalThis.${n} = ${n};`).join('\n')
    return {
      source: `(async () => { ${rewritten}\n${mirror}\n})()`,
      isAsync: true
    }
  }
}

function stringifyResult(value) {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  try {
    return inspect(value, { depth: 4, breakLength: 80, colors: false })
  } catch (err) {
    return `[unstringifiable: ${err?.message ?? String(err)}]`
  }
}

async function evaluateJs(rawCode, timeoutMs) {
  currentStdoutBuffer = ''
  currentStdoutTruncated = false

  const code = typeof rawCode === 'string' ? rawCode : ''
  if (!code.trim()) {
    throw new Error('Empty `code` argument.')
  }

  const { source, isAsync } = wrapForEvaluation(code)
  const script = new vm.Script(source, { filename: 'repl.js' })

  const timeout =
    typeof timeoutMs === 'number' && Number.isFinite(timeoutMs)
      ? Math.max(1, Math.min(Math.floor(timeoutMs), MAX_TIMEOUT_MS))
      : DEFAULT_TIMEOUT_MS

  const syncValue = script.runInContext(sandboxContext, {
    timeout,
    breakOnSigint: true
  })

  let value
  if (isAsync) {
    // IIFE returns a Promise; race against an async-side timeout because
    // vm.Script's timeout only covers synchronous execution.
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(`Evaluation timed out after ${timeout} ms.`)),
        timeout
      ).unref?.()
    })
    value = await Promise.race([syncValue, timeoutPromise])
  } else {
    value = syncValue
  }

  let stdout = currentStdoutBuffer
  if (currentStdoutTruncated) stdout += `\n[stdout truncated at ${STDOUT_CAP} chars]`

  let resultStr = stringifyResult(value)
  if (resultStr.length > RESULT_CAP) {
    resultStr = resultStr.slice(0, RESULT_CAP) + `\n[result truncated at ${RESULT_CAP} chars]`
  }

  const parts = []
  if (stdout) parts.push(stdout.replace(/\n+$/, ''))
  parts.push(`=> ${resultStr}`)
  return parts.join('\n')
}

function resetSandbox() {
  sandboxContext = buildSandboxContext()
  currentStdoutBuffer = ''
  currentStdoutTruncated = false
  return 'Context reset.'
}

function addNodeModuleDir(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    throw new Error('`path` argument is required and must be a non-empty string.')
  }
  const absolute = pathResolve(rawPath)
  let stat
  try {
    stat = statSync(absolute)
  } catch (err) {
    throw new Error(`Path not accessible: ${absolute} (${err?.code ?? err?.message ?? 'error'})`)
  }
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${absolute}`)
  }
  if (!extraModuleDirs.includes(absolute)) {
    extraModuleDirs.unshift(absolute)
  }
  // Rebuild require so existing context picks up the new path. We mutate the
  // existing sandbox rather than rebuild the context — the user's bindings
  // stay intact.
  sandboxContext.require = buildSandboxRequire()
  return `Added module resolution path: ${absolute}\nCurrent extra paths (${extraModuleDirs.length}):\n${extraModuleDirs.map((p) => '  ' + p).join('\n')}`
}

// ---------------------------------------------------------------------------
// MCP wiring
// ---------------------------------------------------------------------------

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } }
)

const TOOLS = [
  {
    name: 'js',
    description:
      'Evaluate JavaScript code in a persistent Node.js VM context. State (variables, requires, listeners) survives across calls until js_reset. Top-level await is supported. A single expression returns its value (e.g. `2 + 2` → 4); a statement block returns undefined. console.log output is captured and prepended to the result. Default timeout 30000 ms, ceiling 300000 ms.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'JavaScript source to evaluate. May be a single expression or a block of statements. Top-level await is supported.'
        },
        timeout_ms: {
          type: 'number',
          description: 'Optional timeout in milliseconds. Default 30000, ceiling 300000.'
        }
      },
      required: ['code']
    }
  },
  {
    name: 'js_reset',
    description:
      'Discard the persistent VM context and start with a fresh sandbox. All variables, requires, timers, and other state from prior js calls are cleared. Extra module-resolution paths added via js_add_node_module_dir are preserved.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'js_add_node_module_dir',
    description:
      'Add an absolute or relative directory path that subsequent js calls will consult when resolving require() requests. The directory must exist. Paths are tried in most-recently-added-first order before falling back to the server bundle.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to add. Resolved against the server CWD if relative.'
        }
      },
      required: ['path']
    }
  }
]

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  try {
    if (name === 'js') {
      const text = await evaluateJs(args?.code, args?.timeout_ms)
      return { content: [{ type: 'text', text }] }
    }
    if (name === 'js_reset') {
      return { content: [{ type: 'text', text: resetSandbox() }] }
    }
    if (name === 'js_add_node_module_dir') {
      return { content: [{ type: 'text', text: addNodeModuleDir(args?.path) }] }
    }
    return {
      isError: true,
      content: [{ type: 'text', text: `Unknown tool: ${name}` }]
    }
  } catch (err) {
    const message = err && err.message ? err.message : String(err)
    return {
      isError: true,
      content: [{ type: 'text', text: `Error: ${message}` }]
    }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)

// Suppress noisy stderr from unhandled rejections so the MCP client doesn't
// surface them as transport errors; the failing tool call already returns an
// isError response.
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason)
  process.stderr.write(`[node-repl] unhandled rejection: ${msg}\n`)
})
