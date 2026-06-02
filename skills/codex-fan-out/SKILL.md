---
name: Codex Fan Out
description: Use single-model sub-agents for independent angles. Use for "in parallel", "multiple angles", "compare approaches", and broad analysis.
triggers:
  - in parallel
  - multiple angles
  - compare approaches
---

Use this skill when the task decomposes into independent reasoning passes that can be checked separately.

Prefer `multi_agent_run` when the branches do not need tools: for example planner plus reader, reviewer plus verifier, or multiple architecture comparisons over supplied context. Keep each sub-agent prompt narrow. Provide bounded context, explicit output format, and only the facts needed for that role.

Use the active chat model for every sub-agent. Do not use fan-out to create a visible multi-model conversation or to bypass tool approval. Sub-agents must not call tools; tool use stays in the main run after their outputs return.

Good role sets: `planner` for decomposition, `reader` for fact extraction, `verifier` for checking claims, `reviewer` for code risk, and `coworker` for a second implementation angle.

After fan-out, synthesize the results yourself. Name disagreements and choose one path.

Stop when the independent angles converge or when the disagreement identifies the next concrete read or verification step.
