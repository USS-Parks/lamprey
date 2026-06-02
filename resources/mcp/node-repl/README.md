# Lamprey Node REPL MCP Server

A bundled Model Context Protocol server that gives the model a persistent
Node.js REPL. Registered automatically as a default stdio MCP server by
the Lamprey Harness; no manual configuration required.

## Tools

| Name | Purpose |
|---|---|
| `js` | Evaluate JavaScript with a persistent VM context. Top-level await supported. Default timeout 30 s, ceiling 300 s. |
| `js_reset` | Discard the VM context and start fresh. Preserves extra module paths added via `js_add_node_module_dir`. |
| `js_add_node_module_dir` | Add a directory to the `require()` resolution search list. |

## Sandbox

Each evaluation runs inside a `vm.createContext` sandbox seeded with:

- `console` (wired to a per-call stdout buffer, output appears above `=> result`)
- `setTimeout` / `clearTimeout` / `setInterval` / `clearInterval` / `setImmediate` / `queueMicrotask`
- `Buffer`, `URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`
- `fetch`, `Headers`, `Request`, `Response`, `AbortController`, `AbortSignal`
- `process` — **with `env` redacted** (other fields like `platform`, `cwd`, `pid`, `versions` are kept)
- `require` — walks user-added paths first, then falls back to the server bundle's own `require`

Variables, requires, timers, and other state persist across `js` calls
within a single session until `js_reset` is called.

## Output format

`js` returns a single text block of:

```
<captured stdout>
=> <stringified result>
```

`undefined`, `null`, primitives, and objects are stringified via
`util.inspect` with `depth: 4`. stdout is capped at 30 KB and the result at
30 KB; truncation is marked explicitly.

## Top-level await

User code is wrapped in `(async () => { return (CODE); })()` and awaited.
That means:

- `await fetch('https://example.com')` works as a single expression.
- A statement block (`const x = 5; x * 2`) returns the last expression's
  value only if the wrapper falls back to the block form **and** the user
  writes an explicit `return`. To get a value from multi-statement code,
  use `return` explicitly:
  ```js
  const x = 5; return x * 2;
  ```

## Running standalone

The server is normally launched by Lamprey via Electron's
`ELECTRON_RUN_AS_NODE` mode. For local testing you can run it with plain
Node (v18 or newer):

```bash
node resources/mcp/node-repl/server.js
```

It will speak MCP over stdio.

## Files

- `server.js` — the MCP server entry point.
- `package.json` — module metadata (`type: "module"`); no third-party deps
  beyond `@modelcontextprotocol/sdk`, which is resolved from the parent
  `node_modules` tree at runtime.
