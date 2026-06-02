---
name: Codex Verify
description: Verify recent changes with the right checks. Use for "verify", "did it work", "check the change", and pre-commit validation.
triggers:
  - verify
  - did it work
  - check the change
---

Use this skill when the user asks whether work is correct, or after you have edited code.

Start with `verify_workspace` unless the user gave a more specific check. It infers common test, typecheck, lint, and verify commands from the active workspace. Read its JSON report carefully: passing commands are evidence, skipped commands are gaps, and failed commands need a concrete follow-up.

If the change touched frontend behavior and the user supplied a dev-server URL, use `frontend_qa` after code checks. Include expected visible text or selectors when the user gave them; otherwise report page health as needs review rather than inventing assertions.

Do not treat a saved file, a successful build step, or a green unrelated command as complete verification. Name exactly what ran and what did not run.

Stop when the relevant checks passed, or when a failure/gap is clearly documented with the next fix or manual check.
