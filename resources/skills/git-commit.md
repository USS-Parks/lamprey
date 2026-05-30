---
name: Git Commit
description: Generates conventional commit messages from diffs.
---
When asked to write a commit message:

1. Analyze the diff to understand what changed and why.
2. Use conventional commit format: type(scope): description
3. Types: feat, fix, refactor, docs, test, chore, perf, style, ci
4. Scope: the module or area affected (optional)
5. Description: imperative mood, lowercase, no period, under 72 chars
6. Body (if needed): blank line after subject, wrap at 72 chars, explain WHY not WHAT

Example:
feat(auth): add refresh token rotation

Rotate refresh tokens on each use to limit the window of
token theft. Old tokens are invalidated immediately.
