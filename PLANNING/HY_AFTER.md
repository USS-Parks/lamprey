# HY_AFTER.md — Hygiene Phase HY7 result

**Measured:** 2026-06-09, default model `deepseek-v4-pro`, native catalog only
(no MCP servers connected). Same method as `HY_BASELINE.md`.

## Model tool-surface per turn

| Surface | Tools | JSON bytes |
|---|---:|---:|
| Full catalog (`toolSurface: 'full'`) | 48 | 39,737 |
| **Lazy surface (default)** — 12 core + `tool_search` | 13 | **14,398** |
| **Reduction** | | **63.8%** |
| Lazy + 3 unlocked (browser/image/multi-agent) | 16 | 17,347 |

Native-only. The lazy surface stays flat (~14 KB) regardless of how many MCP
connectors are attached, so the real-world reduction grows without bound as
Gmail / Drive / GitHub / Chrome servers add tools — the full surface would
balloon while lazy holds.

Target was **≥60% reduction with zero capability lost** — met (63.8%). The
catalog grew by 2 tools this phase (`read_tool_result`, `skill_open`) and CORE
grew 10 → 12, which is why the figure is 63.8% vs the 67.6% HY0 projection;
both are comfortably past the floor. Every tool remains reachable via
`tool_search` (proven by the model-tool-surface integration test).

## What shipped

| Prompt | Win |
|---|---|
| HY1/HY2 | Lazy model tool-surface: core + `tool_search` round-trip, per-conversation unlock, FC-10-style downgrade to full for weak models. **−63.8% tool-schema bytes/turn.** |
| HY3 | Tool-result spill valve: results > 8192 chars written to disk, model gets head+tail+ref, `read_tool_result` pages it back. One big grep/log no longer floods the whole conversation. |
| HY4 | Lazy skill bodies: active skills inject name+description stubs; `skill_open` loads the body on demand. Saves ~981 bytes/active-skill/turn. |
| HY5 (Split) | Proof gate + change contracts engage only on rigor turns (audit/verify/prove/multi-agent). L8 routing untouched. Casual turns get clean replies, no receipts scan. |
| HY6 | One few-shot exemplar in the contract — exemplar steering over prose rules for instruction-tuned models. |

## Honest gaps / follow-ups
- **Cogency of the lazy round-trip + HY6 exemplar needs a real DeepSeek pass.**
  These measurements prove byte savings and mechanical correctness; whether V4
  Pro/Flash drive `tool_search` fluently (and whether Flash trips the
  downgrade) can only be judged live, in the `LL_SMOKE_PLAYBOOK` style.
- **`read_tool_result` / spill files are not garbage-collected** within a
  session (they live under `userData/tool-results/`); a periodic sweep on app
  start is a reasonable follow-up.
- **`tool_search` calls don't emit a live `chat:tool-call` UI card** (handled
  before the event plumbing); the result is still persisted and shown. UI
  polish is a follow-up if the round-trip feels opaque in practice.
