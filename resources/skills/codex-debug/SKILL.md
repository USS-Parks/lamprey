---
name: Codex Debug
description: Reproduce, isolate, fix, and verify bugs. Use for "debug", "this is broken", "fix the bug", and failing tests.
triggers:
  - debug
  - this is broken
  - fix the bug
---

Use this skill for bug reports, failing checks, broken UI behavior, regressions, and "make this work" requests.

Reproduce before changing code. Use `workspace_context` to find likely commands, then use `shell_command` for a targeted failing test, typecheck, log read, or repro script. Record the observed failure in plain terms.

Isolate the smallest responsible area by reading the failing file, nearby tests, and relevant call sites. Avoid broad rewrites. Once the cause is clear, make the narrowest fix that preserves existing patterns.

After editing, verify the original failure path first. Then run `verify_workspace` or the relevant focused check so the final result is not just "the edit saved." If the bug is visual and the user gave a URL, use `frontend_qa` after the code check.

Stop when the original failure is gone or when you can name the blocker and the next exact diagnostic step.
