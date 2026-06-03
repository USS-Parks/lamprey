
# Lamprey Data Spine Plan: Durable Event Log First

## Summary

Build a clearer local data spine around an append-only SQLite event log. Do this without a broad rewrite: keep existing domain tables for conversations, messages, projects, automations, permission policies, and tool calls, but add one durable `events` table and a small typed writer/query service that every major subsystem can use.

Priority is record logging. Local retrieval/RAG and broader database consolidation should build on the same event spine after the audit trail is reliable.

## Key Changes

### 1. Add A Durable Event Log

Add a new SQLite-backed `events` table through `electron/services/database.ts`.

Core columns:

- `id TEXT PRIMARY KEY`
- `type TEXT NOT NULL`
- `created_at INTEGER NOT NULL`
- `severity TEXT NOT NULL DEFAULT 'info'`
- `conversation_id TEXT`
- `project_id TEXT`
- `workspace_path TEXT`
- `automation_id TEXT`
- `tool_call_id TEXT`
- `parent_event_id TEXT`
- `correlation_id TEXT`
- `actor_kind TEXT NOT NULL`
- `actor_id TEXT`
- `entity_kind TEXT`
- `entity_id TEXT`
- `payload_json TEXT NOT NULL`
- `redaction TEXT NOT NULL DEFAULT 'metadata'`

Indexes:

- recent events: `(created_at DESC)`
- conversation timeline: `(conversation_id, created_at DESC)`
- project/workspace timeline: `(project_id, created_at DESC)`, `(workspace_path, created_at DESC)`
- correlation/run trace: `(correlation_id, created_at ASC)`
- type filtering: `(type, created_at DESC)`

Do not store secrets, full API keys, OAuth tokens, or unbounded model payloads. Store metadata, bounded previews, IDs, statuses, counts, durations, model/provider names, and redacted paths/arguments where needed.

### 2. Add A Typed Event Service

Create a main-process service, conceptually `event-log.ts`, with:

- `recordEvent(input): EventRecord`
- `recordInfo`, `recordWarning`, `recordError` helpers
- `listEvents(filter): EventRecord[]`
- `getEvent(id): EventRecord | null`
- `listTimeline({ conversationId | projectId | workspacePath | correlationId })`

The service owns JSON serialization, timestamping, payload size caps, and redaction helpers. Callers should not write raw SQL into `events`.

Define event type constants or a TypeScript union for v1 categories:

- `tool.call.started`
- `tool.call.approved`
- `tool.call.denied`
- `tool.call.completed`
- `tool.call.failed`
- `agent.stage.started`
- `agent.stage.completed`
- `agent.stage.failed`
- `model.request.started`
- `model.request.completed`
- `model.request.failed`
- `chat.cancelled`
- `chat.error`
- `workspace.changed`
- `worktree.created`
- `worktree.removed`
- `automation.started`
- `automation.completed`
- `automation.failed`
- `security.decision`
- `permission.policy.created`
- `permission.policy.updated`
- `permission.policy.deleted`
- `settings.updated`

### 3. Wire The Highest-Value Producers First

Wire event recording into these paths first:

- Tool calls: mirror existing `tool_calls` lifecycle into `events`; keep `tool_calls` as the structured tool-call table.
- Permission approvals: record modal decisions, policy matches, auto-deny timeouts, and plaintext-key consent decisions.
- Agent pipeline: record planner/coder/reviewer stage start, completion, failure, model id, duration, and correlation id.
- Model calls: record provider/model, streaming/non-streaming, tool count, duration, retry count, cancellation, and final status.
- Chat cancellation/error: record user cancellation and backend errors with conversation id.
- Workspace/worktree changes: record active workspace changes and worktree create/remove actions.
- Automations: record scheduled/manual run start, completion/failure, model, duration, and bounded result preview.
- Settings changes: record changed keys only, never raw values.

Every chat turn should get a `correlation_id` generated in `chat:send`. The same id should be passed to tool calls, agent stages, model requests, approval decisions, and final errors so one run can be reconstructed.

### 4. Add Read APIs And A Minimal UI Surface

Expose read-only IPC:

- `events:list(filter)`
- `events:get(id)`
- `events:timeline(filter)`

Add a first lightweight UI surface only after writes are in place:

- conversation activity timeline
- recent security decisions
- automation run history
- tool-call detail links back to existing tool-call records

Do not build a full analytics dashboard in v1. The goal is debuggability and auditability.

### 5. Prepare For Local Retrieval/RAG After Logging

After event logging lands, add a second phase for local retrieval:

- `documents` table for indexed sources: workspace files, attached files, skills, memory, planning docs
- `document_chunks` table with source id, path, hash, mtime, chunk text, token estimate
- SQLite FTS5 over chunks as v1 retrieval
- optional embeddings later, behind provider/model availability
- retrieval events: `rag.index.started`, `rag.index.completed`, `rag.query.executed`

Do not block event logging on embeddings. FTS5 plus provenance is the right first step.

## Implementation Plan

1. Add event schema and migration-safe indexes in the existing database initializer.
2. Implement the typed event log service with payload caps and redaction helpers.
3. Generate and thread `correlation_id` through chat turns, agent pipeline stages, model calls, tool calls, approval decisions, and automations.
4. Add producer calls in the existing services without changing their primary behavior.
5. Add read-only IPC and a small activity timeline UI.
6. Add local retrieval tables and FTS only after the event log is stable.

## Test Plan

Add unit tests for:

- event insert/read/filter behavior
- payload JSON validation and size caps
- redaction of secret-like fields
- correlation id grouping
- event writes from tool-call lifecycle
- approval modal/policy/timeout event recording
- agent pipeline stage event ordering
- automation success/failure event recording
- settings updates logging changed keys only

Add integration-style tests for:

- one chat turn produces a coherent event timeline
- cancelled chat records model/tool cancellation metadata
- failed tool call records both `tool_calls` status and event log entry
- automation run writes start and terminal events
- workspace change writes a `workspace.changed` event

## Assumptions

- SQLite remains the source of truth for local product state.
- `tool_calls` stays as the structured tool-call audit table; `events` is the cross-system timeline.
- Credentials remain in the keychain file; the event log records consent/security metadata only.
- Settings remain JSON for now; only settings-change events move into SQLite.
- Local RAG starts with SQLite FTS5, not embeddings.
- Event payloads are metadata-first and bounded; raw model responses stay in messages, not in events.


# Lamprey Data Spine Prompt Timeline

## Summary

This timeline breaks the data-spine consolidation into small, reviewable prompts. The first five prompts prioritize durable record logging. Later prompts prepare local retrieval/RAG and broader persistence cleanup without destabilizing Lamprey’s existing conversation, tool-call, project, automation, settings, and credential flows.

## Prompt Timeline

| Prompt | Title | Primary Goal | Depends On | Status |
|---|---|---|---|---|
| 1 | Event Log Foundation | Add append-only SQLite event table and typed event service | None | Planned |
| 2 | Tool + Approval Audit Events | Mirror tool-call lifecycle and permission decisions into the event log | Prompt 1 | Planned |
| 3 | Chat, Model, And Agent Run Events | Log model calls, chat errors/cancels, retries, and agent pipeline stages | Prompt 1 | Planned |
| 4 | Workspace, Worktree, And Automation Events | Log workspace changes, worktree actions, and automation runs | Prompt 1 | Planned |
| 5 | Event Timeline Read APIs + UI | Expose read-only event queries and add a minimal activity timeline | Prompts 1-4 | Planned |
| 6 | Persistence Boundary Cleanup | Consolidate store patterns around SQLite and reduce scattered state writes | Prompts 1-5 | Planned |
| 7 | Local Retrieval Foundation | Add documents/chunks tables and SQLite FTS5 local retrieval | Prompt 6 | Planned |
| 8 | Retrieval Events + Provenance UI | Log index/query events and show source provenance in retrieval results | Prompt 7 | Planned |

## Prompt 1 — Event Log Foundation

Add the durable event spine.

Implement:

- Add `events` table and indexes in the existing SQLite schema initializer.
- Add a typed main-process event service with `recordEvent`, `getEvent`, and `listEvents`.
- Enforce payload JSON serialization, payload size caps, timestamps, and metadata-only redaction.
- Add event type constants for tool, approval, model, agent, chat, workspace, automation, settings, and security events.

Acceptance:

- Events persist across app restart.
- Event payloads reject or truncate oversized content.
- No secrets or raw credentials can be written through the event service.
- Existing app behavior is unchanged.

Verification:

- TypeScript checks.
- Event service tests for insert/read/filter/redaction.
- Bundle smoke.

## Prompt 2 — Tool + Approval Audit Events

Make tool and permission behavior reconstructable.

Implement:

- Record events when tool calls start, complete, fail, or are denied.
- Link event rows to existing `tool_calls.id`.
- Record approval decisions from modal, policy match, no-window deny, and timeout deny.
- Record security decisions such as plaintext-key consent without storing secrets.

Acceptance:

- Existing `tool_calls` table remains the structured tool-call source.
- Event log provides the timeline around each tool call.
- Approval source is visible in both tool-call records and event records.

Verification:

- Tool-call lifecycle tests.
- Permission decision tests.
- Redaction tests for secret-like args.

## Prompt 3 — Chat, Model, And Agent Run Events

Make a chat turn traceable end to end.

Implement:

- Generate a `correlation_id` at `chat:send`.
- Thread it through model requests, tool calls, approvals, agent pipeline stages, errors, cancellation, and final completion.
- Record model request metadata: provider, model id, streaming/non-streaming, tool count, retry count, duration, status.
- Record agent pipeline stage start/done/error for planner, coder, and reviewer.
- Record chat errors and cancellations.

Acceptance:

- One chat turn can be reconstructed by querying one correlation id.
- Single-mode and multi-mode turns both produce coherent event timelines.
- No full model responses are duplicated into events; messages remain the content source.

Verification:

- Chat-turn event timeline tests.
- Agent pipeline event ordering tests.
- Cancellation and provider-error tests.

## Prompt 4 — Workspace, Worktree, And Automation Events

Cover non-chat product workflows.

Implement:

- Record active workspace set/clear events.
- Record worktree create/remove attempts and outcomes.
- Record automation start/completion/failure with automation id, model, duration, and bounded result preview.
- Record project assignment/archive/pin/delete events where relevant.

Acceptance:

- Automation run history no longer depends only on `last_run_at` / `last_result`.
- Workspace and worktree changes are visible in the event timeline.
- Project-related events can be filtered by project id.

Verification:

- Workspace-state event tests.
- Worktree IPC event tests.
- Automation runner success/failure tests.

## Prompt 5 — Event Timeline Read APIs + UI

Make the log useful inside Lamprey.

Implement:

- Add read-only IPC for recent events, event detail, and filtered timelines.
- Add a minimal Activity Timeline view scoped to conversation/project/workspace.
- Link tool-call events to existing tool-call details.
- Show security decisions and automation runs with compact labels.

Acceptance:

- Renderer cannot write events directly.
- Timeline supports filtering by conversation id, project id, workspace path, event type, and correlation id.
- UI remains read-only and lightweight.

Verification:

- IPC handler tests.
- Timeline rendering tests if renderer test support is available.
- Manual smoke through one chat turn and one automation run.

## Prompt 6 — Persistence Boundary Cleanup

Reduce scattered state ownership after the event spine is stable.

Implement:

- Standardize store modules around explicit SQLite repository functions.
- Keep settings JSON and keychain files in place, but log their state-changing operations.
- Move one-off text-file state only when it materially improves consistency.
- Document which state belongs in SQLite, JSON settings, keychain, or cache.

Acceptance:

- No broad ORM migration.
- Existing data remains compatible.
- Store boundaries are documented and easier to audit.

Verification:

- Existing persistence tests.
- Migration compatibility checks.
- Smoke existing conversations, projects, automations, and permissions.

## Prompt 7 — Local Retrieval Foundation

Add local retrieval without overbuilding.

Implement:

- Add `documents` and `document_chunks` tables.
- Add SQLite FTS5 index over chunk text.
- Index workspace files, attached files, skills, memory entries, and planning docs.
- Store provenance: source kind, path/id, hash, mtime, chunk range.
- Add query service returning ranked chunks with provenance.

Acceptance:

- Retrieval works locally without embeddings.
- Indexer updates changed files by hash/mtime.
- Results always include source provenance.

Verification:

- Index/query tests.
- File-change reindex tests.
- Provenance tests.

## Prompt 8 — Retrieval Events + Provenance UI

Tie retrieval into the event spine.

Implement:

- Record index start/completion/failure events.
- Record retrieval query metadata: source scopes, result count, duration.
- Add compact source/provenance display for retrieved context.
- Keep raw retrieved text out of event payloads except bounded previews.

Acceptance:

- RAG activity is auditable like tools and model calls.
- Users can inspect where retrieved context came from.
- Retrieval failures are visible in Activity Timeline.

Verification:

- Retrieval event tests.
- Provenance UI smoke.
- End-to-end local retrieval smoke.

## Defaults And Assumptions

- Event logging is first priority.
- SQLite remains Lamprey’s local data spine.
- Existing tables stay in place; the new `events` table complements them.
- Credentials stay outside SQLite in the keychain file.
- Event payloads are metadata-first and redacted.
- Local RAG starts with SQLite FTS5; embeddings are deferred.
- Vitest/runtime smoke can be run by Claude; Codex audits code shape and non-Vitest checks.
