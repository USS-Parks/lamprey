---
name: git-status-recap
description: When the user asks "where am I" or "what's outstanding", recap git state — branch, uncommitted changes, divergence from upstream, and any stashes — using shell_command (git status --short, git log, git stash list).
autoInvoke: true
allowedTools:
  - shell_command
---

When invoked, run these checks in order and report a concise recap:

1. `git status --short --branch` — current branch + dirty files
2. `git log @{u}.. --oneline` — local commits not on upstream
3. `git log ..@{u} --oneline` — upstream commits not on local
4. `git stash list` — any stashed work the user may have forgotten

Format the recap as a short bulleted summary. If everything is clean and
in sync, say so in one line.
