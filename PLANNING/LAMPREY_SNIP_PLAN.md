# Lamprey Snip Phase — Sequential Prompt Roster

**Goal:** hard-code an **RTK-style shell-output filter layer** into Lamprey's main process. Every time the model runs `shell_command`, raw stdout/stderr is routed through a declarative YAML pipeline before reaching the model — turning `go test ./...` (689 tokens) into `10 passed, 0 failed` (16 tokens), `git log` (371 → 53), `npm install` (400 → 5), and so on. Token savings are recorded in SQLite and surfaced as a dashboard. Filters are user-extensible: drop a `.yaml` file in `userData/snip/filters/`, hot-reload, done.

**Why:** Lamprey's shell tool already caps stdout at 30 000 chars (`STDOUT_CAP`), but a 30 000-char `npm install` log is still ~7 500 tokens the model can't use. The cap is a *backstop*; the filter layer is the *signal extractor*.

**Prior art:**

- [rtk-ai/rtk](https://github.com/rtk-ai/rtk) (Rust Token Killer) — the original. The user already runs this around Claude Code via a global hook. Filters compiled into the Rust binary.
- [edouard-claude/snip](https://github.com/edouard-claude/snip) — Go reimplementation of rtk's concept with declarative YAML filters that anyone can write. Functionally identical user-facing behaviour (same `gain` dashboard, same `discover` flow, same hook transparency, same `proxy` escape hatch) — the YAML extensibility is the only meaningful under-the-hood difference. Ships 127 filters across all major dev toolchains.

This phase rebuilds the same concept inside Lamprey's Electron main process — same UX as rtk (`gain` analytics, `discover` filter-gap scanner, per-call `bypass_snip` escape hatch, verbose mode) with snip's YAML extensibility under the hood. Targets ~125 built-in filters covering git, JS/TS, Go, Rust, Python, Ruby, .NET, Docker/K8s, cloud/infra, build tools, files/search, linting, package managers, system/network, and misc — the same breadth snip ships, scoped for "millions of machines" rather than this one dev's stack.

**Reference comparison:**

| | **rtk** (Rust, external) | **snip** (Go, external) | **Lamprey Snip Phase** |
|---|---|---|---|
| Where it lives | External CLI, hooked into Claude Code | External CLI, hooked into Claude Code / Cursor / others | **In-process** inside Electron main, between `executeShellCommand` and `formatShellResultForModel` |
| Filter format | Compiled-in Rust | YAML files | YAML files (same shape as snip) |
| User-extensible | Fork repo + write Rust | Drop YAML in `~/.config/snip/filters/` | Drop YAML in `userData/snip/filters/`, chokidar hot-reload |
| `gain` analytics | ✓ | ✓ | ✓ (Settings → Snip dashboard) |
| `discover` filter-gap scan | ✓ | ✓ | ✓ (Discover panel inside dashboard) |
| `proxy <cmd>` raw passthrough | ✓ | ✓ | ✓ (per-call `bypass_snip: true` shell-arg) |
| Verbose mode | ✓ (`-v` flag) | ✓ (`-v` flag) | ✓ (settings toggle: prepends `[snip:filter-name reduced X→Y]` to filtered output) |
| Pre-execution inject rewriting | ✓ | ✓ | **Deferred to v2** — post-processing only in MVP |
| Tracking storage | Per-user SQLite | Per-user SQLite | `snip_events` table in existing `lamprey.db` |
| Dashboard surface | `rtk gain` CLI | `snip gain` CLI | `SnipSettings` tab in Settings dialog + status-line slot |

**Execution model:** **single session, single worktree off `main`, sequential K1 → K14.** No track-splits — every prompt builds on the previous one's substrate (engine → matcher → YAML loader → filter set in four batches → tracking → integration → IPC → UI → discover panel → status line → sign-off).

**Companion to:** [`LAMPREY_FLUIDITY_PLAN.md`](LAMPREY_FLUIDITY_PLAN.md), [`LAMPREY_PARITY_PLAN.md`](LAMPREY_PARITY_PLAN.md), [`LAMPREY_SANDBOX_PARITY_PLAN.md`](LAMPREY_SANDBOX_PARITY_PLAN.md) — all shipped, reference-only.

---

## 0. SESSION BOOTSTRAP — READ THIS FIRST

You are a fresh Claude Code session handed this document. Before doing anything else:

### Step 1 — Confirm environment

Verify:
- Working directory is `C:\Users\17076\Documents\Claude\Lamprey Harness` (or a worktree thereof).
- Current branch is **not** `main` — set up `feat/snip-phase` as a worktree off `main` first if it doesn't exist (per `feedback_parallel_session_worktree` memory).
- `npx tsc --noEmit -p tsconfig.node.json` and `-p tsconfig.web.json` both pass cleanly *before* you start.
- `npx vitest run` exits 0.

If any of those fail, halt and report. Do not start on a broken baseline.

### Step 2 — No track question

This is a single linear phase. **Do not ask the user which track** — there is only one path. Confirm with the user that you're starting the Snip Phase and proceed.

### Step 3 — Execute K1 → K14 without stopping

1. **Do not ask further questions** unless a prompt requires a decision only the user can make (a real architectural fork the plan doesn't resolve, or a genuine blocker).
2. **For each prompt, in order:**
   a. Read the "Files (net new / modified)" list. Read the existing files first to ground the change in the real component shape — these prompts edit shipped code, not greenfield.
   b. Implement the change. Edit existing files in place; create new ones only when the prompt calls for them.
   c. Run the **verify gate** (the "Verify" column). Always: both tsc configs + relevant unit tests. UI-touching prompts (K11, K12, K13) also list manual smoke steps — execute them via the preview tools (`mcp__Claude_Preview__*`) when they touch the renderer. Electron-shell-only smoke steps are written into DEVLOG and explicitly marked **"user-verification-needed"** rather than claimed (see `feedback_no_fake_polish` memory).
   d. If verify fails: fix and retry up to **2 times**. On the third failure, halt, write a "blocked" entry to `DEVLOG.md` with the failure context, report to the user.
   e. If verify passes: mark the prompt `[x]` in this document via `Edit`, write a DEVLOG.md entry (see Step 4), then commit (do not push — user pushes per CLAUDE.md).
   f. Move to the next prompt.
3. **Do not push to GitHub.** One commit per prompt. The user reviews and pushes.
4. **When all 14 prompts complete:** write a final phase-completion summary in DEVLOG.md listing every shipped prompt with its commit SHA, and announce completion in chat.

### Step 4 — DEVLOG entry format

```markdown
## [Snip — Prompt KN] <Title>  —  <YYYY-MM-DD>

**Files changed:** <list>
**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest <subset> ✓ (N tests)
- <manual smoke steps + result, OR "user-verification-needed: <what to check>">

**Notes:** <anything surprising, deferred, or worth knowing>

**Commit:** <SHA>
```

### Step 5 — Commit discipline

- One commit per prompt. No batching, no amending across prompts.
- Never use `--no-verify`. If a pre-commit hook fails, fix the underlying issue.
- Never add the `Co-Authored-By: Claude` trailer (per `feedback_no_coauthor_trailer` memory).
- Use the project's commit-message style — `feat(snip): K4 ship git filter set (YAML)`.

---

## 1. The Token Math — what we're targeting

Numbers below are extrapolated from snip's published measurements applied to commands Lamprey's model actually runs. They set the bar this phase must clear.

| Command (typical Lamprey turn) | Raw shell output | After filter | Reduction |
|---|---:|---:|---:|
| `git status` | ~110 tokens | ~16 tokens | 85% |
| `git log --oneline -10` | ~80 tokens | ~80 tokens | 0% (already compact — pass through) |
| `git log` (default verbose) | ~370 tokens | ~50 tokens | 86% |
| `git diff` (small change) | ~350 tokens | ~70 tokens | 80% |
| `npm install` (no changes) | ~400 tokens | ~5 tokens | 99% |
| `npx tsc --noEmit` (clean) | ~10 tokens | ~5 tokens | 50% (low absolute, but every turn) |
| `npx tsc --noEmit` (errors) | up to 7 500 tokens | full body | 0% (we surface errors verbatim — Invariant 4) |
| `npx vitest run` (all pass) | ~600 tokens | ~10 tokens | 98% |
| `cargo test` | ~591 tokens | ~5 tokens | 99% |
| `go test ./...` | ~689 tokens | ~16 tokens | 98% |
| `gh pr list` | ~150 tokens | ~50 tokens | 67% |
| `ls -R` | up to 7 500 tokens | top-K + count | 90%+ |
| `find . -name …` | up to 7 500 tokens | top-K + count | 90%+ |
| `grep -rn …` | up to 7 500 tokens | top-K + count | 90%+ |
| `terraform plan` | ~2 000 tokens | summary | 90%+ |
| `kubectl get pods` | ~400 tokens | compressed table | 70%+ |

**Non-target floor:** if a filter would *increase* output (rare — but e.g. a stale template firing on already-compact input), the engine MUST fall back to the original and not record an "event." Token efficiency is a hard invariant.

**Failure-path floor:** when a tool exits non-zero, default filter behaviour is **pass-through** (the failure detail IS the signal the model needs). Explicit aggregator filters (vitest "N passed, M failed") opt back in by setting `match.exitCodes` to include non-zero.

**Bypass floor:** the model can force raw output for any single call by passing `bypass_snip: true` in the shell args (K9). This is the in-process analogue of `rtk proxy <cmd>` — no master-toggle flip required for one-off forensics.

---

## 2. Architectural Invariants — Locked

These apply across all 14 prompts. Treat as binding.

1. **Filter pipelines are pure.** No `fs` / `child_process` / `electron` imports inside `engine.ts` / `actions.ts` / `matcher.ts`. Side-effects (DB writes, IPC, YAML reads) live only in `tracking.ts`, `apply.ts`, and `filter-loader.ts`.
2. **Never increase token count.** If a pipeline produces output longer than the input, fall back to the original and log nothing.
3. **Exit code is sacred.** The filter layer mutates stdout/stderr text only. `ShellResult.exitCode`, `signal`, `timedOut`, and the failure flag passed to the chat layer never change.
4. **Failure pass-through is the default.** Filters whose `match.exitCodes` is unset run only when `exitCode === 0`. Failures bypass the pipeline so the model sees real error text.
5. **Tracking is best-effort.** A `tracking.recordEvent` failure (DB locked, disk full) MUST NOT block the filtered output from reaching the model. Catch + log to stderr, return.
6. **No new model-callable tools.** Snip is invisible to the model except for the optional `bypass_snip` arg on the existing `shell_command` tool. No new tool descriptor lands on `tool-registry.ts`.
7. **Disable kill-switch exists from day one.** `AppSettings.snipEnabled` defaults to `true`. Flipping it `false` makes `applySnip` a pure pass-through with no DB write, no matcher run, no allocation.
8. **YAML is the canonical filter format.** Filters ship as `.yaml` files under `resources/snip-filters/`, bootstrapped to `userData/snip/filters/built-in/` on first launch (same pattern as `skill-loader.ts`). User filters live in `userData/snip/filters/` and override built-ins by name. **No TypeScript filter objects ship in MVP** — the loader is the single source of truth.
9. **No pre-execution command rewriting ("inject").** Snip-the-CLI does this for `git log` (forcing `--pretty=format:%h %s`); for the MVP we only post-process. Reserve for v2.
10. **Background-shell parity.** `executeShellCommandInBackground` (used by the monitor service / dev server / terminal panel) does NOT route through snip — users expect raw output there. Snip is foreground-only.
11. **Sandbox + sleep guard run first.** Snip cannot bypass the existing sandbox-tier reporting or the long-sleep guard in `shell-tool.ts`. If the shell call short-circuits (sandbox error, sleep rejected), snip is never invoked.
12. **Per-call `bypass_snip: true` is honoured before the matcher runs.** The model can force raw output without flipping the master toggle. Mirrors rtk's `rtk proxy <cmd>` UX.
13. **Verbose mode is renderer-driven, not in-band.** When `snipVerbose` is on, the *Settings dashboard* shows a "verbose preview" of recent filter activity. The text the model receives is NEVER decorated with `[snip:filter-name reduced N→M]` markers — those would corrupt structured tool output and break diff parsers. Verbose surfaces in the UI only.
14. **All tests run in jsdom or pure-node where possible.** No Electron harness for engine/action/matcher tests — those are pure functions on strings.
15. **YAML schema validation is strict.** A malformed filter file fails to load and is reported in the Snip dashboard's "Filter health" panel; it never partially-loads. Same pattern as `skill-loader.ts`.

---

## 3. The Fourteen Prompts

### Prompt sequence

| # | Prompt | One-liner | Files (net new / modified) | Verify | Status |
|---|---|---|---|---|---|
| K1 | **Snip engine — types + pipeline actions + runner** | Pure module. `types.ts` (Filter, MatchSpec, PipelineAction tagged union, SnipEvent, SnipStats, SnipDiscoverSuggestion). `actions.ts` implements the 11 actions: `strip_ansi`, `keep_lines`, `remove_lines`, `truncate_lines`, `head`, `tail`, `dedup`, `replace`, `aggregate`, `format_template`, `match_output`, `on_empty`. `engine.ts` exports `runPipeline(input: string, pipeline: PipelineAction[]): string` with try/catch around each step (on throw → return original per `Filter.onError = 'passthrough'` default). Token estimator: `estimateTokens(s) = Math.ceil(s.length / 4)`. | `electron/services/snip/types.ts` (new), `electron/services/snip/actions.ts` (new), `electron/services/snip/engine.ts` (new), `electron/services/snip/engine.test.ts` (new) | unit: each action produces expected transform on golden inputs · unit: `runPipeline` with a throwing action returns the pre-throw stage's output, not an exception · unit: `estimateTokens('hello world') === 3` · unit: template substitution handles `{{.lines}}`, `{{.count}}`, `{{.bytes}}`, `{{counter:NAME}}` · both tsc | [ ] |
| K2 | **Matcher — command parsing + filter selection** | `matcher.ts` exports `parseCommand(command: string): { head: string; sub?: string; flags: string[]; isChain: boolean }` and `selectFilter(parsed, filters): Filter | null`. Parser handles shell quoting at the level needed for matching (single + double quotes, simple backslash escapes) — does NOT need full POSIX shell parsing. `isChain` is true when the command contains an unquoted `&&`, `\|\|`, `;`, or `\|` — chains are NOT filtered. `viaNpx: true` filters match both `tsc …` and `npx tsc …`. `excludeFlags` short-circuits the match. | `electron/services/snip/matcher.ts` (new), `electron/services/snip/matcher.test.ts` (new) | unit: `parseCommand('git status -sb')` returns `{head:'git', sub:'status', flags:['-sb'], isChain:false}` · unit: `parseCommand('cd foo && git log')` has `isChain:true` · unit: `parseCommand('npx tsc --noEmit')` with `viaNpx` matches a tsc filter · unit: filter with `excludeFlags:['--oneline']` does NOT match `git log --oneline` · unit: chained commands return `null` from `selectFilter` · both tsc | [ ] |
| K3 | **YAML filter loader + schema + hot-reload** | `filter-loader.ts` loads YAML files from two paths: `resources/snip-filters/` (built-in, bundled with app) and `userData/snip/filters/` (user-extensible). First-launch bootstrap copies built-ins to `userData/snip/filters/built-in/` so the user can see what's running. Uses `gray-matter`-style YAML parsing already present in the codebase (or `js-yaml` — verify during implementation). Schema validation via a small typed validator (NO new dependency — same minimal pattern as `skill-loader.ts`). chokidar watches `userData/snip/filters/` for hot-reload. Loader exports `loadAllFilters(): { filters: Filter[]; errors: FilterLoadError[] }` and `subscribe(callback)` for change events. User filters with the same `name` as a built-in override the built-in. | `electron/services/snip/filter-loader.ts` (new), `electron/services/snip/filter-schema.ts` (new — pure validator), `electron/services/snip/filter-loader.test.ts` (new — uses tmp dirs) | unit: schema validator rejects YAML missing required fields with structured error · unit: user filter with same name as built-in overrides · unit: malformed YAML produces an error entry, does not crash · unit: chokidar watch fires reload callback on file change · unit: bootstrap copies built-ins to userData on first launch only (idempotent) · both tsc | [ ] |
| K4 | **Built-in filter set — git family (YAML)** | Ship 12 YAML filters under `resources/snip-filters/git/`: `git-status.yaml`, `git-log.yaml`, `git-diff.yaml`, `git-show.yaml`, `git-add.yaml`, `git-commit.yaml`, `git-push.yaml`, `git-pull.yaml`, `git-fetch.yaml`, `git-branch.yaml`, `git-stash.yaml`, `git-worktree.yaml`. Each filter tested via golden inputs in `filters.test.ts` (per-prompt growth: golden file per filter). | `resources/snip-filters/git/*.yaml` (12 new), `electron/services/snip/filters.test.ts` (new — golden harness) | unit: each git filter, given a golden raw output, produces a result smaller than the original · unit: `git log --oneline` passes through unchanged (excludeFlags) · unit: `git status` clean tree → "Clean tree" · unit: filter loader counts 12 git filters loaded · both tsc | [ ] |
| K5 | **Built-in filter set — JS/TS + Go + Rust toolchains (YAML)** | ~30 YAML filters: JS/TS family (`jest`, `vitest`, `eslint`, `tsc`, `biome`, `oxlint`, `prettier`, `next`, `playwright`, `nx`, `turbo`, `npm`, `npx`, `yarn`, `pnpm`, `prisma` — 16 filters under `resources/snip-filters/js/`); Go family (`go-test`, `go-build`, `go-vet`, `golangci-lint` — 4 under `resources/snip-filters/go/`); Rust family (`cargo-test`, `cargo-build`, `cargo-check`, `cargo-clippy`, `cargo-install`, `cargo-nextest`, `rustc` — 7 under `resources/snip-filters/rust/`). | `resources/snip-filters/js/*.yaml`, `resources/snip-filters/go/*.yaml`, `resources/snip-filters/rust/*.yaml` (~27 new) | unit: golden-input check per filter · unit: `tsc` passing returns ≤8 chars; failing passes through · unit: `vitest` "Tests  10 passed (10)" → "10 passed" · unit: `cargo test` passing returns ≤10 chars · loader counts ~27 new filters · both tsc | [ ] |
| K6 | **Built-in filter set — Python + Ruby + .NET + Docker/K8s + Cloud/Infra (YAML)** | ~35 YAML filters: Python (`pytest`, `ruff`, `mypy`, `basedpyright`, `ty`, `pip`, `poetry`, `uv` — 8); Ruby (`rspec`, `rubocop`, `rake`, `bundle`, `rails-migrate`, `rails-routes` — 6); .NET (`dotnet-build`, `dotnet-test`, `dotnet-format` — 3); Docker/K8s (`docker-build`, `docker-ps`, `docker-images`, `docker-logs`, `docker-compose`, `kubectl-get`, `kubectl-logs` — 7); Cloud/Infra (`terraform`, `tofu`, `helm`, `ansible-playbook`, `gcloud`, `aws` — 6). | `resources/snip-filters/{python,ruby,dotnet,docker,cloud}/*.yaml` (~30 new) | unit: golden-input check per filter · loader counts ~30 new filters · both tsc | [ ] |
| K7 | **Built-in filter set — build tools + files/search + linting + pkg mgrs + system/network + other (YAML)** | ~50 YAML filters covering the remaining snip categories: build (`make`, `gcc`, `g++`, `gradle`, `gradlew`, `mvn`, `swift`, `xcodebuild`, `just`, `task`, `pio`, `trunk`, `mise` — 13); files/search (`ls`, `find`, `grep`, `rg`, `diff`, `wc`, `tree` — 7); linting (`shellcheck`, `hadolint`, `markdownlint`, `yamllint`, `pre-commit` — 5); pkg mgrs (`brew`, `composer` — 2, others already covered); system/network (`curl`, `wget`, `psql`, `jq`, `ping`, `ssh`, `rsync`, `df`, `du`, `ps`, `systemctl`, `iptables`, `stat`, `fail2ban` — 14); other (`gh-pr`, `gh-issue`, `gh-run`, `jira`, `jj`, `yadm`, `gt`, `ollama`, `sops`, `skopeo` — 10). **Total filter count target after K4-K7: ~125 (matching snip's coverage).** | `resources/snip-filters/{build,files,linting,pkg,system,other}/*.yaml` (~50 new) | unit: golden-input check per filter (sample 25 — exhaustive testing would dominate the phase; the engine + matcher tests cover correctness of the substrate) · loader counts the full ~125 set · `grep -rn …` 7500-token golden → <500 tokens · both tsc | [ ] |
| K8 | **Tracking — DB migration + record/query** | Add `snip_events` table to `initSchema` in `database.ts`. Columns: `id`, `ts`, `command`, `filter_name`, `bytes_before`, `bytes_after`, `tokens_before`, `tokens_after`, `duration_ms`, `conversation_id`. Indexes on `(ts DESC)` and `(filter_name, ts DESC)`. `tracking.ts` exports `recordEvent(evt)`, `getStats(): SnipStats` (totals + top-5-by-tokens-saved + 14-day sparkline), `getRecent(limit): SnipRecentRow[]`, `getUnfilteredCommands(sinceMs, limit): Array<{command:string, count:number, estimatedTokens:number}>` (powers the K12 Discover panel), `clearAll()`. All wrapped in try/catch — failures log to stderr but never throw (Invariant 5). Also add `snip_command_log` table (separate from events) tracking ALL shell commands run through `shell_command` tool with their tokens — necessary for `discover` to find unmatched commands. | `electron/services/database.ts` (extend `initSchema` with two tables), `electron/services/snip/tracking.ts` (new), `electron/services/snip/tracking.test.ts` (new — uses `:memory:` SQLite) | unit: insert 100 synthetic events, `getStats()` reports correct totals + correct top-5 ordering · unit: sparkline returns exactly 14 entries · unit: `recordEvent` with a forced-throw mock still returns (no rethrow) · unit: `getUnfilteredCommands` returns top-K commands by total token cost from `snip_command_log` minus those in `snip_events` · vitest existing database tests still pass · both tsc | [ ] |
| K9 | **Interpose — `apply.ts` + shell wire-up + `snipEnabled` + `bypass_snip` + `snipVerbose`** | `apply.ts` exports `applySnip(command, result, ctx): { result: ShellResult; event: SnipEvent\|null; bypassed: boolean }`. Reads `AppSettings.snipEnabled` (default `true`). **Honours `args.bypass_snip === true` before matcher runs** — the model can force passthrough for one call without flipping the master toggle (rtk-proxy analogue). Pass-through when disabled, bypassed, no match, exit-code triggers failure-pass-through, or filter would grow output. On match, mutates a shallow copy of the result (stdout/stderr replaced), records via tracking. Always records to `snip_command_log` (even on pass-through) so K12's Discover panel can find unmatched commands. Wire into `tool-registry.ts` shell handler. Add `snipEnabled: boolean` and `snipVerbose: boolean` to `AppSettings`. Add `bypass_snip?: boolean` to `ShellArgs` in `shell-tool.ts` (descriptor schema in `tool-registry.ts` updated so the model knows the arg exists, with a short description: "Set to true to skip the snip token-reducing filter for this call and receive raw output. Use for forensic / debugging shell calls."). | `electron/services/snip/apply.ts` (new), `electron/services/snip/index.ts` (new — barrel), `electron/services/tool-registry.ts` (wire `applySnip` + descriptor schema), `electron/services/shell-tool.ts` (extend `ShellArgs`), `src/lib/types.ts` (`AppSettings.snipEnabled` + `.snipVerbose`), `src/stores/settings-store.ts` (defaults), `electron/ipc/settings-sanitizer.ts` (allow new keys), `electron/services/snip/apply.test.ts` (new) | unit: `applySnip` with `snipEnabled:false` returns input untouched, event null · unit: `args.bypass_snip:true` returns input untouched, `bypassed:true`, no DB write to events but yes to command_log · unit: filter that would grow output returns input untouched · unit: failing exit code with default-success filter passes through · unit: successful match transforms stdout, records event, preserves exit code · integration: stubbed `executeShellCommand` returning verbose `git log` reaches the formatter compressed · both tsc | [ ] |
| K10 | **IPC + preload bridge** | `electron/ipc/snip.ts` registers seven handlers: `snip:stats` → `SnipStats`, `snip:recent` → `SnipRecentRow[]`, `snip:setEnabled` → updates settings + in-process cache, `snip:setVerbose` → same, `snip:listFilters` → `Array<{name, description, source: 'built-in'\|'user', path}>`, `snip:reloadFilters` → forces filter-loader reload (returns counts + errors), `snip:discover` → `{ suggestions: SnipDiscoverSuggestion[]; scannedCommands: number; sinceMs: number }`, `snip:clearHistory` → wipes both `snip_events` and `snip_command_log`. Register in `electron/ipc/index.ts`. Preload bridge: `window.api.snip.{stats, recent, setEnabled, setVerbose, listFilters, reloadFilters, discover, clearHistory}`. | `electron/ipc/snip.ts` (new), `electron/ipc/index.ts` (register), `electron/preload.ts` (bridge), `src/lib/preload.d.ts` (typed surface) | unit: `snip:stats` returns empty-shape SnipStats on empty DB · unit: `snip:setEnabled` mutates the cache `applySnip` reads (no stale-read) · unit: `snip:discover` returns suggestions sorted by token cost · preload exposes all 8 methods · both tsc | [ ] |
| K11 | **SnipSettings dashboard tab — `gain` analytics** | New "Snip" tab in `SettingsDialog`. Layout: header card with two toggles (Enabled, Verbose mode) + "Total tokens saved" + "Avg savings %" + "Commands filtered" + 14-day sparkline. Below: "Top filters" table (filter name, runs, tokens saved, savings ratio bar). Below: "Recent activity" list (last 20). Below: "Filter library" disclosure with source badges (`built-in` / `user`) + path to user filter dir + "Reload filters" button (calls `snip:reloadFilters`). Footer: "Reset history" with confirm-click pattern. Match visual language of `RagSettings.tsx`. | `src/components/settings/SnipSettings.tsx` (new), `src/components/settings/SettingsDialog.tsx` (register tab), `src/stores/snip-store.ts` (new — loads stats / recent / filter list on mount) | unit: store `loadStats()` populates from mocked IPC · unit: sparkline component renders 14 bars · jsdom: toggle off calls `snip:setEnabled({enabled:false})` · jsdom: "Reload filters" calls IPC and refreshes filter list · jsdom: "Reset history" confirm-click pattern · manual (preview): toggle works, sparkline renders, top-filters populates, user filter path shown · both tsc | [ ] |
| K12 | **Discover panel — `rtk discover` analogue** | New section inside `SnipSettings` (or a sub-tab): "Find missed savings." Calls `snip:discover` (defaults to last 7 days). Renders a table of unfiltered commands ranked by total estimated tokens spent, with columns: command pattern, runs, total tokens, suggested filter category. Each row has a "Write a filter for this" button that opens the user filter dir in the OS file explorer (Electron `shell.openPath`) AND copies a YAML stub for that command pattern into a `*.draft.yaml` file. Empty state when no scannable history. Surfaced prominently in the dashboard — this is the primary growth mechanism for filter coverage. | `src/components/settings/SnipDiscoverPanel.tsx` (new), `src/components/settings/SnipSettings.tsx` (mount panel), `src/stores/snip-store.ts` (extend with `loadDiscover`), `electron/ipc/snip.ts` (extend with `snip:openFilterDir` + `snip:createDraftFilter` if needed) | unit: ranking sorts by `runs * estimatedTokens` descending · jsdom: clicking "Write a filter" calls open-filter-dir IPC and the draft-creation IPC · empty state renders when zero unfiltered commands · manual (preview): with seeded `snip_command_log` data, panel shows top 5 unfiltered commands · both tsc | [ ] |
| K13 | **Status-line slot — snip savings counter** | Add a `snip` slot to `statusline-config.ts` (default position: between `wakeups` and `rag`, hidden until first event). Renders as `snip: 1.2k saved` where 1.2k = total tokens saved today. Click opens Settings → Snip tab. Honour `userData/statusline.md` user overrides. Neutral tone — no amber/red. | `src/components/layout/StatusLine.tsx` (slot), `electron/services/statusline-config.ts` (default + renderer), `src/lib/types.ts` (extend `SlotId` if defined there), `src/stores/snip-store.ts` (expose `todayTokensSaved`) | unit: slot returns `null` when today's saved count is 0 · unit: format helper renders `1234 → "1.2k"`, `1000000 → "1.0M"` · vitest existing statusline-config tests still pass · manual (preview): slot appears after first event; click navigates to Snip tab · both tsc | [ ] |
| K14 | **Phase verify + DEVLOG + README** | Run full verify gate: both tsc configs, all vitest, production build. Manual end-to-end smoke: launch Electron, run distinct shell commands in chat (`git status`, `git log`, `npx tsc --noEmit`, `npx vitest run`, `npm install --dry-run`, `gh pr list`, plus one with `bypass_snip: true`), confirm transcript shows compressed bodies (except bypass), Settings → Snip shows events accumulating, Discover panel populates after seeding. Write phase-complete DEVLOG entry per §5. Add a Snip subsection to README.md describing what shipped, the user filter dir, how to disable, and how to write a custom filter (link to a one-page YAML primer in `docs/snip-filter-primer.md`). | `DEVLOG.md` (phase complete), `README.md` (Snip subsection), `docs/snip-filter-primer.md` (new — one page on writing YAML filters), `memory/project_build_status.md` (refresh) | full tsc node ✓ · full tsc web ✓ · `npx vitest run` ✓ · `npx electron-vite build` ✓ · user-verification-needed: end-to-end smoke per §3 completion criteria · README + primer + DEVLOG + memory updated | [ ] |

### Phase completion criteria

- All 14 prompts marked `[x]`.
- 14 commits on the `feat/snip-phase` worktree branch.
- `npx tsc --noEmit -p tsconfig.node.json` + `-p tsconfig.web.json` both clean.
- `npx vitest run` exits 0.
- `npx electron-vite build` succeeds.
- ~125 YAML filters loaded under `resources/snip-filters/` (verifiable via `snip:listFilters` IPC).
- **Manual end-to-end smoke (user-verification-needed):** launch Electron, run at least 8 distinct shell commands during a real conversation, confirm:
  - the model receives compressed bodies for matched commands
  - failure outputs (e.g. `npx tsc` with a deliberate type error) pass through unchanged
  - already-compact outputs (e.g. `git log --oneline`) pass through unchanged
  - a call with `bypass_snip: true` receives raw output and the dashboard's "Bypassed" counter increments
  - verbose mode toggles render-side activity log without touching model-facing output
  - `Settings → Snip` shows events with non-zero "tokens saved"
  - the Discover panel surfaces at least one unfiltered command
  - Dropping a `test.yaml` into `userData/snip/filters/` is detected by chokidar and surfaces in the filter list within ~1 second
  - the status-line `snip` slot appears once at least one event is recorded
  - toggling `snipEnabled` off makes the layer transparent
- `DEVLOG.md` has 14 prompt entries + one phase-completion summary.
- `README.md` has a "Snip" subsection.
- `docs/snip-filter-primer.md` exists and shows how to write a YAML filter.
- `memory/project_build_status.md` refreshed.

---

## 4. Quick-Reference Tables

### Surfaces touched

| Layer | Files touched |
|---|---|
| New service | `electron/services/snip/{types,actions,engine,matcher,filter-loader,filter-schema,filters,tracking,apply,index}.ts` + tests |
| Filter content | `resources/snip-filters/{git,js,go,rust,python,ruby,dotnet,docker,cloud,build,files,linting,pkg,system,other}/*.yaml` (~125 files) |
| Database | `electron/services/database.ts` (two new tables: `snip_events`, `snip_command_log`) |
| Shell interpose | `electron/services/tool-registry.ts` (~5-line wire-up + descriptor schema update for `bypass_snip`), `electron/services/shell-tool.ts` (extend `ShellArgs`) |
| IPC | `electron/ipc/snip.ts` (new — 8 handlers), `electron/ipc/index.ts` (register) |
| Preload | `electron/preload.ts`, `src/lib/preload.d.ts` |
| Settings | `src/lib/types.ts` (`snipEnabled`, `snipVerbose`), `src/stores/settings-store.ts` (defaults), `electron/ipc/settings-sanitizer.ts` (allow new keys) |
| UI | `src/components/settings/SnipSettings.tsx`, `src/components/settings/SnipDiscoverPanel.tsx`, `src/components/settings/SettingsDialog.tsx`, `src/stores/snip-store.ts` |
| Status line | `src/components/layout/StatusLine.tsx`, `electron/services/statusline-config.ts` |
| Docs | `README.md`, `docs/snip-filter-primer.md` |

### Pipeline actions shipped in MVP

| Action | Use case |
|---|---|
| `strip_ansi` | Remove colour codes before further matching |
| `keep_lines` | Retain only lines matching pattern |
| `remove_lines` | Drop noise (progress bars, deprecation warnings) |
| `truncate_lines` | Cap individual line length |
| `head` / `tail` | First-N / last-N lines |
| `dedup` | Collapse repeated lines (npm install progress) |
| `replace` | Regex find-replace (path shortening) |
| `aggregate` | Count pattern matches → named counters for the template |
| `format_template` | Build final output with `{{.lines}}`, `{{.count}}`, `{{counter:NAME}}` |
| `match_output` | Short-circuit: if pattern matches anywhere, return a fixed message |
| `on_empty` | Return a fixed message when output is empty |

### RTK-parity feature mapping

| RTK CLI | Lamprey Snip surface |
|---|---|
| `rtk gain` | Settings → Snip → header card + sparkline + top filters + recent activity |
| `rtk gain --history` | Settings → Snip → Recent activity list (last 20) |
| `rtk discover` | Settings → Snip → Discover panel (K12) |
| `rtk proxy <cmd>` | `shell_command` tool with `bypass_snip: true` arg |
| `rtk -v <cmd>` | `snipVerbose: true` settings toggle (renderer-side log, not in-band) |
| `which rtk` / version check | Settings → Snip → filter library shows loader version + count |
| `~/.config/snip/filters/` (custom filter dir) | `userData/snip/filters/` (chokidar hot-reload) |

### What is intentionally NOT in this plan

- **No pre-execution "inject" rewriting.** Snip-the-CLI rewrites `git log` to `--pretty=format:%h %s` before running. This phase post-processes only. Reserve for v2.
- **No background-shell filtering.** `executeShellCommandInBackground` (monitor / dev server / terminal panel) untouched — users expect raw output there.
- **No per-filter UI toggle.** Master `snipEnabled` only. Per-filter enable/disable lives in YAML via `enabled: false` at the file level (read by loader); UI surface deferred to v2.
- **No CSV / JSON export of dashboard.** UI only.
- **No model-callable `snip_stats` tool.** Dashboard is a UI surface; the model has no access to its own savings.
- **No in-band verbose markers.** Verbose is renderer-side only — the model never sees `[snip:filter-name reduced N→M]` because it would corrupt structured tool output (diff parsers, JSON, etc.).
- **No filter marketplace / remote loading.** User filters are local files only. Reserve for v2.

### Risk register

| Risk | Mitigation |
|---|---|
| A bad filter silently corrupts output the model needs to debug | Invariant 2 (never increase token count → fall back); Invariant 4 (failures pass through); per-filter golden-input tests; `bypass_snip: true` escape hatch for one-off forensics. |
| YAML schema regression breaks user filters across an app update | K3 loader reports load errors in the dashboard "Filter health" panel; built-ins survive even if a user file fails. |
| `git log` filter strips the commit the model was looking for | Default git-log filter sets `excludeFlags: ['--pretty','--format','--oneline','-n','-1','-2','-3']` — when the model specifies its own format/count, snip is a no-op. |
| DB writes block model on slow disk | Invariant 5: `recordEvent` and `snip_command_log` writes swallow all errors. |
| Settings cache stale-read on toggle flip | K10 wire requires `snip:setEnabled` / `snip:setVerbose` to update both SQLite-backed settings AND the in-process boolean read by `applySnip`. Tested in K9/K10. |
| Sandbox / sleep guard interaction | Invariant 11: snip runs strictly AFTER `executeShellCommand` returns. |
| Renderer panic on DB corruption | `snip-store` catches IPC errors and renders an "unavailable" empty state. |
| Filter regex catastrophic backtracking on adversarial input | All built-in regexes audited at K4-K7 commit time; pipeline `try/catch` falls through to pass-through; per-step `runPipeline` errors logged but never thrown. |
| `npx tsc` filter fires on successful no-output case but model expected something | When stdout+stderr both empty AND exit==0, filter substitutes "tsc: no type errors" — a *useful* explicit signal. |
| Model never discovers `bypass_snip` exists | Descriptor schema documents it explicitly. The Discover panel UI also surfaces it for end users. |
| YAML parser dependency adds bundle weight | Use the minimal `js-yaml` (already a transitive dep — verify at K3); if not, reuse `gray-matter`'s parser (already in skill-loader). |
| First-launch bootstrap doubles disk usage of filter set | Bootstrap copies ~125 small YAML files (~250 KB total) — negligible. Idempotent on subsequent launches. |
| User filter overrides a built-in by accident | Loader reports overrides in the filter list with a "Custom override" badge — visible side-effect, not silent. |

---

## 5. Sequencing Rationale

The fourteen prompts are ordered so each later prompt assumes the earlier ones' invariants are in place:

- **K1** lays down the pure engine — pipeline action interpreter + token estimator. Pure functions, easiest to test, no DB / no IPC / no YAML dependency.
- **K2** adds command parsing + filter selection on top of K1's types. Still pure.
- **K3** introduces the YAML loader + chokidar hot-reload — the substrate K4-K7 populate. K3 is empty-set-correct: the loader works even with zero filter files.
- **K4 + K5 + K6 + K7** populate the filter set in four reviewable batches (git → JS/TS/Go/Rust → Python/Ruby/.NET/Docker/Cloud → build/files/linting/pkg/system/other). Each batch ships ~12-50 YAML files and a small extension to the golden-input test harness. Splitting keeps each commit reviewable; the diff size per prompt stays under ~3 000 LOC of pure data.
- **K8** lands the SQLite tables and tracking helpers. Pure module + DB write. No integration yet.
- **K9** is the **single integration point** — wires `applySnip` into the shell handler, adds the `snipEnabled` + `snipVerbose` flags, and the `bypass_snip` per-call arg. The layer becomes live for the model at this commit. Highest-risk prompt.
- **K10** exposes IPC + preload so the renderer can read stats, toggle flags, reload filters, and run `discover`.
- **K11** adds the gain dashboard UI on top of K10's IPC.
- **K12** adds the discover panel — the RTK-parity feature that drives filter coverage growth.
- **K13** adds the status-line slot (low-risk visual polish).
- **K14** closes the phase with full verify + docs + primer.

Each prompt's verify gate is independently exercisable. K9 is the highest-risk prompt — if it lands wrong, the model sees corrupted output. It must pass its golden-input integration test before commit.

---

## 6. Sign-off Block

When all 14 prompts are `[x]`, append to DEVLOG.md:

```markdown
## [Snip Phase Complete] — <YYYY-MM-DD>

**Prompts completed:** K1 engine + actions, K2 matcher, K3 YAML loader + hot-reload, K4 git filters, K5 JS/TS + Go + Rust filters, K6 Python + Ruby + .NET + Docker + Cloud filters, K7 build + files + linting + pkg + system + other filters, K8 tracking + DB migration, K9 apply + shell interpose + `bypass_snip` + verbose, K10 IPC + preload + discover IPC, K11 SnipSettings dashboard, K12 Discover panel, K13 status-line snip slot, K14 phase verify + DEVLOG + README + primer.

**Phase verify:**
- tsc node ✓
- tsc web ✓
- vitest ✓ (N files / N tests)
- production build ✓
- user-verification-needed: full end-to-end smoke per §3 completion criteria.

**Filter set shipped:** ~125 built-in YAML filters across git, JS/TS, Go, Rust, Python, Ruby, .NET, Docker/K8s, cloud/infra, build tools, files/search, linting, package managers, system/network, and misc — matching snip's coverage.

**RTK-parity features:** `gain` dashboard, `discover` filter-gap scanner, per-call `bypass_snip: true` (rtk-proxy analogue), `snipVerbose` settings toggle (rtk -v analogue), chokidar hot-reload on user filter dir (rtk-custom-filter analogue).

**Notes:** Lamprey now ships an in-process RTK-style shell-output filter layer with snip-style YAML extensibility. Every foreground shell command runs through declarative pipelines before reaching the model. Token savings tracked in `snip_events`; all command runs tracked in `snip_command_log` to feed the Discover panel. Pre-execution inject rewriting and per-filter UI toggles are deferred to a v2 phase. The filter library evolves independently of the app — community filters drop into `userData/snip/filters/` and hot-reload.

**Commit range:** <first-sha>..<last-sha>
```
