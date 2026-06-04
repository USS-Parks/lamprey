---
name: spawn-task
description: Fork an out-of-scope follow-up into its own session/worktree.
args:
  - title
  - description
---
Spawn a separate task so the current conversation stays focused.

Title: {{title}}
Description: {{description}}

Use the `spawn_task` tool when it lands (Track 2 / Prompt E4). Until then, surface the title + description in the chat so the user can decide whether to open a new session manually.
