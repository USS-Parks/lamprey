---
name: plan
description: Enter plan mode and lay out an approach before touching anything.
---
Enter plan mode for this conversation (call `enter_plan_mode`). Then:

1. Read enough of the codebase to ground your plan — files, types, surrounding callers.
2. State the goal in one sentence.
3. List the concrete steps you will take, in order, with file paths.
4. Call out risks, open questions, or decisions that need user input.

Do not run any mutating tools until I tell you to exit plan mode. Read-only tools (workspace_context, grep, view files) are fine.
