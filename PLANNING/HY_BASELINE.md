# HY_BASELINE.md — Hygiene Phase HY0 measurement

**Measured:** 2026-06-09, default model `deepseek-v4-pro`, native catalog only (no MCP
servers connected). Method: `electron/services/__hy0_probe.test.ts` (temporary probe,
removed after the run) loaded `tool-packs` + the registry and serialized the real
`getNormalizedToolsForRole('coder', 'deepseek')` dispatch array.

## Tool surface sent to the model per turn

| Surface | Tools | JSON bytes |
|---|---:|---:|
| **Current (full catalog)** — every native tool, every turn | 46 | **38,522** |
| Proposed always-on core (HY1 set) | 10 | 12,252 |
| **Proposed lazy surface** (core + `tool_search` meta-tool) | 11 | **≈ 12,472** |
| **Reduction** | | **67.6%** |

Native-only. With MCP servers connected (Gmail / Drive / Chrome can each add dozens to
hundreds of tools), the full-catalog surface grows unbounded while the lazy surface stays
flat at ~12 KB — so the real-world reduction is materially larger than 67.6%.

### Heaviest individual tool schemas (full surface)
| Tool | bytes |
|---|---:|
| `shell_command` | 4,887 |
| `multi_agent_run` | 1,484 |
| `ask_user_question` | 1,433 |
| `verify_workspace` | 1,397 |
| `create_document` | 1,331 |
| `browser_evaluate_readonly` | 1,231 |
| `frontend_qa` | 1,185 |
| `workspace_context` | 1,111 |

## Eager skill bodies

Active skill `SKILL.md` bodies are injected verbatim into the system prompt
(`system-prompt-builder.ts:242`). Bundled corpus: **12 files, 11,775 bytes total, avg
981 bytes/file.** Each enabled skill adds its full body to every turn (HY4 makes this lazy).

## Tool results

Tool results land in history verbatim; only `shell-tool.ts` clamps stdout/stderr at 30 KB.
A single large `git log` / `grep` / file read can therefore add tens of KB to every
subsequent turn's context for the rest of the conversation (HY3 adds the spill valve).

## HY7 target
Re-measure with `toolSurface: 'lazy'` default and record in `HY_AFTER.md`. Goal: **≥60%
tool-schema-byte reduction on the default roster, zero capability lost** (every tool still
reachable via `tool_search`). Baseline already shows 67.6% native-only — the target is
achievable; HY7 confirms it holds end-to-end after wiring.
