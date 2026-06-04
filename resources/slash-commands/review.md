---
name: review
description: Review the current diff for bugs, smells, and simplification opportunities.
---
Review the current working tree's uncommitted changes (or the last commit if the tree is clean) along these axes:

1. Correctness — any bugs, race conditions, missing edge cases, or invalid assumptions.
2. Readability — naming, comment quality, function shape, complexity.
3. Reuse — duplicated logic that already lives elsewhere in the codebase.
4. Simplification — code paths that can collapse without losing intent.

Report findings as a numbered list, each with: file/line reference, severity (block / nit / praise), and a concrete suggested change. Don't restate the code — point at it.
