---
name: branch-ready
description: Audit whether the current branch is ready to ship (committed work, passing checks, no stash, no merge conflicts).
---

Use this slash command before opening a PR. The agent should:

1. Run `git status --short` and confirm a clean working tree.
2. Run `git log @{u}..HEAD --oneline` to list outstanding commits.
3. Run the project's verify commands (typecheck + tests) and report
   PASS / FAIL / SKIPPED for each.
4. Check `git stash list` for stashed work that might block.
5. Report a one-line verdict: SHIP, CHANGES, or BLOCKED.
