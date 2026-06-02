---
name: Codex Plan
description: Plan coding work before editing. Use for "make a plan for", "plan this", "decompose", and similar requests.
triggers:
  - make a plan for
  - plan this
  - decompose
---

Use this skill when the user wants a plan, decomposition, or implementation outline before code changes.

First call `workspace_context` to establish the active root, git state, package scripts, frameworks, instruction files, and likely verification commands. Read any listed instruction files that are relevant to the request before finalizing the plan.

Create or update the visible checklist with `update_plan`. Keep exactly one step `in_progress` at a time. Steps should be concrete actions, not vague phases: name the files or areas involved when known, and include the verification step as its own item.

Do not edit files unless the user explicitly asks you to proceed. If the plan depends on an unknown decision, state the assumption and keep moving when the risk is low; ask one focused question only when a wrong assumption would waste work or endanger user data.

Stop when the plan is actionable, ordered, and short enough for the user to approve or amend.
