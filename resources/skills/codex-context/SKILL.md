---
name: Codex Context
description: Gather repository context before answering or editing. Use for "what is this repo", "orient me", "preflight", and unfamiliar codebases.
triggers:
  - what is this repo
  - orient me
  - preflight
---

Use this skill when the user needs orientation, or when you are about to work in an unfamiliar part of the repository.

Start with `workspace_context`. Treat its output as the map: active root, branch state, changed files, package scripts, detected frameworks, instruction files, and likely verification commands. Then read the highest-signal instruction files it lists, usually `AGENTS.md`, `CLAUDE.md`, `README.md`, or local package docs.

Before proposing edits, search for nearby symbols and call sites. Prefer existing patterns over new abstractions. If the working tree is dirty, distinguish user changes from changes you intend to make and avoid overwriting them.

When reporting back, summarize what the repo does, the relevant modules, the current git state, and the safest next action. Keep the answer grounded in files you actually inspected.

Stop when you can name the active area, the conventions in play, and the verification command you would run after changes.
