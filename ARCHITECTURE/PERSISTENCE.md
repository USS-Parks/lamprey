# Lamprey persistence boundary

Where every category of local state lives, why it lives there, and how it gets audited. Written during Data Spine Prompt 6 — the spine is now stable, and this doc captures the boundary the spine is built on so future refactors don't quietly cross it.

## Summary table

| Backend                       | Path under `userData/`         | What lives here                                                                                                                                                | Who writes                                                          | Audit                                                            |
| ----------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **SQLite (`better-sqlite3`)** | `lamprey.db` (WAL)             | conversations, messages, memory entries, hooks, automations, projects, tool_calls, permission_policies, plan_steps, goals, **events**, project_github_repos, conversation_pull_requests | One repository module per domain in `electron/services/*-store.ts` | Mutating ops on most domains write a row to the `events` spine. |
| **JSON file (settings)**      | `settings.json`                | UI preferences, model config, agent roster, GitHub mode, agentic-coding flags                                                                                  | `electron/ipc/settings.ts` and `electron/ipc/model.ts` only         | `settings.updated` event on every successful write, KEYS-ONLY.   |
| **JSON file (MCP servers)**   | `mcp-servers.json`             | User-edited MCP server roster (transport, env, etc.)                                                                                                          | `electron/services/mcp-manager.ts` only                            | Not currently audited — Prompt 4 carry-forward.                  |
| **JSON file (keychain)**      | `keys.json` (0o600)            | Per-provider credentials, base64-encrypted via `electron.safeStorage` or `plain:` fallback under explicit consent                                              | `electron/services/keychain.ts` only                                | `security.decision` event on set / delete / consent. NEVER the value. |
| **Text file (workspace)**     | `active-workspace.txt`         | The absolute path of the user's currently-pinned workspace folder                                                                                              | `electron/services/workspace-state.ts` only                         | `workspace.changed` event on set / clear.                        |
| **POSIX/CMD script**          | `github/askpass.{sh\|cmd}` (0o700) | A scriptless `GIT_ASKPASS` helper. Reads `$LAMPREY_GH_TOKEN` from the env at invocation. Body contains NO secret.                                              | `electron/services/github-askpass.ts` only                          | Push flow is itself event-free; the helper file is materialised once and is non-secret. |
| **Bootstrapped skills dir**   | `skills/`                      | User skills, hot-reloaded                                                                                                                                      | `electron/services/skill-loader.ts`                                | `skills:changed` IPC event; not in the spine (renderer-facing only). |
| **Process-local cache**       | (RAM only)                     | Provider OpenAI client instances, workspace-path cache (1s TTL), session plaintext-consent flag, OAuth in-flight state, MCP runtime state                      | Various                                                             | Reset on app restart; nothing to audit.                          |

## Rules

1. **One owner per backend.** Each JSON/text file has exactly one module that knows its path and shape. Other callers go through that module's public API. The SQLite tables have one repo module each (`*-store.ts`) for the same reason.
2. **No second writer to `settings.json` or `keys.json`.** A second writer race-loses against the first. The only legitimate edits to `settings.json` are through `settings:set` IPC. The only legitimate edits to `keys.json` are through `keychain.setKey/deleteKey`. A code reviewer who sees a `writeFileSync(settings.json)` outside `electron/ipc/settings.ts` should reject the change.
3. **No credentials in SQLite, no metadata in the keychain.** The events spine and every other SQLite table are forbidden from ever holding a credential (the writer enforces this in `event-log.redactPayload`). The keychain is forbidden from ever holding metadata that isn't a credential — provider mode, scopes, last-used dates all belong in `settings.json` or the keychain entry's structural envelope, never in the value itself.
4. **Caches are RAM only and may be cleared at any time.** A cache that becomes the source of truth is a bug. Cached values must always have a refresh path that consults the on-disk source.
5. **One-off text files only when materially better.** `active-workspace.txt` exists because the workspace path needs to be readable from every tool dispatch — settings.json's read+merge would be a bigger hot-path cost, and a race against `settings:set` would flip the active workspace mid-run. New text-file backends should pass the same "would settings.json conflict be observable" test.

## SQLite tables

All tables live in `lamprey.db` (WAL mode, foreign keys on, `safeAddColumn` is the migration primitive). The schema is in `electron/services/database.ts`. Each table has one owner module:

| Table                          | Owner module                                                              | Audit footprint                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `conversations`                | `conversation-store.ts`                                                   | Indirectly via `chat.cancelled`, `chat.error`, `tool.call.*`, `model.request.*` carrying `conversationId`.                   |
| `messages`                     | `conversation-store.ts`                                                   | Body lives here; events do not duplicate model output.                                                                       |
| `memory_entries`               | `memory-store.ts`                                                         | Currently not audited (memory ops are user-initiated through dedicated IPC).                                                 |
| `hooks`                        | `hooks-store.ts`                                                          | Not audited — hook config is user-edited UI state.                                                                          |
| `automations`                  | `automations-store.ts`                                                    | `automation.started/completed/failed` per run, plus `last_run_at/last_result` legacy fields.                                 |
| `projects`                     | `projects-store.ts`                                                       | `project.created/archived/pinned/deleted`. Rename and `touch` are intentionally silent.                                      |
| `tool_calls`                   | `tool-calls-store.ts`                                                     | `tool.call.started/approved/denied/completed/failed` per call, linked by `tool_call_id`.                                     |
| `permission_policies`          | `permission-policies-store.ts`                                            | Approval events carry the matched `policyId`; explicit `permission.policy.*` events are reserved but not yet wired.          |
| `plan_steps`                   | `plan-goal-store.ts`                                                      | Not currently in the spine; high-volume, model-driven.                                                                       |
| `goals`                        | `plan-goal-store.ts`                                                      | Same.                                                                                                                        |
| `events`                       | `event-log.ts`                                                            | The spine itself.                                                                                                            |
| `project_github_repos`         | `github-repo-store.ts`                                                    | Not currently audited; GitHub linking is a high-trust user action.                                                           |
| `conversation_pull_requests`   | `github-repo-store.ts`                                                    | Same.                                                                                                                        |

The `events` table is intentionally permissive at the SQL layer (no CHECK constraints on `type`, `actor_kind`, or `severity`) so adding a new event category doesn't require a schema migration. The TypeScript `EVENT_TYPES` tuple in `event-log.ts` is the real allow-list; the writer rejects unknown types.

## Repository pattern

Every store module follows a consistent shape so audits can scan them in a constant amount of time:

- `rowToX(row: XRow): X` — converts the raw SQLite row to the public type. Underscored column names → camelCase fields. Booleans stored as INTEGER 0/1 unwrap here.
- Public CRUD: `listX`, `getX`, `createX`/`upsertX`, `updateX`, `deleteX`. Each is one prepared statement.
- All `db.prepare(...)` calls use placeholders; no string concatenation, ever.
- Spine emission happens in the store module, not the IPC handler — the store is the only place that knows whether an UPDATE actually changed rows. The handler doesn't need to second-guess.
- Errors from `getDb()` propagate; a try/catch in the store would mask configuration errors. `permission-policies-store.ts` and `event-log.ts` are the two exceptions — both maintain a memory fallback specifically so headless tests can exercise the API without booting Electron.

## JSON file backends

### `settings.json` (`electron/ipc/settings.ts`)

The only legitimate writer is `settings:set`. Other code paths (e.g. `model.ts`) write through the same `writeSettings` helper. The shape merges through a `defaultSettings` block on read so older `settings.json` files upgrade in place.

- **Audit**: every successful `settings:set` writes a `settings.updated` event with `changedKeys`, `sensitiveChanged`, and `partialKeys`. Values are NEVER in the payload.
- **Sensitive keys**: the `SENSITIVE_SETTING_KEYS` allowlist (currently `apiKey` only) tags changes that the timeline UI can highlight; the value itself is still absent.
- **Concurrency**: there is no file lock. Two near-simultaneous `settings:set` calls race on the read-merge-write triple. The main process is single-threaded JavaScript, so this is only a concern if a future change introduces an async pause between read and write — don't.

### `mcp-servers.json` (`electron/services/mcp-manager.ts`)

User-edited MCP server config. Defaults are written on first launch so the user has a starting roster. **Not currently audited** — adding `mcp.config.updated` events to `EVENT_TYPES` is a clean follow-up; the timeline UI already handles unknown event categories gracefully.

### `keys.json` (`electron/services/keychain.ts`)

The credentials file. Mode `0o600` on POSIX, ACL-inherited on Windows. Values are base64-encoded `safeStorage` ciphertext, or `plain:<value>` when `safeStorage.isEncryptionAvailable()` is false AND the caller has explicit plaintext consent.

- **Audit**: every mutating operation writes a `security.decision` event:
  - `key-created` — first write for a provider.
  - `key-updated` — overwrite of an existing provider's key.
  - `key-deleted` — provider removed (no event when deleting a provider that didn't exist).
  - `key-set-refused` — plaintext write attempted without consent; `setKey` throws.
  - `plaintext-consent-granted` — session consent flag flipped on; emitted only on the transition, not on every grant call.
- **The audit contract**: the helper accepts **only** discrete metadata (`action`, `provider`, `outcome`, `storageMode`). The key VALUE is never an argument and never lands in `payload_json`. A future refactor that adds a `key?: string` field to `KeychainEventDetail` breaks the contract and must fail review.
- **Implicit consent re-grant**: reading an existing `plain:` row inside `getKey` flips `sessionPlaintextConsent` so background refreshers (MCP OAuth) can re-save without re-prompting. This is a deliberate decision; the doc comment in `keychain.ts` explains why. The re-grant path does NOT emit a `plaintext-consent-granted` event (we don't want one event per OAuth refresh).

## Text-file backend

### `active-workspace.txt` (`electron/services/workspace-state.ts`)

Single-line text file holding the absolute resolved path of the current workspace. Lazy 1-second cache. Falls back to `process.cwd()` when the file is missing, unreadable, or points at a non-existent directory.

- **Audit**: `workspace.changed` event on every `setActiveWorkspace` that actually changed the value, and on every `clearActiveWorkspace` that actually removed the file. No event for no-op transitions.
- **Why not settings.json?** Workspace lookup happens on every tool dispatch. Routing it through `settings:get` would: (a) make every tool dispatch read+merge the entire settings object, and (b) introduce a race window where `settings:set` from another tab could swap the workspace mid-run. The text file is a single-line read with a 1s cache.

## Helper-script backend

### `github/askpass.{sh|cmd}` (`electron/services/github-askpass.ts`)

A `GIT_ASKPASS` helper script materialised once at first push and re-used. The script body reads `$LAMPREY_GH_TOKEN` from the env at invocation time and prints it; the file itself contains **no secret**. Mode `0o700` on POSIX. The keychain audit covers the token's lifecycle; the askpass file is non-secret and not audited.

## What is intentionally NOT audited

- **Reads.** `events:list/get/timeline`, `settings:get`, every `getX` repo function, every JSON read. Reads don't change state; auditing them would drown the timeline.
- **High-volume model-internal mutations.** `plan_steps`, `goals`, `memory_entries` are all model-driven and would dominate the timeline if every step emitted an event. The structured tables themselves are the audit trail for those.
- **Cache invalidation.** Provider client cache, workspace-path cache. They're RAM-only.
- **Renaming a project.** `renameProject` is silent. Rename is noisy enough (model-callable mid-turn) that it would dominate; the project's createdAt/lastActivityAt is the authoritative version timeline.
- **Touching a project's `last_activity_at`.** Same reason as rename.

## Migration story

`safeAddColumn` is the project's migration primitive: a try-add-column, swallow-on-already-exists wrapper. New columns land via `safeAddColumn`; new tables via `CREATE TABLE IF NOT EXISTS`. There is no migration version table — the schema is forward-additive and old columns are never renamed or removed without a new column + dual-write window.

If a column needs renaming or a table needs splitting, the migration approach is:

1. Add the new column / table via `safeAddColumn` / `CREATE TABLE IF NOT EXISTS`.
2. Dual-write through the store module for one release.
3. Backfill any existing rows in a one-off main-process startup step.
4. Switch reads to the new column / table.
5. Stop writing the old column / table (do not drop it — `safeAddColumn` doesn't drop either).

## Carry-forward (Prompts 7-8 dependencies)

The local retrieval foundation (Prompt 7) will add `documents` and `document_chunks` tables and a SQLite FTS5 index. Both land in `lamprey.db` and follow the repository pattern documented above. Retrieval queries become a new store module. The audit story (Prompt 8) wires `rag.index.started/completed/failed` and `rag.query.executed` event types and uses the same `boundedJsonPreview` helper for provenance previews. Nothing in this doc needs to change for those prompts.
