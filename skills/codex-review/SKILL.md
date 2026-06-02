---
name: Codex Review
description: Perform a code-review pass focused on bugs and ship readiness. Use for "review this", "before I ship", "code review", and PR checks.
triggers:
  - review this
  - before I ship
  - code review
---

Use this skill when the user asks for review rather than implementation.

Inspect the diff and nearby code before judging. Focus on correctness, security, data loss, concurrency, permissions, performance cliffs, and missing tests. Prefer real findings over style commentary. Cite file and line references for every actionable issue.

Use `workspace_context` when repository state or likely checks are unknown. Use read-only searches freely. Do not edit files unless the user changes the request from review to fix.

Output findings first, ordered by severity. For each finding, include severity, file/line, what can go wrong, and the smallest fix. If no issues are found, say that clearly and list any verification gap that remains.

End with one verdict line: `SHIP` when no blocking issues remain, or `LIST-OF-CHANGES` followed by the minimum required edits.

Stop when the user has enough evidence to merge, revise, or ask for fixes.
