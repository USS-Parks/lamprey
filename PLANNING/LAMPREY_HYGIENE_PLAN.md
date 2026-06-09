# LAMPREY_HYGIENE_PLAN.md — Hygiene Phase (HY0–HY7)

> **Status: PENDING APPROVAL.** This is a drafted P-SPR. It is not authorized to run STS
> until the user explicitly approves it. Nothing in this file constitutes self-authorization.

---

## §0 — Governance

### Goal (one sentence)
Make Lamprey work fluidly with DeepSeek V4 Pro/Flash by fixing **context economy** and
**thin-harness defaults** — the two things that differentiate a Claude-Code-level harness
from a feature-complete one — without removing any shipped capability.

### Why this phase (the differentiator finding)
A direct audit of the Claude Code harness vs. Lamprey found Lamprey is **not feature-poor** —
it has a context-compressor, stall watchdog, 45-tool registry, subagent fan-out, hooks, and
permissions. The gap is hygiene and philosophy:
- Lamprey **already built** lazy tool schemas (`electron/services/tool-search.ts`) but its
  header explicitly scopes them to the renderer IPC payload: *"chat.ts continues to call
  `getOpenAITools()` and gets every tool's full schema — so the model surface is unchanged."*
  Every DeepSeek call therefore ships all 45 native + every live MCP schema.
- Tool results land in history **verbatim** (only `shell-tool.ts` caps stdout/stderr at 30 KB).
  No spill-to-disk valve. One big grep/log/read floods the model context.
- Active **skill bodies are injected eagerly** into the system prompt
  (`system-prompt-builder.ts:242`, fed from `chat.ts:415–439`).
- The default dispatch leans on the planner→coder→reviewer pipeline + proof gate even for
  turns that don't need rigor (the Lampshade phase already flagged over-scaffolding).

This phase ports the harness mechanics that actually create fluidity: deferred tool surface,
result spill, lazy skills, and single-agent-by-default.

### Scope (what this phase touches)
- `electron/services/tool-registry.ts` — new model-surface builder (core + stubs + `tool_search`)
- `electron/services/tool-search.ts` — reuse existing scoring/tag logic for model-side resolve
- `electron/ipc/chat.ts` — dispatch wiring (tool prep ~`:467–472`; result append ~`:1052–1056`;
  `resolveSingleToolCall` ~`:1252–1637`); skill-content prep (~`:415–439`, `:525`)
- `electron/services/system-prompt-builder.ts` — skill name/desc head vs. lazy body (~`:189`, `:242`)
- `electron/services/agent-router.ts` / `agent-pipeline.ts` — opt-in rigor under `auto`
- new `electron/services/tool-result-spill.ts` — spill valve + read-back
- `AppSettings` (settings schema) — feature flags + a fallback toggle
- `DEVLOG.md`, `README.md`, `CLAUDE.md` Current State, `package.json` version bump (HY7 only)

### Non-goals (explicitly out of scope)
- **No removal** of the multi-agent pipeline, mechanical-proof harness, change contracts,
  fallback parser, RAG, Snip, Deep Research, Customize, Panels, or Reasoning-Trace surfaces.
  This phase changes **defaults and context flow**, not capabilities.
- **No change to the proof-receipt format or the `**Verification:**` footer** (M-phase / WC-6
  contract) — only *when* the gate engages.
- **Do not touch** the `sanitizePseudoTags` persist-side net (HX3/HX4) — it stays as a silent
  safety net; this phase does not re-add any pseudo-tag prompt text (L6 stays).
- No UI/panel redesign; no `bucket.ps1` / release-pipeline changes.

### Key design constraint (read before HY1)
OpenAI-compatible tool calling needs the **full JSON Schema** to emit valid arguments — you
cannot send a half-schema and expect a correct call. So "lazy tool surface" is **not** sending
stub schemas to the model. It is a **search → resolve → unlock** round-trip that mirrors the
Claude Code `ToolSearch` mechanic:
1. The model surface = a small **always-on core** (full schemas) + one meta-tool **`tool_search`**.
2. When the model calls `tool_search({query})`, the harness returns matching tool
   name/description/tags **and unlocks them** (adds their full schemas to the `tools` array for
   subsequent rounds of this conversation).
3. Subsequent model rounds can now call the unlocked tools natively.

**Fallback for weaker models:** a setting `toolSurface: 'lazy' | 'full'` (default `'lazy'`,
auto-downgrade to `'full'` if a model emits N malformed `tool_search` calls in a session — reuse
the FC-10 capability-mismatch pattern). Flash that can't drive the round-trip falls back to the
current full-catalog behavior with zero regression.

### Verify gate (every prompt must pass before commit)
1. `npx tsc --noEmit -p tsconfig.node.json` — clean
2. `npx tsc --noEmit -p tsconfig.web.json` — clean
3. `npx vitest run <the test files this prompt touches>` — clean
4. Any prompt touching `electron/ipc/chat.ts` also runs `npm run verify:proof -- --no-tests` — exits 0
5. Final phase gate (HY7): full `npx vitest run` + `npm run build` + `npm run verify:proof`

### Commit discipline
- One commit per prompt, present-tense imperative subject (`feat(tools): HY2 …`)
- DEVLOG entry per prompt under a new `## <date> — Hygiene Phase` section
- No squashing; no co-author trailer
- No push until HY7 unless the user explicitly says push earlier

### Branch / worktree
- Branch: `claude/github-pushes-audit-3wn41r` (current session branch). Cut a dedicated
  worktree if this runs parallel to another track.

### Completion criteria
- HY0–HY7 all `[x]`, final gate green, DEVLOG phase-complete entry, CLAUDE.md Current State +
  reference-only list updated, version bumped to **v0.11.0**.
- Measured: per-turn tool-schema bytes sent to the model **down ≥60%** on a default roster vs.
  the HY0 baseline, with **no capability lost** (every tool still reachable via `tool_search`).

### Approval state
- **PENDING** — awaiting explicit user green light + STS instruction.

---

## §1 — Prompt Roster

### **HY0 — Baseline measurement → `PLANNING/HY_BASELINE.md`**
- [ ] Measure and record, for the default model + roster: (a) total bytes of tool schemas sent
      to the model per turn via the current `getNormalizedToolsForRole(...)` path, broken down
      native vs. MCP; (b) eager skill-body bytes in a turn with 1 active skill; (c) a sample of
      real tool-result sizes (grep, file read, git log) that currently land verbatim in history.
      No behavior change — measurement + doc only.
- Verify: tsc×2 (doc + any throwaway measurement harness deleted before commit)

### **HY1 — Lazy tool-surface mechanism (registry + `tool_search` meta-tool), data layer only**
- [ ] Add `toolRegistry.getModelToolSurface(provider, { unlockedNames })` returning the always-on
      **core set** (full schemas) + the `tool_search` meta-tool. Add `resolveToolsByQuery(query)`
      reusing `tool-search.ts` scoring. Define the core set explicitly (e.g. `shell_command`,
      `apply_patch`, `workspace_context`, `view_image`, `web_search`, `ask_user_question`, plus
      plan/goal essentials). **Not wired into chat.ts.** Unit tests for surface composition +
      resolve scoring + "every catalog tool is reachable via search."
- Verify: tsc×2 + `vitest run electron/services/tool-registry.test.ts electron/services/tool-search.test.ts`

### **HY2 — Wire the lazy surface into chat dispatch (flagged, default lazy)**
- [ ] Replace the full-catalog tool prep in `chat.ts` (~`:467`) with `getModelToolSurface(...)`
      gated by `settings.toolSurface` (default `'lazy'`). Maintain a per-conversation unlocked-set;
      a `tool_search` call returns matches **and** unlocks them for subsequent rounds. Implement
      the FC-10-style auto-downgrade to `'full'` on repeated malformed `tool_search` calls.
- Verify: tsc×2 + targeted vitest + `npm run verify:proof -- --no-tests`

### **HY3 — Generic tool-result spill valve → `electron/services/tool-result-spill.ts`**
- [ ] In the result-append path (`chat.ts` ~`:1052`), when a tool result exceeds a threshold
      (default 8 KB, configurable), write the full result to `userData/tool-results/<id>.txt`,
      feed the model `head + tail + "N more bytes at <ref>"`, and expose a `read_tool_result(ref,
      range?)` native tool for paged read-back. Shell's existing 30 KB cap stays as a first-line
      clamp. Pure spill module + tests; idempotent; honest truncation markers.
- Verify: tsc×2 + `vitest run electron/services/tool-result-spill.test.ts` + `verify:proof --no-tests`

### **HY4 — Lazy skill-body injection**
- [ ] System prompt gets each active skill's **name + description** only; the full `SKILL.md`
      body loads on first invocation (a `skill_open(name)` tool, or auto on first @/# mention of
      the skill). Update `buildSystemPrompt` (~`:189`) + the `chat.ts` skill-content prep
      (~`:415`). Snapshot test locks the slimmer head; behavior test confirms body arrives on invoke.
- Verify: tsc×2 + `vitest run electron/services/system-prompt-builder.test.ts`

### **HY5 — Rigor becomes opt-in under `auto`**
- [ ] Tune `agent-router.ts` / `resolveAgentDispatch` so the planner→coder→reviewer pipeline and
      the proof gate engage only on explicit rigor signals (phase phrases, "audit/verify/prove",
      multi-deliverable) — default `auto` turns run single-agent. The pipeline + proof gate remain
      fully available via `--multi` / explicit request. Update the auto-router tests to lock the
      new boundary; no change to proof-receipt format.
- Verify: tsc×2 + `vitest run electron/services/agent-router.test.ts` + `verify:proof --no-tests`

### **HY6 — Exemplar-based steering**
- [ ] Replace residual prose-rule bullets in the coding/single-agent prompt with **1–2 compact
      few-shot exemplars** of an ideal tool-using turn (read → smallest correct edit → name what
      changed → verify). Keep the load-bearing proof-receipt citation rule verbatim. Snapshot the
      new envelope; add an envelope-byte guard test.
- Verify: tsc×2 + `vitest run electron/services/system-prompt-builder.test.ts`

### **HY7 — Phase wrap**
- [ ] Full gate green (vitest + build + verify:proof). Re-run the HY0 measurement and record the
      delta in `PLANNING/HY_AFTER.md` (target ≥60% tool-schema-byte reduction, zero capability
      lost). DEVLOG phase-complete entry; CLAUDE.md Current State + reference-only list updated;
      `package.json` bumped to **v0.11.0**; README touch.
- Verify: final phase gate (§0 item 5)
