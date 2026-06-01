# Codex Toolset Parity Plan for Lamprey Harness

This document is a Claude Code implementation roster for giving Lamprey a Codex-like tool surface. The goal is functional parity with the toolsets available in the observed Codex desktop session, implemented in Lamprey's existing architecture rather than copied as private Codex internals.

Lamprey already has several of the right primitives:

- Electron main-process services and typed IPC exposed through `electron/preload.ts`.
- Chat tool-call execution in `electron/ipc/chat.ts`.
- MCP server support in `electron/services/mcp-manager.ts`.
- Hot-reloadable prompt skills in `electron/services/skill-loader.ts`.
- Browser, terminal, files, review, artifacts, automations, memory, projects, and worktrees.
- React/Zustand settings and tool panels in `src/`.

The work below turns those primitives into a coherent, installable, user-visible tool platform.

## Parity Target

### Tool Categories to Match

1. Hosted/current-information tools
   - Web search.
   - Open webpage.
   - Click link.
   - Find text in page.
   - PDF screenshot.
   - Image search.
   - Finance lookup.
   - Weather lookup.
   - Sports schedules/standings.
   - Time lookup.

2. Image tools
   - Generate image from prompt.
   - Edit image from provided image plus instruction.
   - Return or attach local image artifacts.

3. Local developer tools
   - Run shell commands.
   - Apply patch.
   - View local image.
   - Read app terminal output.
   - Load bundled workspace dependencies.
   - Request permissions.
   - Update task plan.
   - Track explicit goals.

4. MCP tools
   - List resources.
   - List resource templates.
   - Read resource.
   - Call MCP tools.
   - Stdio and SSE transports.
   - Tool discovery.

5. Node REPL tool
   - Persistent JavaScript runtime.
   - Top-level await.
   - Add `node_modules` search path.
   - Reset runtime.
   - Emit text and image results.

6. Plugin system
   - Discover local installed plugins.
   - Install known plugins.
   - Expose plugin-provided skills, MCP servers, apps, assets, and tools.
   - Browser, Documents, Presentations, and Spreadsheets as first-class bundles.

7. Skills system
   - Local markdown skills with metadata.
   - Codex-style `SKILL.md` directory skills.
   - Existing Lamprey flat `.md` skills.
   - Skill install/create/update workflows.

8. Automations and thread coordination
   - Create, list, update, delete, and run automations.
   - Create, list, inspect, continue, pin, archive, rename, and manage threads.

9. Parallel tool execution
   - Run independent safe tool calls concurrently from one model intent.

10. Safety and governance
   - Filesystem sandboxing.
   - Network permission gating.
   - Destructive action approval.
   - Tool audit trail.
   - Per-tool capability manifests.

## Architectural Decision

Do not hard-code all parity tools as one giant MCP server. Use three layers:

1. Native Lamprey tools
   - Fast, local, app-integrated tools implemented as main-process services and IPC.
   - Examples: shell, apply patch, file/image viewing, terminal reading, permissions, plans, goals, threads, automations.

2. MCP-backed tools
   - External or bundled tool servers exposed through the existing MCP manager.
   - Examples: Node REPL, browser automation, Google services, optional workspace/document tools.

3. Skills and plugins
   - Skills provide reusable behavioral instructions.
   - Plugins package skills, MCP configs, assets, dependency manifests, and optional app panels.

This keeps Lamprey readable, lets users inspect what tools are installed, and avoids making every feature depend on a remote service.

## Core Data Model Additions

Add these concepts before building individual tools:

### Tool Registry

Create a central registry that merges native tools, MCP tools, and plugin tools into one model-facing list.

Suggested files:

- `electron/services/tool-registry.ts`
- `electron/ipc/tools.ts`
- `src/stores/tools-store.ts`
- `src/components/tools/ToolsPanel.tsx` extensions

Suggested types:

```ts
export type ToolProviderKind = 'native' | 'mcp' | 'plugin'
export type ToolRisk = 'read' | 'write' | 'network' | 'destructive' | 'secret'

export interface LampreyToolDescriptor {
  id: string
  name: string
  title: string
  description: string
  providerKind: ToolProviderKind
  providerId: string
  inputSchema: unknown
  risks: ToolRisk[]
  requiresApproval: boolean
  enabled: boolean
}

export interface LampreyToolCall {
  id: string
  toolId: string
  name: string
  args: Record<string, unknown>
  startedAt: number
  finishedAt?: number
  status: 'pending' | 'approved' | 'denied' | 'running' | 'done' | 'error'
  result?: string
  error?: string
}
```

### Permission Profiles

Create one permission service, even if the first version only stores local decisions.

Suggested files:

- `electron/services/permissions-store.ts`
- `electron/ipc/permissions.ts`
- `src/components/settings/PermissionsSettings.tsx`
- `src/components/mcp/ConfirmationModal.tsx` extension or new `ToolApprovalModal.tsx`

Profiles:

- `read_workspace`
- `write_workspace`
- `read_path`
- `write_path`
- `network`
- `shell`
- `destructive_fs`
- `browser_destructive`
- `secret_access`

Acceptance:

- Model cannot execute shell, network, or destructive tools without an explicit policy path.
- User can see why approval is requested.
- Auto-deny timeout remains for high-risk actions.

### Tool Audit Log

Persist tool calls so users can inspect what happened.

Suggested storage:

- Add `tool_calls` table in `electron/services/database.ts` or a separate store.
- Show recent calls in the existing activity feed or tool cards.

Minimum fields:

- id, conversationId, toolId, name, argsJson, resultPreview, status, startedAt, finishedAt, durationMs, error.

## Implementation Phases

### Phase 0 - Baseline and Guardrails

Purpose: Prevent parity work from breaking existing Lamprey behavior.

Tasks:

- Run `npm run typecheck`.
- Run `npm run lint`.
- Identify existing failing tests or lint errors before changing code.
- Add a `PLANNING/CODEX_TOOLSET_PARITY_PROGRESS.md` log.
- Confirm the current dirty file `src/components/chat/ChatInput.tsx` is unrelated before editing it.

Acceptance:

- Baseline status is recorded.
- No user changes are reverted.

### Phase 1 - Unified Tool Registry

Purpose: Model-facing tools should come from one registry instead of being assembled ad hoc inside chat IPC.

Tasks:

- Create `tool-registry.ts`.
- Register native tool descriptors.
- Import MCP tools from `mcpManager.getAllTools()`.
- Convert descriptors to OpenAI-compatible `ChatCompletionTool[]`.
- Replace the current direct MCP tool assembly in `electron/ipc/chat.ts`.
- Preserve `memory_add` behavior as either an internal native tool or a registry entry.
- Add IPC for `tools:list`, `tools:get`, and `tools:getRecentCalls`.

Acceptance:

- Existing MCP tools still appear to tool-capable models.
- Memory save still works.
- Tool names remain stable.
- Chat messages with tool calls still persist and replay correctly.

### Phase 2 - Native Developer Tool Pack

Purpose: Add Codex-like local developer tools as native Lamprey tools.

Tools:

- `shell_command`
- `apply_patch`
- `view_image`
- `read_thread_terminal`
- `load_workspace_dependencies`
- `request_permissions`
- `update_plan`
- `get_goal`
- `create_goal`
- `update_goal`

Implementation notes:

- Shell execution should reuse or wrap `electron/services/pty-manager.ts` for interactive sessions and `child_process.spawn` for one-shot commands.
- `apply_patch` should implement a strict patch grammar or use a small internal patch parser. Do not pass arbitrary shell commands to mutate files.
- `view_image` should validate the path, mime type, and file size, then emit an image-capable artifact or chat attachment.
- `read_thread_terminal` should read the active terminal buffer if available.
- `load_workspace_dependencies` should expose configured Node, Python, and office/document helper paths.
- Plan and goal state can start in memory and later persist per conversation.

Acceptance:

- Model can list and call each native tool when enabled.
- File writes stay inside the current project or allowed roots unless approved.
- Shell commands show start, output preview, exit code, and duration.
- Patch application rejects malformed patches.
- User can inspect every tool result in chat.

### Phase 3 - Browser Control Tool Pack

Purpose: Bring the in-app Browser plugin up to Codex-level test and navigation usefulness.

Tools:

- `browser_open`
- `browser_click`
- `browser_type`
- `browser_find`
- `browser_screenshot`
- `browser_get_current_tab`
- `browser_evaluate_readonly`

Implementation notes:

- Reuse `electron/services/browser-manager.ts`.
- Add controlled automation hooks around `WebContentsView.webContents`.
- Gate click/type/form submission with approval unless the target is localhost or an approved domain.
- Screenshots should save into a controlled temp/artifacts directory.

Acceptance:

- User can ask Lamprey to open `localhost:3000`, click, type, and inspect.
- Destructive or credential-like interactions require approval.
- Screenshots render in chat/artifact panel.

### Phase 4 - Web and Current Information Tools

Purpose: Provide non-Codex proprietary equivalents for current information.

Recommended implementation:

- Use provider-backed web search through one configurable adapter.
- Support at least one default adapter from:
  - Tavily
  - Brave Search API
  - SerpAPI
  - Bing Web Search, if available to the user
  - SearXNG endpoint, user configured
- Use direct `fetch` plus DOM/PDF helpers for open/find.

Tools:

- `web_search`
- `web_open`
- `web_click`
- `web_find`
- `web_pdf_screenshot`
- `image_search`
- `finance_quote`
- `weather_lookup`
- `sports_lookup`
- `time_lookup`

Suggested files:

- `electron/services/web-tools.ts`
- `electron/services/web-search-adapters.ts`
- `electron/ipc/web-tools.ts`
- `src/components/settings/WebToolsSettings.tsx`

Security:

- Network tools require `network` permission.
- Store API keys through existing keychain helpers.
- Clearly label sources in tool output.

Acceptance:

- Search returns title, snippet, URL, and date when available.
- Open returns sanitized text with URL metadata.
- Find searches the fetched content.
- Finance/weather/sports/time tools work without exposing secret keys to renderer.
- Tool output includes source links where applicable.

### Phase 5 - Image Generation Tool Pack

Purpose: Add image generation and editing through user-configurable providers.

Provider options:

- OpenAI Images API.
- Stability AI.
- Local ComfyUI endpoint.
- Automatic1111 endpoint.

Tools:

- `image_generate`
- `image_edit`
- `image_variation`

Suggested files:

- `electron/services/image-tools.ts`
- `electron/ipc/image-tools.ts`
- `src/components/settings/ImageToolsSettings.tsx`

Acceptance:

- Generated files are written to a Lamprey artifacts directory.
- Chat can render generated images by absolute local path.
- Provider keys stay in keychain.
- Failed generations produce useful errors.

### Phase 6 - Node REPL MCP Server

Purpose: Match the persistent `node_repl` MCP toolset.

Recommended path:

- Bundle a local MCP server package under `resources/mcp/node-repl`.
- Register it as a default stdio MCP server.
- Keep it sandboxed to the workspace by default.

Tools:

- `js`
- `js_reset`
- `js_add_node_module_dir`

Features:

- Persistent runtime per conversation or per app session.
- Top-level await.
- Timeout support.
- Controlled module resolution.
- Text output helper.
- Image output helper.

Acceptance:

- `await` works.
- Bindings persist across tool calls.
- Reset clears bindings.
- Adding a `node_modules` path allows imports from that path.
- Long-running JS times out cleanly.

### Phase 7 - MCP Resources and Tool Discovery

Purpose: Complete MCP parity beyond `callTool`.

Tasks:

- Extend `mcp-manager.ts` with:
  - `listResources`
  - `listResourceTemplates`
  - `readResource`
  - server capability detection
- Add native tools:
  - `list_mcp_resources`
  - `list_mcp_resource_templates`
  - `read_mcp_resource`
  - `tool_search`
- Add a local BM25 or fuzzy index over tool descriptors.

Acceptance:

- Model can discover installed tools by text query.
- Resource reads are routed through MCP clients.
- Tool discovery returns enough metadata for the model to decide next steps.

### Phase 8 - Plugin System

Purpose: Convert bundled capabilities into installable and inspectable plugin bundles.

Plugin manifest proposal:

```json
{
  "id": "browser",
  "name": "Browser",
  "version": "1.0.0",
  "description": "In-app browser tools and browser-control skill.",
  "skills": ["skills/control-in-app-browser/SKILL.md"],
  "mcpServers": [],
  "nativeTools": ["browser_open", "browser_click"],
  "panels": ["browser"],
  "assets": []
}
```

Suggested files:

- `electron/services/plugin-manager.ts`
- `electron/ipc/plugins.ts`
- `src/stores/plugins-store.ts`
- `src/components/settings/PluginsSettings.tsx`
- `resources/plugins/browser/plugin.json`
- `resources/plugins/documents/plugin.json`
- `resources/plugins/presentations/plugin.json`
- `resources/plugins/spreadsheets/plugin.json`

Tools:

- `list_available_plugins_to_install`
- `request_plugin_install`

Acceptance:

- Installed plugins are listed in settings.
- Bundled plugins are enabled by default.
- Plugin skills are indexed by the skill loader.
- Plugin MCP server configs can be registered without hand-editing JSON.

### Phase 9 - Codex-Style Skills

Purpose: Support both Lamprey `.md` skills and Codex-style directory skills.

Tasks:

- Extend `skill-loader.ts` to scan:
  - Existing flat `skills/*.md`.
  - `skills/*/SKILL.md`.
  - `resources/plugins/*/skills/**/SKILL.md`.
- Add skill metadata fields:
  - id, name, description, source, pluginId, filePath, enabled.
- Preserve existing flat skill behavior.
- Add skills:
  - `imagegen`
  - `openai-docs`
  - `plugin-creator`
  - `skill-creator`
  - `skill-installer`
  - `browser:control-in-app-browser`
  - `documents:documents`
  - `presentations:presentations`
  - `spreadsheets:spreadsheets`

Acceptance:

- Old skills still load.
- Directory skills show in the UI.
- Plugin skills identify their source.
- Active skills are injected into the system prompt with stable names.

### Phase 10 - Documents, Presentations, and Spreadsheets Tool Packs

Purpose: Implement plugin-backed artifact creation workflows.

Approach:

- Use bundled workspace dependency discovery.
- Prefer local JS/Python helper scripts for `.docx`, `.pptx`, `.xlsx`, PDF rendering, and visual verification.
- Keep these as plugin tool packs, not core chat features.

Tools:

- Documents:
  - `docx_create`
  - `docx_edit`
  - `docx_render_pages`
  - `docx_export_pdf`
- Presentations:
  - `pptx_create`
  - `pptx_edit`
  - `pptx_render_slides`
  - `pptx_export_pdf`
- Spreadsheets:
  - `xlsx_create`
  - `xlsx_edit`
  - `xlsx_read`
  - `xlsx_recalculate`
  - `xlsx_render_preview`

Acceptance:

- Created files open locally.
- Rendered previews are visible in Lamprey.
- Visual QA artifacts are saved and inspectable.

### Phase 11 - Automations and Thread Tools

Purpose: Expose existing Lamprey automations and conversation management as model-callable tools when the user requests them.

Tools:

- `automation_list`
- `automation_create`
- `automation_update`
- `automation_delete`
- `automation_run_now`
- `thread_list`
- `thread_read`
- `thread_create`
- `thread_send_message`
- `thread_pin`
- `thread_archive`
- `thread_rename`

Implementation notes:

- Reuse `electron/services/automations-store.ts`, `automations-runner.ts`, and `conversation-store.ts`.
- Gate auto-sending messages to other threads with approval.

Acceptance:

- User can ask to create reminders/monitors using natural language.
- Model discovers automation tools before inventing instructions.
- Thread operations are auditable.

### Phase 12 - Parallel Tool Execution

Purpose: Support independent concurrent calls like Codex's `multi_tool_use.parallel`.

Tool:

- `parallel`

Rules:

- Only allow tools marked `parallelSafe`.
- Never parallelize high-risk tools unless individually approved.
- Preserve deterministic result ordering.

Acceptance:

- Multiple read-only file/search/MCP calls can execute concurrently.
- Failures are isolated per child call.
- Results are grouped and readable.

### Phase 13 - UI Polish and User Trust

Purpose: Make the toolset understandable to non-technical users.

Tasks:

- Add a Tools settings page:
  - Installed tools.
  - Provider/source.
  - Risk level.
  - Enabled toggle.
  - Last used.
- Add per-message tool cards:
  - Tool name.
  - Arguments summary.
  - Status.
  - Duration.
  - Result preview.
- Add approval modal for all risk-gated tools.
- Add source pills for web/document outputs.

Acceptance:

- A user can answer "what did the model do?" from the UI.
- Approval prompts are specific and short.
- Tool failures do not look like chat failures.

### Phase 14 - Tests and Release

Testing:

- Typecheck.
- Lint.
- Unit tests for tool registry, permission store, patch parser, plugin manifest parsing, skill loading, and MCP resource mapping.
- Manual smoke tests:
  - Chat calls memory tool.
  - Chat calls browser read tool.
  - Chat attempts browser destructive tool and receives approval modal.
  - Chat runs shell command.
  - Chat applies a small patch.
  - Chat does web search with configured provider.
  - Chat uses Node REPL across two turns.
  - Plugin list shows bundled plugins.
  - Directory `SKILL.md` skill loads.

Release:

- Update README feature list.
- Update SKILLS.md for directory skills.
- Add migration notes.
- Bump package version only in the final release session.

## Claude Code Prompt Session Roster

Use one Claude Code session per roster item. Each prompt assumes the working directory is the Lamprey repository.

### Session 01 - Baseline Audit

Prompt:

```text
You are working in the Lamprey Harness repo. Read PLANNING/CODEX_TOOLSET_PARITY_PLAN.md, README.md, package.json, electron/ipc/chat.ts, electron/services/mcp-manager.ts, electron/services/skill-loader.ts, electron/preload.ts, and src/lib/types.ts.

Do not edit src/components/chat/ChatInput.tsx unless the existing user change is directly relevant. Run typecheck and lint. Create PLANNING/CODEX_TOOLSET_PARITY_PROGRESS.md with the baseline result, existing failures, and the first implementation slice. Do not implement parity features in this session.
```

Acceptance:

- Progress file exists.
- Baseline failures are documented.
- No unrelated files are modified.

### Session 02 - Tool Registry Skeleton

Prompt:

```text
Implement Phase 1 skeleton from PLANNING/CODEX_TOOLSET_PARITY_PLAN.md.

Create a unified tool registry service that can register native tools and import connected MCP tools. Add descriptors, type definitions, and IPC list endpoints. Refactor chat tool assembly so it asks the registry for OpenAI-compatible tool definitions instead of building MCP tool arrays inline.

Preserve existing memory_add and MCP behavior. Add focused tests where practical. Run typecheck.
```

Acceptance:

- Chat still supports `memory_add`.
- Existing MCP tools still become callable.
- `tools:list` is exposed through preload.

### Session 03 - Tool Audit Log

Prompt:

```text
Add persistent audit logging for tool calls.

Use the existing database/store patterns. Record tool id, name, conversation id, arguments JSON, status, result preview, error, timestamps, and duration. Wire chat tool execution to create/update records. Expose recent records through IPC and preload. Add a minimal renderer store for future UI use.

Run typecheck and any relevant tests.
```

Acceptance:

- Every chat tool call creates an audit row.
- Result/error updates are persisted.
- Renderer can list recent calls.

### Session 04 - Permission and Approval Core

Prompt:

```text
Implement a central permission and approval service for Lamprey tools.

Add risk metadata to tool descriptors. Add approval checks before executing risky tools. Generalize the existing MCP Chrome confirmation flow into a reusable ToolApprovalModal while keeping the old UI behavior working. Shell, network, destructive filesystem, secret access, and browser destructive actions must be approval-gated.

Run typecheck.
```

Acceptance:

- Risky tool calls pause for approval.
- Denial returns a tool result, not a crash.
- Existing Chrome destructive MCP approvals still work.

### Session 05 - Native Shell Tool

Prompt:

```text
Implement the native `shell_command` tool.

It should run one-shot commands with cwd, timeout, optional environment variables, and captured stdout/stderr. Respect the permission service. Do not allow shell execution outside the approved workspace policy. Return exit code, stdout, stderr, and duration in a compact string result. Add descriptor metadata and tests for validation.

Run typecheck and a manual smoke command that prints a short string.
```

Acceptance:

- Model can call `shell_command`.
- Commands are audited.
- Timeout and nonzero exit are handled.

### Session 06 - Native Patch Tool

Prompt:

```text
Implement the native `apply_patch` tool.

Accept a strict patch format compatible with this plan's Codex-style patch needs: add file, delete file, and update file hunks. Validate target paths against workspace/write permissions. Apply edits without invoking a shell. Reject malformed patches with clear errors. Add tests for add/update/delete and path escape rejection.

Run typecheck and tests.
```

Acceptance:

- Valid patches apply.
- Invalid grammar is rejected.
- Path traversal is rejected.

### Session 07 - Native Plan, Goal, Image View, Terminal, Dependencies

Prompt:

```text
Implement the remaining native developer tools from Phase 2:

- view_image
- read_thread_terminal
- load_workspace_dependencies
- request_permissions
- update_plan
- get_goal
- create_goal
- update_goal

Use simple durable state only where needed. Goal state can be per conversation. Plan state can be per conversation. `view_image` should return a renderable local artifact reference. `load_workspace_dependencies` should report bundled Node/Python/helper paths available in this app.

Run typecheck.
```

Acceptance:

- Tools appear in `tools:list`.
- Plan and goal tools work across a conversation.
- Image view produces a visible artifact/reference.

### Session 08 - Browser Automation Tools

Prompt:

```text
Implement Phase 3 browser control tools using the existing browser-manager.

Add model-callable tools for opening a URL, getting current tab info, finding text, taking a screenshot, clicking, typing, and readonly evaluation. Gate click/type/form-like actions through the permission service. Save screenshots into a controlled artifact directory and return renderable paths.

Run typecheck and manually test against a local or about:blank page.
```

Acceptance:

- Browser opens and navigates from a tool call.
- Screenshot works.
- Click/type ask for approval where required.

### Session 09 - Web Tools Adapter Framework

Prompt:

```text
Implement Phase 4 web/current-information adapter framework.

Add settings and keychain support for at least one configurable search provider, plus a SearXNG endpoint option if no key is available. Implement web_search, web_open, web_find, image_search, time_lookup, and stubs with clear provider-required errors for finance_quote, weather_lookup, and sports_lookup if provider keys are not configured.

Network access must be permission-gated. Tool results must include source URLs.

Run typecheck.
```

Acceptance:

- Configured search works.
- Missing-provider errors are clear.
- Network tools are not silently available without permission.

### Session 10 - Finance, Weather, Sports

Prompt:

```text
Complete the current-information tools for finance_quote, weather_lookup, and sports_lookup.

Use configurable providers and keep API keys in the keychain. Normalize output into compact, source-linked summaries. Add tests around argument validation and provider missing errors.

Run typecheck.
```

Acceptance:

- Each tool returns useful structured text when configured.
- Each tool fails gracefully when not configured.

### Session 11 - Image Generation Provider

Prompt:

```text
Implement Phase 5 image generation tools with a provider abstraction.

Support at least one provider through user settings and keychain. Add image_generate and image_edit descriptors. Save results under Lamprey artifacts. Return local image paths suitable for rendering in chat. Add clear errors for missing keys, unsupported edit inputs, and provider failures.

Run typecheck.
```

Acceptance:

- Image generation produces a local file.
- Chat/tool card can render the file.
- Keys do not cross into renderer.

### Session 12 - Node REPL MCP Server

Prompt:

```text
Implement Phase 6 by adding a bundled Node REPL MCP server.

Create a local stdio MCP server package under resources/mcp/node-repl. It must expose js, js_reset, and js_add_node_module_dir. It should support top-level await, persistent bindings, timeout_ms, controlled module search paths, exact text output, and image output references if practical. Register it as a default MCP server.

Run typecheck and manually call js twice to prove persistence.
```

Acceptance:

- Node REPL server connects through existing MCP manager.
- `js` can evaluate top-level await.
- State persists until reset.

### Session 13 - MCP Resources and Tool Search

Prompt:

```text
Implement Phase 7 MCP resources and tool discovery.

Extend mcp-manager with resource listing, template listing, and resource reading where supported by the MCP SDK. Add native tools list_mcp_resources, list_mcp_resource_templates, read_mcp_resource, and tool_search. Build a simple local search index over all tool descriptors.

Run typecheck.
```

Acceptance:

- Tool search returns relevant descriptors.
- MCP resources can be read from servers that support them.

### Session 14 - Plugin Manager

Prompt:

```text
Implement Phase 8 plugin manager.

Add plugin manifest parsing, bundled plugin discovery, installed plugin listing, and tool registration hooks. Create bundled manifests for Browser, Documents, Presentations, and Spreadsheets. Add list_available_plugins_to_install and request_plugin_install tools, but keep installation local/bundled-only for this first version unless a safe install path already exists.

Run typecheck.
```

Acceptance:

- Plugins appear in settings or tool list.
- Bundled plugin skills/tools can be attributed to a plugin.
- Install request cannot install arbitrary remote code silently.

### Session 15 - Directory Skills

Prompt:

```text
Implement Phase 9 Codex-style directory skills.

Extend the skill loader to support both existing flat skills/*.md and directory skills using SKILL.md. Include plugin-provided skills. Preserve current UI and IPC behavior. Add the parity skills listed in the plan as bundled skills, with concise instructions and metadata.

Run typecheck and verify existing skills still load.
```

Acceptance:

- Flat skills load.
- `*/SKILL.md` skills load.
- Plugin skills show source attribution.

### Session 16 - Documents Plugin

Prompt:

```text
Implement the Documents plugin tools from Phase 10.

Add local helper scripts or services to create/edit/render .docx files. Prefer existing workspace dependency paths. Add docx_create, docx_edit, docx_render_pages, and docx_export_pdf descriptors. Save generated files and previews as artifacts.

Run typecheck and create a one-page smoke document.
```

Acceptance:

- A .docx file is created.
- At least one rendered preview is produced.

### Session 17 - Presentations Plugin

Prompt:

```text
Implement the Presentations plugin tools from Phase 10.

Add pptx_create, pptx_edit, pptx_render_slides, and pptx_export_pdf. Use local helpers and artifact previews. Keep styling simple but verifiable. Run typecheck and create a two-slide smoke deck.
```

Acceptance:

- A .pptx file is created.
- Slide previews render.

### Session 18 - Spreadsheets Plugin

Prompt:

```text
Implement the Spreadsheets plugin tools from Phase 10.

Add xlsx_create, xlsx_edit, xlsx_read, xlsx_recalculate, and xlsx_render_preview. Use local helpers for workbook IO and preview generation. Run typecheck and create a smoke workbook with formulas.
```

Acceptance:

- A .xlsx file is created/read.
- Formula recalculation or best-effort recalculation behavior is documented.
- Preview renders.

### Session 19 - Automations and Threads Tools

Prompt:

```text
Expose automations and thread coordination as model-callable tools.

Implement automation_list/create/update/delete/run_now and thread_list/read/create/send_message/pin/archive/rename. Reuse existing stores and IPC patterns. Sending messages to another thread must be approval-gated.

Run typecheck and manually create/list/delete a test automation.
```

Acceptance:

- Automation tools work.
- Thread tools work.
- Cross-thread message sends require approval.

### Session 20 - Parallel Tool Execution

Prompt:

```text
Implement Phase 12 parallel tool execution.

Add a `parallel` tool that accepts child tool calls. Only allow descriptors marked parallelSafe. Execute read-only safe children concurrently and return ordered results. Do not allow shell, patch, destructive browser actions, image generation, or network writes in parallel for the first version.

Run typecheck and test with two read-only tools.
```

Acceptance:

- Safe parallel calls execute concurrently.
- Unsafe child calls are rejected with clear errors.

### Session 21 - Tool UI and Settings

Prompt:

```text
Implement Phase 13 UI polish.

Add a tools/settings view that lists native, MCP, and plugin tools with provider, risk, enabled state, and last-used data. Improve chat tool cards to show arguments summary, status, duration, and result preview. Ensure approval prompts use short non-technical wording.

Run typecheck and visually smoke the app.
```

Acceptance:

- Users can inspect installed tools.
- Users can understand recent tool activity.

### Session 22 - End-to-End Verification

Prompt:

```text
Perform Phase 14 end-to-end verification.

Run typecheck, lint, and available tests. Manually smoke: memory tool, shell command, patch tool, browser open/screenshot, web search or missing-provider path, Node REPL persistence, plugin list, directory skill loading, automation list, and tool audit log. Update PLANNING/CODEX_TOOLSET_PARITY_PROGRESS.md with final status, known gaps, and release blockers.

Do not bump version yet.
```

Acceptance:

- Progress file contains a release-readiness checklist.
- Known gaps are explicit.

### Session 23 - Documentation and Release Prep

Prompt:

```text
Update user-facing documentation for the Codex-like tool platform.

Edit README.md, SKILLS.md, and any settings/help docs needed. Explain tools, skills, plugins, permissions, MCP, and provider setup in user-facing language. Add migration notes for flat skills and directory skills. Bump package version only if all previous verification is green.

Run typecheck.
```

Acceptance:

- Documentation matches implemented behavior.
- Version bump happens only if the tool platform is shippable.

## Dependency and Provider Checklist

Potential packages:

- Web parsing: `cheerio`, `turndown`, `readability`.
- PDF rendering: `pdfjs-dist` or Playwright screenshots.
- Search adapters: provider SDKs only if they materially simplify auth.
- Images: provider SDK or direct REST.
- Documents/spreadsheets/presentations: local helper ecosystem selected during implementation.
- Search index: small in-house scoring first; full BM25 package only if needed.

Provider keys to support through keychain:

- Web search provider key.
- Image generation provider key.
- Finance provider key.
- Weather provider key.
- Sports provider key if needed.
- OpenAI key if OpenAI-backed image or document helpers are selected.

## Non-Goals for First Release

- Recreating private Codex-hosted search, finance, weather, sports, or image APIs exactly.
- Installing arbitrary remote plugins without a reviewable manifest and user approval.
- Giving models unrestricted filesystem or network access.
- Running shell commands outside the workspace by default.
- Building a cloud service.

## Definition of Done

Lamprey reaches practical Codex toolset parity when:

- The model can see a unified list of native, MCP, and plugin tools.
- The user can inspect and control which tools are enabled.
- Tool calls are audited.
- High-risk tools are approval-gated.
- Skills can be flat Lamprey files or Codex-style `SKILL.md` directories.
- Browser, shell, patch, MCP, Node REPL, web/current-info, image, automation, thread, document, presentation, and spreadsheet workflows are all available through model-callable tools.
- The README explains how the tool system connects to Lamprey in plain language.
