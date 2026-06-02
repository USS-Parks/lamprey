# Codex + Claude Code Toolset Parity Research

> Generated 2026-06-01 by a 7-agent deep-research workflow as the prep step for [CODEX_TOOLSET_PARITY_PLAN.md](CODEX_TOOLSET_PARITY_PLAN.md).
>
> Methodology: seven parallel web-research agents covered (1) Claude Code built-in tools, (2) Claude Code MCP integration, (3) Claude Code agents/skills/hooks/slash commands, (4) Codex hosted tools, (5) Codex local developer tools, (6) Codex plugins/skills, (7) gaps and OSS/third-party equivalents. A synthesis agent merged the seven reports and resolved overlaps.
>
> Caveats: tool names, frontmatter fields, and grammars are sourced from official docs or directly observed system prompts; model version strings (e.g. specific GPT-5.x Codex tags) reflect the research agents' findings but should be treated as suggestive rather than canonical. Citations are preserved as inline links.

---

## 1. Codex Toolset — Complete Inventory

OpenAI's "Codex" family is exposed through three surfaces: **Codex Web** (chatgpt.com/codex), **Codex CLI** ([github.com/openai/codex](https://github.com/openai/codex)), and **Codex Desktop**. Tool surfaces differ per surface.

### 1.1 Hosted Layer (Codex Web / ChatGPT runtime — server-side only)

These tools live behind OpenAI infra. The model emits a single tool call; sub-functions are runtime-internal and surface as nested operations of `web.run` / `image_gen`. Sub-tool names below come from leaked Codex system prompts ([asgeirtj/system_prompts_leaks](https://github.com/asgeirtj/system_prompts_leaks)).

| Tool | Sub-function | Parameters | Purpose |
|---|---|---|---|
| `web.run` | `search_query` | up to 4 queries; domain + recency filters | Parallel internet search |
| | `image_query` | up to 2 queries | Image search (people/places/events) |
| | `product_query` | `search` / `lookup` | Product discovery + SKU lookup |
| | `open` | `ref_id`, optional line range | Open a result for full read |
| | `click` | element id inside opened ref | Follow link inside fetched page |
| | `find` | regex/keyword | In-page text search |
| | `screenshot` | ref + page number | PDF page screenshot |
| | `finance` | ticker, market | Stocks/crypto/fund/index quotes |
| | `weather` | location | Forecast |
| | `sports` | league (NFL/NBA/WNBA/NHL/MLB/EPL/NCAA/IPL) | Schedules + standings |
| | `time` | UTC offset | Clock |
| | `calculator` | expression, prefix/suffix | Arithmetic |
| `image_gen` | `text2im` / `imagegen` | prompt (rewriting allowed) | Generate / edit images via OpenAI Images API |

Public API exposes a subset: `web_search` (Responses API, action types `search`/`open_page`/`find_in_page`) and `image_generation` ([Platform docs](https://platform.openai.com/docs/guides/tools-web-search), [Image API](https://developers.openai.com/api/docs/guides/tools-image-generation)). There is no Code Interpreter / Python sandbox in Codex — Codex's sandbox is a Linux shell container, not a Jupyter kernel.

### 1.2 Local Developer Layer (Codex CLI / Desktop)

Codex CLI executes shell calls inside OS sandboxes — **Seatbelt** on macOS, **bwrap + seccomp** on Linux, native sandbox or **WSL2** on Windows. Default shell is **PowerShell on Windows**, **bash on macOS/Linux**.

| Tool | Parameters | Purpose |
|---|---|---|
| `shell` | `command` (argv array), `workdir`, `timeout_ms`, `with_escalated_permissions`, `justification` | Run a single shell command; auto-routes git/`rg`/`read_file`/`list_dir`/`glob_file_search` |
| `apply_patch` | single text blob in `*** Begin Patch` / `*** End Patch` grammar with `*** Add File:` / `*** Update File:` / `*** Delete File:` / `*** Move to:` directives, `@@` headers, `+`/`-`/space prefixed hunks | Apply structured diffs without shell invocation ([Apply Patch grammar](https://github.com/openai/codex/blob/main/codex-rs/core/prompt_with_apply_patch_instructions.md)) |
| `view_image` | `path` (absolute) | Attach a local image into the next model turn |
| `update_plan` (alias `todo_write`) | `explanation`, `plan: [{step, status: pending\|in_progress\|completed}]` | Maintain the ordered checklist UI; exactly one step `in_progress` |
| `get_goal` / `create_goal` / `update_goal` | `title`, `description`, `status?` | Per-thread mission statement (coarse, stable — distinct from plan) |
| `request_permissions` | requested capability + justification | Escalate beyond current sandbox/approval mode |
| `codex_app.read_thread_terminal` | `thread_id?`, `limit?` | Read in-thread embedded terminal buffer (Desktop-only) |
| `codex_app.load_workspace_dependencies` | (none) | Scan workspace for `package.json`/`pyproject.toml`/`Cargo.toml`/`go.mod`, return normalized dep map |
| `list_mcp_resources` | `server?` | List MCP resources |
| `list_mcp_resource_templates` | `server?` | List parameterized resource URI templates |
| `read_mcp_resource` | `uri` | Fetch resource body |
| `tool_search` | `query`, `max_results?` (supports `select:<name>[,<name>...]`) | Deferred-tool discovery; pulls schemas on demand |
| `multi_tool_use.parallel` | `tool_uses: [{recipient_name, parameters}, ...]` | Batch independent calls; harness fans out concurrently |

**Sandbox modes (`--sandbox`):** `read-only`, `workspace-write` (default — read anywhere, write inside cwd + `--add-dir`, no network unless escalated), `danger-full-access`. **Approval modes (`--ask-for-approval`):** `untrusted`, `on-request` (default), `never`. Granular policy toggles `sandbox_approval`, `rules`, `mcp_elicitations`, `request_permissions`, `skill_approval` independently ([Codex sandboxing](https://developers.openai.com/codex/concepts/sandboxing), [Agent approvals & security](https://developers.openai.com/codex/agent-approvals-security)).

### 1.3 MCP Servers — `node_repl`

Built-in stdio MCP server backing Codex Desktop's JS scratchpad. Tools surface as `mcp__node_repl__<name>`:

| Tool | Parameters | Purpose |
|---|---|---|
| `js` | `code: string` | Eval JS in persistent Node context; returns stdout + final expression |
| `js_reset` | (none) | Tear down V8 isolate, fresh REPL |
| `js_add_node_module_dir` | `path: string` | Push directory onto module resolution path |

### 1.4 Plugin Layer

Manifest is **`.codex-plugin/plugin.json`**. Resolution walks cwd → parents → repo root → `~/.agents/skills` → `/etc/codex/skills` → built-in. Marketplaces: OpenAI-curated, `.agents/plugins/marketplace.json` (repo), `~/.agents/plugins/marketplace.json` (personal), legacy `.claude-plugin/marketplace.json`. Local install cache: `~/.codex/plugins/cache/$MARKETPLACE_NAME/$PLUGIN_NAME/local/`. CLI: `/plugins`.

Confirmed first-party app plugins: **Browser** (computer-use, in-app browser, drives `browser:control-in-app-browser`), **Documents**, **Presentations**, **Spreadsheets**, plus Slack, Figma, Notion, Gmail, Google Drive, Cloudflare, Netlify, Remotion, Google Slides, Expo, Codex Security ([Codex plugins docs](https://developers.openai.com/codex/plugins), [Build plugins](https://developers.openai.com/codex/plugins/build)).

Plugin-install meta-tools: `list_available_plugins_to_install`, `request_plugin_install` (surfaced via `skill-installer` + `/plugins`).

### 1.5 Skills Layer

`SKILL.md` with YAML frontmatter. **Only two fields are permitted** per the [`skill-creator` spec](https://github.com/openai/skills/blob/main/skills/.system/skill-creator/SKILL.md):

```yaml
---
name: skill-name
description: What it does AND when to trigger it.
---
```

Directory layout: `skills/<name>/SKILL.md` + optional `scripts/`, `references/`, `assets/`. Plugin skills auto-namespace as `<plugin>:<skill>`. MCP tools namespace as `mcp__<server>__<tool>`. Progressive disclosure (target SKILL.md < 500 lines) is enforced doctrine.

Auto-installed meta-skills under [`openai/skills/.system/`](https://github.com/openai/skills/tree/main/skills/.system): **`skill-creator`**, **`plugin-creator`**, **`skill-installer`**, **`imagegen`**, **`openai-docs`**. The Skills Catalog is open-source (per-skill `LICENSE.txt`); the example plugin repo is [`openai/plugins`](https://github.com/openai/plugins). Built-in app connectors (Browser, Documents, Presentations, Spreadsheets) ship in the Desktop binary — not in public repos.

---

## 2. Claude Code Toolset — Complete Inventory

Defined in [code.claude.com/docs/en/tools-reference](https://code.claude.com/docs/en/tools-reference). Tool names are the exact strings for permission rules, frontmatter `tools:` arrays, `--allowedTools`/`--disallowedTools`, and hook matchers. Each tool is registered as a JSON-Schema entry in the Messages API `tools` array; tool calls arrive as `tool_use` content blocks, results return as `tool_result` blocks ([Tool use overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)).

### 2.1 Core File / Search

| Tool | Parameters | Behavior |
|---|---|---|
| `Read` | `file_path`, `offset?`, `limit?`, `pages?` (PDF only, max 20/call) | `cat -n` output; images render visually; whole-file overflow returns partial page + notice |
| `Write` | `file_path`, `content` | Full overwrite. Requires prior `Read` of the file when overwriting existing files |
| `Edit` | `file_path`, `old_string`, `new_string`, `replace_all?` | Exact string replacement (no regex). Read-before-edit + uniqueness checks |
| `NotebookEdit` | `notebook_path`, `cell_id?`, `new_source`, `cell_type?`, `edit_mode?` (`replace`/`insert`/`delete`) | Per-cell edits; no cross-notebook string replace |
| `Glob` | `pattern`, `path?` | Up to 100 files, mtime-sorted. Does not respect `.gitignore` by default |
| `Grep` | `pattern` (ripgrep regex), `path?`, `glob?`, `type?`, `output_mode?`, `multiline?`, `-i`/`-n`/`-A`/`-B`/`-C`, `head_limit`, `offset` | Built on ripgrep; respects `.gitignore` (unlike Glob) |

### 2.2 Execution

| Tool | Parameters | Behavior |
|---|---|---|
| `Bash` | `command`, `description?`, `timeout?` (ms, default 2 min, ceiling 10 min via `BASH_MAX_TIMEOUT_MS`), `run_in_background?` | `cd` persists across calls; env vars do not. 30k char output cap (up to 150k via `BASH_MAX_OUTPUT_LENGTH`); overflow spills to file |
| `PowerShell` | same as Bash | Auto-enabled on Windows without Git Bash; opt-in via `CLAUDE_CODE_USE_POWERSHELL_TOOL=1`. Runs with `-ExecutionPolicy Bypass` (process scope) |
| `Monitor` | background script | Streams emitted lines as notifications; for tailing logs/CI without blocking |
| `BashOutput` / `KillShell` | (legacy paradigm; superseded by `TaskList`/`TaskStop` and `Read` on task output files) | |

### 2.3 Web

| Tool | Parameters | Behavior |
|---|---|---|
| `WebSearch` | `query`, `allowed_domains?`, `blocked_domains?` (mutually exclusive) | Anthropic-hosted server tool; up to 8 backend searches per call; titles + URLs only. Not on Bedrock |
| `WebFetch` | `url`, `prompt` | HTTP→HTTPS upgrade, HTML→Markdown, runs `prompt` through small/fast model. 15-min cache. Cross-host redirects return new URL instead of following |

### 2.4 Planning / UX

| Tool | Behavior |
|---|---|
| `TaskCreate` / `TaskList` / `TaskGet` / `TaskUpdate` / `TaskStop` | Session task checklist; statuses `pending`/`in_progress`/`completed`; supports background tasks |
| `TodoWrite` | Older single-call todo manager; disabled by default in recent versions |
| `AskUserQuestion` | Multiple-choice clarification; no permission required |
| `EnterPlanMode` / `ExitPlanMode` | Switch to no-edit design phase; ExitPlanMode requires permission |
| `ScheduleWakeup` | Sets next self-paced `/loop` wake (1 min–1 hr) |
| `CronCreate` / `CronList` / `CronDelete` | Schedule recurring/one-shot prompts within session; survives `--resume`/`--continue` |
| `RemoteTrigger` | CRUD + run on claude.ai-hosted Routines (Pro/Max/Team/Enterprise) |
| `PushNotification` | Desktop notification + optional phone push via Remote Control |
| `EnterWorktree` / `ExitWorktree` | Isolated git worktree under `.claude/worktrees/`; subagents pinned `isolation: worktree` cannot call `ExitWorktree` |
| `LSP` | Language-server intelligence — jump-to-def, find-references, type errors, list/find symbols |

### 2.5 Subagents

`Agent` (a.k.a. `Task` in older docs) — params `description`, `prompt`, subagent-type. Spawns subagent with own context window; parent only receives final text. `Workflow` runs a dynamic-workflow script orchestrating multiple background subagents.

**Agent SDK** (`@anthropic-ai/claude-agent-sdk`): `query({ prompt, options })` returns async iterable. `options` includes `allowedTools`, `permissionMode`, `hooks`, `agents`, `mcpServers`, `resume`, `settingSources` ([Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)).

**`.claude/agents/`**: Markdown subagent files. Frontmatter — `name`, `description`, `tools`, `disallowedTools`, `model` (`sonnet`/`opus`/`haiku`/`inherit`), `permissionMode`, `mcpServers`, `hooks`, `maxTurns`, `skills`, `memory`, `effort`, `background`, `isolation: worktree`, `color`, `initialPrompt`. Resolution: managed → `--agents` flag → `.claude/agents/` → `~/.claude/agents/` → plugin `agents/`. Built-in subagents: **Explore** (Haiku, read-only), **Plan**, **general-purpose**, **statusline-setup**, **claude-code-guide** ([Subagents](https://code.claude.com/docs/en/sub-agents)).

### 2.6 MCP Integration

Tool naming pattern: **`mcp__<server>__<tool>`**. MCP prompts surface as slash commands `/mcp__<server>__<promptname>`.

**Configuration scopes:** Local (`~/.claude.json`) → Project (`.mcp.json`, requires per-project approval) → User → Plugin → claude.ai connectors. Generic `${VAR}` / `${VAR:-default}` expansion in `command`, `args`, `env`, `url`, `headers`.

**Transports:** `stdio` (injects `CLAUDE_PROJECT_DIR`), `http` (streamable HTTP — recommended for remote), `sse` (deprecated), `ws` (WebSocket, JSON-only). HTTP/SSE auto-reconnect with exponential backoff (5 attempts); stdio is not auto-reconnected.

**Authentication:** OAuth 2.0/2.1 (automatic on `401`/`403` or `WWW-Authenticate`; tokens in OS keychain or credentials file); static `--header` flags; `headersHelper` for dynamic per-connection headers; `--env` for stdio.

**Tool Search** defers MCP schemas — `ToolSearch` matches by name/keyword and loads schemas inline. Control via `ENABLE_TOOL_SEARCH=true|auto|auto:N|false`. Bypass per server with `"alwaysLoad": true`. Output cap warning at 10k tokens, hard cap via `MAX_MCP_OUTPUT_TOKENS` (default 25k, ceiling 500k).

**Related tools:** `ListMcpResourcesTool`, `ReadMcpResourceTool`, `WaitForMcpServers`.

**`/mcp` slash command** — interactive panel: OAuth completion, clear auth, reconnect failed servers, inspect connectors. CLI equivalents: `claude mcp list` / `get <name>` / `remove <name>` / `add` / `add-json`. **Managed MCP config** (`managed-mcp.json`) deploys fixed server sets enterprise-wide with `allowedMcpServers` / `deniedMcpServers`.

### 2.7 Skills

`SKILL.md` (required) + optional supporting files. Frontmatter: `name`, `description`, `when_to_use`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context: fork`, `agent`, `hooks`, `paths`, `argument-hint`, `arguments`, `shell`.

**Locations:** `~/.claude/skills/<name>/SKILL.md` (personal), `.claude/skills/<name>/SKILL.md` (project — walks up to repo root + nested), `<plugin>/skills/<name>/SKILL.md` (`plugin:skill` namespace), managed/enterprise. Personal overrides project; enterprise overrides both. Custom commands (`.claude/commands/*.md`) merge with skills (skill wins on collision).

**Invocation:** auto (model-decided from `description`) or `/skill-name`. Supports dynamic context: `` !`shell-cmd` `` runs before injection; `$ARGUMENTS`/`$N`/`$name`/`${CLAUDE_SKILL_DIR}` substitutions. Live change detection without restart. The **`Skill`** tool is the execution surface ([Skills](https://code.claude.com/docs/en/skills)).

### 2.8 Hooks

| Hook | Behavior |
|---|---|
| `PreToolUse` | Fires before tool call; exit 2 blocks (stderr→error); JSON `permissionDecision: allow\|deny\|ask\|defer`. Supports `matcher` (regex) and `if` (permission-rule syntax, e.g. `Bash(rm *)`) |
| `PostToolUse` | After success; cannot block. For linting/audit |
| `UserPromptSubmit` | 30s timeout; can block with exit 2 or `decision: "block"`. Can inject `additionalContext`, set `sessionTitle` |
| `SessionStart` | On startup/resume/clear/compaction. Cannot block. Unique outputs: `additionalContext`, `sessionTitle`, `watchPaths`, `reloadSkills`, `initialUserMessage` |
| `Notification` | Observability only |
| `Stop` | End of turn; exit 2 or `decision: "block"` prevents stopping |

### 2.9 Slash Commands

Key built-ins: `/help`, `/clear`, `/compact`, `/agents`, `/skills`, `/hooks`, `/mcp`, `/permissions`, `/memory`, `/init`, `/config`, `/model`, `/effort`, `/plan`, `/review`, `/security-review`, `/resume`, `/rewind`/`/checkpoint`, `/background`, `/tasks`, `/branch`, `/diff`, `/usage`, `/doctor`, `/reload-plugins`, `/reload-skills`. Bundled skill commands: `/code-review`, `/simplify`, `/run`, `/verify`, `/debug`, `/batch`, `/loop`, `/claude-api`, `/deep-research`. Custom: `.claude/commands/*.md`.

### 2.10 Permission Modes

Cycle with `Shift+Tab` or `--permission-mode`:

| Mode | Behavior |
|---|---|
| `default` | Reads only auto-approved; everything else prompts |
| `acceptEdits` | Auto-approves file edits + filesystem Bash (`mkdir`, `mv`, `cp`, `rm`, `touch`, `sed`) inside workspace |
| `plan` | Research only; produces a plan, never edits |
| `auto` | Anthropic API only — classifier blocks escalations/external-exec/prod-deploys/force-push-to-main. Falls back to prompting after 3 consecutive / 20 total blocks |
| `dontAsk` | Auto-denies anything not pre-approved; for CI |
| `bypassPermissions` (`--dangerously-skip-permissions`) | No checks; refuses to run as root |

**Protected paths** (`.git`, `.vscode`, `.idea`, `.husky`, `.cargo`, `.claude` except `commands/agents/skills/worktrees`, shell rc files, `.mcp.json`, `.claude.json`) bypass auto-approval in every mode except `bypassPermissions` ([Permission modes](https://code.claude.com/docs/en/permission-modes)).

### 2.11 CLAUDE.md / Memory

Loaded as a user message after system prompt. Load order: managed policy → `~/.claude/CLAUDE.md` → `./CLAUDE.md` or `./.claude/CLAUDE.md` → `./CLAUDE.local.md`. Walks up the dir tree concatenating; subdirectory CLAUDE.md loads on demand. **`@path/to/file` imports** expand inline (max 4 hops). `.claude/rules/*.md` allows topic-scoped instructions with optional `paths:` glob frontmatter ([Memory](https://code.claude.com/docs/en/memory)).

---

## 3. Side-by-Side Comparison

| Codex Tool | Claude Code Equivalent | Notes / Gap |
|---|---|---|
| `web.run.search_query` | `WebSearch` | Both server-side; Codex public API is `web_search` on Responses API |
| `web.run.image_query` | (none) | Claude Code has no image search; needs custom impl |
| `web.run.product_query` | (none) | Codex-unique commerce surface |
| `web.run.open` | `WebFetch` | Claude's lossy (runs prompt through small model); Codex returns raw + cite |
| `web.run.click` | (none built-in) | Needs MCP browser server (Playwright) |
| `web.run.find` | (via `WebFetch` prompt) | Embedded in prompt arg, not a discrete tool |
| `web.run.screenshot` | (none) | Needs Playwright or `webContents.printToPDF()` |
| `web.run.finance` / `weather` / `sports` / `time` | (none) | All Codex-only; need 3rd-party APIs |
| `web.run.calculator` | `Bash` (one-liner) | Could trivially be a skill |
| `image_gen.imagegen` | (none) | Needs OpenAI/Stability/ComfyUI adapter |
| `shell` | `Bash` / `PowerShell` | Direct parity; Codex argv-form vs Claude single-string |
| `apply_patch` | `Edit` + `Write` + `NotebookEdit` | Claude has no diff grammar — uses exact string replacement instead |
| `view_image` | `Read` (image path) | Direct parity |
| `update_plan` / `todo_write` | `TaskCreate`/`TaskList`/`TaskGet`/`TaskUpdate`/`TaskStop`, `TodoWrite` | Claude richer (deps, statuses, background tasks) |
| `get_goal` / `create_goal` / `update_goal` | (closest is CLAUDE.md memory) | Codex-unique coarse mission state |
| `request_permissions` | `permissionMode` switching + `AskUserQuestion` | Different model — Codex tool-emits escalation; Claude is configured |
| `codex_app.read_thread_terminal` | `BashOutput` / `Read` on task output | Claude reads via task IDs; Codex reads a UI buffer |
| `codex_app.load_workspace_dependencies` | (closest is `Glob`+manifest reads as a skill) | Codex pre-normalizes |
| `list_mcp_resources` / `list_mcp_resource_templates` / `read_mcp_resource` | `ListMcpResourcesTool` / `ReadMcpResourceTool` | Direct parity |
| `tool_search` | `ToolSearch` | Direct parity; both defer MCP schemas |
| `multi_tool_use.parallel` | Parallel `tool_use` blocks in one assistant turn | Claude has no explicit batching tool — harness dispatches concurrently for read-only |
| `mcp__node_repl__js` / `js_reset` / `js_add_node_module_dir` | (none) | Closest: `Bash node -e` + an MCP server; needs new impl |
| Codex Plugins (`plugin.json`) | Claude Code Plugins | Manifest format differs; both bundle skills+MCP+hooks |
| `list_available_plugins_to_install` / `request_plugin_install` | (none — CLI `claude mcp add` is manual) | Claude has no in-conversation plugin install |
| `SKILL.md` (2-field frontmatter) | `SKILL.md` (rich frontmatter) | Codex strict; Claude permits 12+ fields |
| Skill namespacing `<plugin>:<skill>` | `<plugin>:<skill>` | Direct parity |
| (none) | `AskUserQuestion` | Codex uses plain text questions |
| (none) | `Monitor` | Codex uses long-running shell instead |
| (none) | `CronCreate` / `RemoteTrigger` / `PushNotification` / `ScheduleWakeup` | Anthropic-hosted scheduling layer |
| (none) | `Agent` / `Workflow` / Agent SDK | Codex relies on hosted runs |
| (none) | `EnterWorktree` / `ExitWorktree` | Codex Desktop has worktrees in UI but no tool surface |
| Sandbox modes (`read-only`/`workspace-write`/`danger-full-access`) | Permission modes (`default`/`acceptEdits`/`plan`/`auto`/`dontAsk`/`bypassPermissions`) | Different axes — Codex enforces OS sandbox; Claude in-process |

---

## 4. Architectural Connection Patterns

### 4.1 Tool surface layers

| Layer | Codex | Claude Code |
|---|---|---|
| **Hosted / server-side** | `web.run`, `image_gen` — OpenAI infra, model sees one tool round-trip | `WebSearch` (server tool) — never appears as `tool_use`/`tool_result` to harness |
| **Local process** | `shell`, `apply_patch`, `view_image`, `update_plan`, `request_permissions`, `update_goal`, `view_thread_terminal`, `load_workspace_dependencies` — Codex CLI executes inside OS sandbox | `Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`, `NotebookEdit`, `Monitor`, etc. — harness executes; produces `tool_result` content blocks |
| **MCP** | stdio + Streamable HTTP; `mcp__<server>__<tool>` namespace; `node_repl` is built-in | stdio + http + sse + ws; `mcp__<server>__<tool>`; per-scope config + OAuth |
| **Plugin** | `.codex-plugin/plugin.json` bundles skills + MCP + apps + hooks; marketplaces | `plugin.json` (or `.claude-plugin/plugin.json` legacy) bundles agents + skills + MCP + hooks + commands |
| **Skills** | `SKILL.md` (2-field frontmatter only) + scripts/references/assets | `SKILL.md` (12+ frontmatter fields) + bundled files |

### 4.2 Tool result formats

- **Claude (Messages API):** Tool calls = `tool_use` content blocks (`id`, `name`, `input`); results = `tool_result` blocks with matching `tool_use_id`, optional `is_error: true`. Streaming via SSE — `input_json_delta` chunks accumulate the JSON args; harness dispatches once block closes. Server tools execute opaquely.
- **Codex:** OpenAI Chat Completions function-call format. `apply_patch` returns structured diff success; `shell` returns stdout/stderr/exit/duration.

### 4.3 Approval / permission flows

| System | Mechanism |
|---|---|
| **Codex** | Three-axis: sandbox (`read-only`/`workspace-write`/`danger-full-access`), approval (`untrusted`/`on-request`/`never`), granular toggles. Model calls `request_permissions` mid-task to escalate. OS-level enforcement on shell. |
| **Claude** | Permission modes + per-tool allow/deny rules (path globs, `Bash(npm run *)` specifiers). `Shift+Tab` cycles modes; hooks (`PreToolUse`) can block with exit 2 or JSON `permissionDecision`. `acceptEdits` doesn't auto-approve MCP. Protected paths bypass auto-approval everywhere except `bypassPermissions`. |

### 4.4 Parallel tool execution

- **Codex:** Explicit `multi_tool_use.parallel` meta-tool. Harness fans out concurrently.
- **Claude:** Implicit. Model emits multiple `tool_use` blocks in a single assistant turn; harness auto-parallelizes when tools are read-only and independent.

---

## 5. Open-Source / Third-Party Equivalents

### 5.1 Web Search

| Provider | Price | Free Tier | MCP Server | Notes |
|---|---|---|---|---|
| **Brave Search API** | $5–9 per 1k | $5/mo credit | Official MCP | Best $/req for AI workloads |
| **Tavily** | $8 (research) | 1k credits/mo | Official MCP | Tuned for RAG |
| **SerpAPI** | $10 per 1k | 100/mo | Community MCP | Real Google SERPs; pricey at scale |
| **Serper** | $0.30–$1 per 1k | 2.5k once | Community MCP | Cheapest Google SERP |
| **Perplexity Search** | $5 per 1k | None | Official MCP | No token costs |
| **SearXNG (self-host)** | $0 | Unlimited | [`mcp-searxng`](https://github.com/ihor-sokoliuk/mcp-searxng) | Aggregates 70+ engines; no API keys |

**Recommended default for Lamprey:** SearXNG + Brave fallback.

### 5.2 Browser Automation

| Tool | Approach | Best For |
|---|---|---|
| [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | Accessibility tree (no vision) | Default — fast, deterministic, multi-browser |
| [executeautomation/mcp-playwright](https://github.com/executeautomation/mcp-playwright) | Screenshots + DOM | When vision context needed |
| [ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) | CDP — traces, network, console | Performance debugging |
| browser-use MCP | High-level "do X" prompts | Agent-first; needs own LLM key |

Lamprey already has `browser-manager.ts` driving `WebContentsView` — wrap its existing capabilities as native tools first; bundle Playwright MCP only if accessibility-tree-driven automation is needed.

### 5.3 Code Execution Sandboxes

| Sandbox | Language | Isolation | MCP |
|---|---|---|---|
| [pydantic/mcp-run-python](https://github.com/pydantic/mcp-run-python) | Python | Pyodide-in-Deno (WASM) | Yes — auto pkg install |
| [langchain-ai/langchain-sandbox](https://github.com/langchain-ai/langchain-sandbox) | Python | Pyodide+Deno | Library — wrap as MCP |
| `isolated-vm` (npm) | JS | V8 isolate | Roll-your-own — **best for Lamprey node_repl** |
| Deno (`--allow-none`) | TS/JS | Permission-based | Easy to wrap |

### 5.4 Image Generation

| Provider | Cost | Local? | MCP |
|---|---|---|---|
| OpenAI Images API (current `gpt-image-*`) | Token-based | No | [`spartanz51/imagegen-mcp`](https://github.com/spartanz51/imagegen-mcp) |
| Stability SD 3.5 Large | API or self-host | Yes | Several community MCPs |
| ComfyUI (local) | Free | Yes | ComfyUI MCP over WebSocket |
| Automatic1111 | Free | Yes | Community wrappers |

DALL-E 2/3 endpoints have been retired — don't wire them up new.

### 5.5 Document Generation

| Format | Library | Notes |
|---|---|---|
| `.docx` | [`docx`](https://www.npmjs.com/package/docx) | Clean TS API; no LibreOffice needed |
| `.pptx` | [`pptxgenjs`](https://gitbrent.github.io/PptxGenJS/) | Works in Electron renderer |
| `.xlsx` | [`exceljs`](https://github.com/exceljs/exceljs) | Read + write + formatting |
| Multi-format | `officegen` | One lib, all three; less rich |
| Template-driven | [`docxtemplater`](https://docxtemplater.com/) | Word/Excel/PPT from templates |

**Recommended trio:** `docx` + `pptxgenjs` + `exceljs`.

### 5.6 PDF

- `pdfjs-dist` — Mozilla's PDF.js as npm; render to canvas.
- `webContents.printToPDF()` — already in Electron main process, zero deps.
- Playwright `page.pdf()` — for HTML→PDF generation.

### 5.7 Finance / Weather / Sports / Time

| Domain | Provider | Free Tier | MCP |
|---|---|---|---|
| Finance | Alpha Vantage | 5 req/min, 25/day | Official MCP |
| Weather | [Open-Meteo](https://open-meteo.com/) | Unlimited non-commercial, no key | Community MCPs |
| Weather | OpenWeatherMap | 1k calls/day | `robertn702/mcp-openweathermap` |
| Sports | TheSportsDB | Free, key-optional | Community MCPs |
| Sports | ESPN undocumented API | Free, no key | `apify/espn-mcp-server` |
| Time | OS clock / `Intl.DateTimeFormat` | — | Ship as built-in |

**Baseline recommended:** Open-Meteo + ESPN + Alpha Vantage — ~90% of casual queries at zero cost.

### 5.8 Codex-unique → OSS recipe

| Codex Feature | Closest OSS Path |
|---|---|
| `web.run` (sandboxed browse + cite) | Playwright-MCP + SearXNG + a citation post-processor |
| Codex Plugins marketplace | MCP server directory + local registry JSON in Lamprey's skills dir |
| Codex Cloud (remote exec) | Self-hosted `mcp-run-python` container |

**Strategic gap:** Codex's `web.run` binds *search → fetch → cite* into one tool surface. Replicate by composing Playwright-MCP with a SearXNG MCP behind a single Lamprey skill that auto-attaches citations.

---

## 6. Lamprey Parity Recommendations

### 6.1 Tool-to-phase mapping

| Codex Tool | Claude Code Tool | Phase | Lamprey Surface |
|---|---|---|---|
| (baseline) | (baseline) | **Phase 0** | Typecheck/lint baseline |
| (unified tools list) | (tool catalog) | **Phase 1** | `tool-registry.ts` + IPC |
| `shell` | `Bash`, `PowerShell`, `Monitor` | **Phase 2** | `shell_command` via `pty-manager.ts` |
| `apply_patch` | `Edit`+`Write`+`NotebookEdit` | **Phase 2** | `apply_patch` (strict grammar parser) |
| `view_image` | `Read` (images) | **Phase 2** | `view_image` |
| `codex_app.read_thread_terminal` | `BashOutput`/`Read` on task output | **Phase 2** | `read_thread_terminal` |
| `codex_app.load_workspace_dependencies` | (none) | **Phase 2** | `load_workspace_dependencies` |
| `request_permissions` | permission modes + hooks | **Phase 2** + **Phase 0 (policy)** | `request_permissions` + `permissions-store.ts` |
| `update_plan` | `TaskCreate`/`TaskList`/`TaskUpdate` | **Phase 2** | `update_plan` |
| `get_goal`/`create_goal`/`update_goal` | (none) | **Phase 2** | Goal store per conversation |
| `web.run.click`/`open`/`find`/`screenshot` | (none built-in) | **Phase 3** | `browser_*` via `browser-manager.ts` |
| `web.run.search_query` | `WebSearch` | **Phase 4** | `web_search` (Tavily/Brave/SearXNG adapter) |
| `web.run.open` | `WebFetch` | **Phase 4** | `web_open` |
| `web.run.find` | (via prompt) | **Phase 4** | `web_find` |
| `web.run.screenshot` (PDFs) | (none) | **Phase 4** | `web_pdf_screenshot` (`webContents.printToPDF()`) |
| `web.run.image_query` | (none) | **Phase 4** | `image_search` |
| `web.run.finance` | (none) | **Phase 4/10** | `finance_quote` (Alpha Vantage) |
| `web.run.weather` | (none) | **Phase 4/10** | `weather_lookup` (Open-Meteo) |
| `web.run.sports` | (none) | **Phase 4/10** | `sports_lookup` (ESPN/TheSportsDB) |
| `web.run.time` | (none) | **Phase 4** | `time_lookup` (native, no deps) |
| `image_gen.imagegen` | (none) | **Phase 5** | `image_generate`/`image_edit`/`image_variation` (multi-provider adapter) |
| `mcp__node_repl__*` | (none) | **Phase 6** | Bundled stdio MCP server under `resources/mcp/node-repl` (use `isolated-vm`) |
| `list_mcp_resources`/`list_mcp_resource_templates`/`read_mcp_resource` | `ListMcpResourcesTool`/`ReadMcpResourceTool` | **Phase 7** | Extend `mcp-manager.ts` |
| `tool_search` | `ToolSearch` | **Phase 7** | Local BM25/fuzzy index over descriptors |
| Codex plugins (`plugin.json`) | Claude Code plugins | **Phase 8** | `plugin-manager.ts` + manifest in `resources/plugins/*/plugin.json` |
| `list_available_plugins_to_install`/`request_plugin_install` | (none) | **Phase 8** | Two native tools (bundled-only install in v1) |
| `SKILL.md` directory skills | `SKILL.md` | **Phase 9** | Extend `skill-loader.ts` to scan flat + directory + plugin skills |
| Skills `imagegen`/`openai-docs`/`plugin-creator`/`skill-creator`/`skill-installer`/`browser:*`/`documents:*`/`presentations:*`/`spreadsheets:*` | bundled `Skill`-tool skills (`/run`,`/verify`,`/debug`,`/loop`, etc.) | **Phase 9** | Bundle as `resources/plugins/<plugin>/skills/<skill>/SKILL.md` |
| Documents plugin tools | (none) | **Phase 10** | `docx_*` (via `docx` npm) |
| Presentations plugin tools | (none) | **Phase 10** | `pptx_*` (via `pptxgenjs`) |
| Spreadsheets plugin tools | (none) | **Phase 10** | `xlsx_*` (via `exceljs`) |
| (none) | `CronCreate`/`ScheduleWakeup`/`RemoteTrigger`/`PushNotification` | **Phase 11** | `automation_*` + `thread_*` via existing stores |
| `multi_tool_use.parallel` | implicit parallel `tool_use` blocks | **Phase 12** | Native `parallel` tool with `parallelSafe` gating |
| (UI) | (UI) | **Phase 13** | Tools settings + tool cards + approval modal + source pills |
| (tests) | (tests) | **Phase 14** | Typecheck/lint/unit/manual smoke |

### 6.2 Gaps the plan does not yet cover

Fold these into the plan as it evolves:

1. **`Monitor` analog** — background script with line-by-line notifications. Add to Phase 2 as `tool_watch` or `monitor_command`.
2. **`AskUserQuestion` analog** — structured multiple-choice clarification. Add to Phase 13 (UI Polish).
3. **`EnterPlanMode`/`ExitPlanMode` analog** — formal plan mode distinct from `update_plan`. Phase 2 alongside goals.
4. **Worktree tools** — `EnterWorktree`/`ExitWorktree`. Lamprey already has worktrees in UI; add `worktree_create`/`worktree_switch` model-callable surface in Phase 11.
5. **Agent SDK / subagent tools** — Lamprey has a multi-agent pipeline already; explicit `subagent_run`/`subagent_status` in Phase 11.
6. **MCP managed config (`managed-mcp.json`)** — enterprise allow/deny lists. Phase 8 or 14.
7. **CLAUDE.md memory imports (`@path`)** — hierarchical context-injection. Phase 9.
8. **Hooks system** — `PreToolUse`/`PostToolUse`/`UserPromptSubmit`/`SessionStart`/`Stop`/`Notification`. Lamprey already has `sessionStart`/`promptSubmit`/`agentStop`; wire `preToolUse`/`postToolUse` into the MCP path (already in roadmap; align with Codex/Claude hook semantics).
9. **Tool output token caps** — Claude `MAX_MCP_OUTPUT_TOKENS` (25k default, 500k ceiling), 30k Bash output cap with spill-to-file. Mirror in `tool-registry.ts` + `shell_command` execution in Phase 2.
10. **MCP `list_changed` notifications + elicitation** — live tool refresh + structured mid-task forms. Phase 7.

### 6.3 Highest-leverage implementations to do first

In rough order of user-visible impact ÷ implementation effort:

1. **Phase 1 (Tool Registry)** — unblocks every later phase. Without it, every new tool requires editing `chat.ts`. **Do first.**
2. **Phase 2 native `shell_command` + `apply_patch`** — these two unlock the entire "code agent" use case. `apply_patch` is especially high-leverage because it sidesteps fragile Edit-style exact-string matching, and the [grammar is fully documented](https://github.com/openai/codex/blob/main/codex-rs/core/prompt_with_apply_patch_instructions.md).
3. **Phase 4 web tools with SearXNG default** — zero API key barrier; gets the model current-info immediately.
4. **Phase 7 (Tool discovery / MCP resources)** — required to scale beyond ~30 tools without blowing the context window. Implement before Phase 8/9/10 add their tool counts.
5. **Phase 6 (Node REPL via `isolated-vm`)** — single most differentiating Codex tool not present in Claude Code. Bundling it as a stdio MCP server keeps Lamprey's architecture clean.
6. **Phase 9 (Directory skills)** — backwards-compatible with existing flat `.md` skills, opens the door to the entire `openai/skills` ecosystem and Anthropic's bundled skills.
7. **Phase 13 (UI polish)** — without tool cards, users can't trust or debug what tools did. Release blocker once Phases 2–4 are live.
8. **Phase 5 (Image gen)** — high user delight, but lower core-functionality leverage. ComfyUI is more strategically valuable than another OpenAI key.
9. **Phase 10 (Documents/Presentations/Spreadsheets)** — high marketing value but heaviest implementation. Defer until 1–8 are solid.

### 6.4 Critical implementation notes (cross-cutting)

- **Tool naming:** adopt `mcp__<server>__<tool>` for MCP and `<plugin>:<skill>` for skill namespacing — these are the de facto standards both ecosystems converge on.
- **Schema deferral:** with directory skills + plugins, tool count grows fast. Implement `tool_search` (Phase 7) before adding the bulk of plugin tools in Phases 8/10.
- **Permission gating:** Codex enforces at the OS sandbox level; Claude enforces in-process. Lamprey's Electron context makes OS sandboxing impractical — match Claude's in-process model with explicit `risks: ToolRisk[]` per descriptor + a clear approval modal.
- **`apply_patch` parser:** use the Codex grammar verbatim. It's a stable, documented format the model already knows from training.
- **`SKILL.md` frontmatter:** support both Codex's strict 2-field format and Claude's richer 12+ field format. Use only `name`+`description` for bundled Codex-compatible skills; allow extra fields for Lamprey-native skills.
- **Plugin manifest:** Codex uses `.codex-plugin/plugin.json`, Claude uses `plugin.json` or `.claude-plugin/plugin.json`. Lamprey should pick one (the plan suggests `resources/plugins/<id>/plugin.json`) and document a mapping for both Codex and Claude plugin imports.
