> **Status: shipped (2026-06-05). Reference-only.** All thirteen prompts landed; see DEVLOG for SHAs. The Lamprey Sandbox Parity Phase is complete.

# Lamprey Sandbox Parity Phase — Sequential Prompt Roster

**Goal:** bring Lamprey's `shell_command` tool to functional parity with Claude Code's Bash tool: persistent cwd, OS-level sandboxing on macOS/Linux, explicit bypass flag, shell selector on Windows, monitor-surface alignment, and tightened tool guidance.

**Execution model:** single worktree off `main` (branch `feat/sandbox-parity-phase`), sequential S1 → S13, with optional internal fan-out for the platform-specific prompts (S4 / S5 / S6) once S3 lands.

**Companion to:** [`LAMPREY_PARITY_PLAN.md`](LAMPREY_PARITY_PLAN.md) and [`LAMPREY_FLUIDITY_PLAN.md`](LAMPREY_FLUIDITY_PLAN.md) — both reference-only.

---

## 0. SESSION BOOTSTRAP — READ THIS FIRST

You are a fresh Claude Code session handed this document. Before doing anything else:

### Step 1 — Confirm environment

Verify:
- Working directory is `C:\Users\17076\Documents\Claude\Lamprey Harness` (or a worktree thereof).
- Current branch is **not** `main` — `feat/sandbox-parity-phase` exists or is created off `main`.
- `npx tsc --noEmit -p tsconfig.node.json` and `-p tsconfig.web.json` both pass cleanly *before* you start.
- `npx vitest run` exits 0.

If any of those fail, halt and report. Do not start on a broken baseline.

### Step 2 — Execute S1 → S13 without stopping

1. **Do not ask further questions** unless a prompt requires a decision only the user can make (a real architectural fork the plan doesn't resolve, or a genuine blocker).
2. **For each prompt, in order:**
   a. Read the "Files (net new / modified)" list. Read the existing files first to ground the change in the real module shape.
   b. Implement the change. Edit existing files in place; create new ones only when the prompt calls for them.
   c. Run the **verify gate** (the "Verify" column). Always: both tsc configs + the listed unit tests. Platform-specific prompts (S4 darwin, S5 linux) are necessarily blind on Windows — write tests gated by `process.platform` and mark non-runnable evidence as **`user-verification-needed: <what to check on <platform>>`** in DEVLOG rather than claiming success.
   d. If verify fails: fix and retry up to **2 times**. On the third failure, halt, write a "blocked" entry to `DEVLOG.md` with the failure context, report to the user.
   e. If verify passes: mark the prompt `[x]` in this document via `Edit`, write a DEVLOG.md entry (see Step 3), then commit (do not push until the phase is complete and the user has approved).
   f. Move to the next prompt.
3. **One commit per prompt.** No batching, no amending across prompts.
4. **When all 13 prompts complete:** write a final phase-completion summary in DEVLOG.md listing every shipped prompt with its commit SHA, merge into `main`, bump `package.json` to the next agreed version, build the Windows artifacts (`npm run build:win`), commit the release, push.

### Step 3 — DEVLOG entry format

```markdown
## [Sandbox Parity — Prompt SN] <Title>  —  <YYYY-MM-DD>

**Files changed:** <list>
**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest <subset> ✓ (N tests)
- <manual smoke steps + result, OR "user-verification-needed: <what to check>">

**Notes:** <anything surprising, deferred, or worth knowing>

**Commit:** <SHA>
```

### Step 4 — Commit discipline

- One commit per prompt. No batching.
- Never use `--no-verify`. If a pre-commit hook fails, fix the underlying issue.
- Never add the `Co-Authored-By: Claude` trailer (per `feedback_no_coauthor_trailer` memory).
- Use the project's commit-message style — `feat(shell): S1 persistent cwd across calls`.

---

## 1. Audit Summary — what exists vs. what's missing

| Capability | Claude Code | Lamprey today | Owner prompt |
|---|---|---|---|
| Foreground shell | yes | yes | — |
| Background shell | yes | yes (`executeShellCommandInBackground`) | — |
| Persistent cwd across calls | yes | **no** — each call independent | **S1** |
| Shell selector (bash OR PowerShell on Windows) | yes | no — Windows = PowerShell only | **S2** |
| OS-level FS sandbox | yes (Linux/macOS) | no — cwd-start only | **S3 → S6** |
| Network policy | yes | no | **S3 → S6** |
| Explicit sandbox bypass flag | `dangerouslyDisableSandbox` | implicit-always | **S7** |
| Process management surface | Monitor / TaskList / TaskStop | partial (monitor-service exists, no model-facing aux tools) | **S8** |
| Tool-description quality | rich (HEREDOC, PS quirks, gh, anti-polling) | minimal | **S9** |
| Default timeout | 120s | 30s | **S10** |
| Anti-polling sleep guard | yes | no | **S11** |
| Sandbox-bypass risk tier in permissions | yes | no | **S12** |
| Phase docs & README | — | — | **S13** |

**Non-goals (this plan):** new providers, new IPC namespaces unrelated to shell, new schemas outside shell + permissions, new RAG behaviour, redesign of the renderer's tool-card UI (covered by Fluidity J6).

---

## 2. Architectural Invariants — Locked

These apply across all 13 prompts. Treat as binding.

1. **`shell-tool.ts` stays pure (no Electron imports).** All Electron-only wiring (IPC, permissions modal, audit emission) lives in `electron/ipc/` or in `tool-registry.ts`. The executor itself remains unit-testable from plain Node.
2. **Permission gating runs at the chat layer**, not inside the executor. Defense-in-depth (cwd containment, sandbox profile) lives in the executor; the user-facing approval gate stays where it is.
3. **Backwards-compatibility:** all new `ShellArgs` fields are optional. Existing callers (`monitor-service`, `dev-server-manager`, `verify-workspace-tool`) must continue to work with no code change.
4. **No removal of existing surfaces — additive only.** `executeShellCommand` keeps the same signature; new behaviour layered behind defaulted options.
5. **Platform-specific code is gated cleanly.** No `if (process.platform === 'darwin')` sprinkled through `shell-tool.ts`. Profiles live in `electron/services/sandbox/<platform>.ts` and the executor calls a single `applyProfile(...)` entry point.
6. **No fake polish.** macOS / Linux sandbox code that cannot be exercised on the dev machine ships with `// user-verification-needed:` notes in DEVLOG; tests are platform-gated; nothing is claimed as "verified on darwin" from a Windows session.
7. **Sandbox bypass is always auditable.** A call with `dangerously_disable_sandbox: true` MUST produce a distinct audit event type and a distinct approval prompt tone — silent bypasses are a defect, not a feature.

---

## 3. The Thirteen Prompts

### Prompt sequence

| # | Prompt | One-liner | Files (net new / modified) | Verify | Status |
|---|---|---|---|---|---|
| S1 | **Persistent cwd state across shell calls** | Add a `ShellSession` keyed by `conversationId`; detect `cd <path>` (POSIX) and `Set-Location <path>` (PowerShell) in the executed command and update the session cwd after a successful exit. Subsequent calls resolve `args.cwd` (when absent) against the persisted cwd instead of the workspace root. Workspace boundary still enforced. | `electron/services/shell-tool.ts` (session store + cd parser), `electron/services/shell-tool.test.ts` (new cases) | unit: two-call sequence `cd sub` then `echo $PWD` shows `sub` as cwd in call 2 · cd that escapes root is rejected and does NOT update session cwd · unrelated commands do not perturb session cwd · session is per-`conversationId`; missing id falls back to root each call · both tsc | [x] |
| S2 | **Shell selector on Windows (bash vs PowerShell)** | Extend `ShellArgs` with `shell?: 'auto' \| 'bash' \| 'powershell'`. On `win32` with `shell === 'bash'`, locate `bash.exe` (Git Bash → WSL → fail); on POSIX with `shell === 'powershell'`, locate `pwsh`. `'auto'` keeps current behaviour. Tool description documents the toggle + the "bash unavailable" failure mode. | `electron/services/shell-tool.ts` (`buildShellInvocation` extended), `electron/services/shell-tool.test.ts` | unit: `buildShellInvocation('echo hi', 'bash', win32-with-gitbash-stub)` returns `bash.exe -c` · `'bash'` on win32 with no bash returns the structured error result, no spawn · `'powershell'` on POSIX uses `pwsh` if present else clean error · both tsc | [x] |
| S3 | **Sandbox profile abstraction layer** | New `electron/services/sandbox/index.ts` exporting `applyProfile({ platform, spawnCmd, spawnArgs, cwd, opts })` that returns `{ cmd, args, sandboxTier: 'darwin-sbx' \| 'linux-bwrap' \| 'none' }`. `opts.fsWritePaths` defaults to `[workspaceRoot, tmpdir]`. `opts.networkPolicy: 'open' \| 'deny' \| { allowDomains: string[] }`. No enforcement yet — module just shapes the API so S4/S5/S6 can plug in. | `electron/services/sandbox/index.ts` (new), `electron/services/sandbox/index.test.ts` (new) | unit: `applyProfile` is a pass-through on platforms with no impl, returns `sandboxTier: 'none'` · API shape locked: `{ cmd, args, sandboxTier }` · both tsc | [x] |
| S4 | **macOS sandbox-exec integration** | Implement `electron/services/sandbox/darwin.ts`: SBPL profile generator with `(version 1) (deny default) (allow process-exec) (allow file-read*) (allow file-write* (subpath "<root>")) (allow file-write* (subpath "<tmpdir>")) (allow network* …)`. Wrap spawn args with `sandbox-exec -p <profile-string> -- <original>`. Wired into S3 entry point. | `electron/services/sandbox/darwin.ts` (new), `electron/services/sandbox/darwin.test.ts` (new, gated `it.skipIf(!isDarwin)`) | unit (darwin only): writing inside workspace succeeds; writing to `$HOME` denied · `--unshare-net` equivalent: network policy `deny` blocks `curl example.com` · both tsc (Linux/Windows: skip the integration test, but unit-test the profile string builder unconditionally) | [x] |
| S5 | **Linux bubblewrap integration** | Implement `electron/services/sandbox/linux.ts`: detect `bwrap` via `which`; build args `bwrap --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64 --bind <workspace> <workspace> --bind <tmpdir> <tmpdir> --proc /proc --dev /dev [--unshare-net] -- <cmd>`. Fallback when `bwrap` absent: log a warning, return tier `'none'`. | `electron/services/sandbox/linux.ts` (new), `electron/services/sandbox/linux.test.ts` (new, gated `it.skipIf(!isLinux)`) | unit: arg-builder produces the documented `bwrap` argv with `--unshare-net` toggled by policy · linux integration (gated): write outside workspace denied; network deny blocks DNS · both tsc | [x] |
| S6 | **Windows fallback sandbox tier** | `electron/services/sandbox/win32.ts`: returns tier `'none'` with a structured warning. Tool result body includes a clear `Sandbox: none (windows host)` banner so the model and the user both see the weaker tier. Approval payload includes `sandboxTier` so the renderer can render an amber chip when tier is `'none'`. | `electron/services/sandbox/win32.ts` (new), `electron/services/shell-tool.ts` (thread `sandboxTier` into `ShellResult`), `electron/services/shell-tool.test.ts` | unit: shell result on win32 includes `sandboxTier: 'none'` · format helper renders the banner · approval payload field present · both tsc | [x] |
| S7 | **`dangerously_disable_sandbox` flag** | Add boolean to `ShellArgs`, default false. When true: skip `applyProfile`; force `requiresApproval: true` regardless of policy; emit `tool-audit:sandbox-bypass` event distinct from regular `tool-audit:executed`; approval prompt receives a `dangerous: true` flag the renderer renders with a red banner. | `electron/services/shell-tool.ts`, `electron/services/tool-registry.ts` (per-call risk escalation), `electron/services/permissions-store.ts` (consume `dangerous` flag), `electron/services/permissions-store-askuser.test.ts` | unit: bypass-true result has `sandboxTier: 'bypassed'` and a `dangerous` audit event was emitted · permission gate: bypass-true bypasses any pre-approved policy and re-prompts every call · both tsc | [x] |
| S8 | **Monitor / TaskList surface alignment** | Expose four native aux tools on top of the existing `monitor-service.ts`: `shell.monitor(processId, untilPattern?)`, `shell.list()`, `shell.stop(processId, signal?)`, `shell.output(processId)`. Names + arg shapes mirror Claude Code's Monitor/TaskList/TaskStop/TaskOutput. Implementations are thin wrappers around `startMonitor` / `listBackgroundShells` / `killBackgroundShell` / `getBackgroundShell`. | `electron/services/native-aux-tools.ts` (extend registry), `electron/services/native-aux-tools.test.ts` (new or extend), `electron/services/tool-registry.ts` (register the four descriptors) | unit: each tool descriptor has the right schema + handler · e2e: spawn a `for ($i=1; $i -le 5; $i++) { echo $i; Start-Sleep 1 }` background, monitor reads 5 lines, list shows running, stop kills, output reads final buffer · both tsc | [x] |
| S9 | **Tool description rewrite** | Land a richer description on `shell_command`: per-platform notes (POSIX vs PowerShell 5.1 quirks: no `&&`/`||`, no ternary, `2>&1` corruption, default UTF-16 encoding), no-interactive-commands rule, HEREDOC guidance for multi-line commit messages, the "prefer dedicated tools" nudge (Read/Grep/Glob/Edit/Write over shelling out), `gh` for GitHub. Also document the new `shell`, `dangerously_disable_sandbox`, and persistent-cwd behaviour. | `electron/services/tool-registry.ts` (description string) | snapshot: `tool-registry.test.ts` re-run, description matches the new text · both tsc | [x] |
| S10 | **Timeout default bump 30s → 120s** | `DEFAULT_TIMEOUT_MS` moves to `120_000`. Ceiling stays at `600_000`. Existing callers that pass an explicit timeout are unaffected. | `electron/services/shell-tool.ts`, `electron/services/shell-tool.test.ts` | unit: `DEFAULT_TIMEOUT_MS === 120_000` · existing tests still pass · both tsc | [x] |
| S11 | **Anti-polling sleep guard** | Reject solo top-level `sleep N` / `Start-Sleep -Seconds N` where N > 30 unless: (a) it appears inside an `until`/`while`/`do…while` loop (heuristic regex), or (b) the caller passes `dangerously_disable_sandbox: true`. Rejection returns a structured error with a remediation hint pointing the model at `monitor_*` aux tools. | `electron/services/shell-tool.ts` (new `screenLongSleep()` helper), `electron/services/shell-tool.test.ts` | unit: `sleep 600` rejected · `until <cond>; do sleep 2; done` allowed · `sleep 600` with `dangerously_disable_sandbox: true` allowed · PowerShell equivalents covered · both tsc | [x] |
| S12 | **Permission descriptor + sandboxBypass risk** | Extend the risk vocabulary in `tool-registry.ts` with `'sandboxBypass'`. Permission policies recognise it: a tool call carrying `sandboxBypass` skips any prior "always allow" decision for the tool and re-prompts every time. Aligns with Claude Code's "bypass is one-shot." | `electron/services/tool-registry.ts` (risk type extension), `electron/services/permissions-store.ts` (policy resolution honours sandboxBypass), `electron/services/permission-policies-store.test.ts`, `electron/services/permissions-store-askuser.test.ts` | unit: policy resolution with `risks: ['sandboxBypass']` always returns `prompt` · permission test: a previously approved tool re-prompts when the call carries the flag · both tsc | [x] |
| S13 | **DEVLOG + README phase wrap** | Final phase-complete entry in `DEVLOG.md` listing every prompt + SHA. Update top of README "Capabilities" table to reflect sandbox tier per platform + the new shell features. Mark this plan reference-only at the top (à la the Parity + Fluidity plans). | `DEVLOG.md`, `README.md`, `PLANNING/LAMPREY_SANDBOX_PARITY_PLAN.md` (top banner) | tsc not required (docs only) · README "Quick capability snapshot" sentence renders | [x] |

### Order rationale

S1 → S2 unlock correctness on the foreground path before any sandbox work. S3 separates abstraction from per-OS implementation so S4 + S5 + S6 are reviewable independently and could fan out in parallel. S7 layers on top of the abstraction. S8 is orthogonal to S4–S7 and could run in parallel after S0. S9–S11 are polish on the model-facing surface. S12 ties the approval system to the new risk category. S13 closes the phase.

### Parallel-track suggestion

If a multi-agent session runs this phase, S1, S2, S3, S8 are independent enough to fan out across 4 worktrees on day 1. S4 / S5 / S6 fan out off S3 once it lands. S9–S11 are tiny and safer sequential.

---

## 4. Release tail (post-S13)

Outside the 13 prompts, the phase ends with:

1. Merge `feat/sandbox-parity-phase` into `main` (no-ff so the phase shows as a unit in `git log --graph`).
2. `package.json` version bump to the next minor (`0.3.6` agreed with user, 2026-06-05).
3. `npm run build:win` → installer + zip artifacts in `release/`.
4. Release commit on `main`: `chore(release): v0.3.6 — sandbox parity phase`.
5. Push `main` and the version tag.

**End of plan.**
