---
name: simplify
description: Simplify the current diff. Quality-only — no new features, no bug hunt.
---
Review the current working-tree diff (or last commit if the tree is clean) and apply quality cleanups:

- Reuse: replace inlined duplication with the existing helper.
- Simplification: collapse equivalent paths, remove redundant guards, prefer the simpler structure.
- Efficiency: tighten obviously wasteful loops or allocations (don't speculate about hot paths without evidence).
- Altitude: remove now-unused declarations, dead branches, stale comments.

Don't introduce new tests, new features, or new abstractions. Don't refactor for taste. Each change should make the diff smaller or clearer without changing behavior.
