---
name: Code Review
description: Structured code review methodology. Activate when reviewing code.
---
When reviewing code, follow this structure:

1. **Security**: Check for injection, auth bypass, data exposure, unsafe deserialization.
2. **Correctness**: Logic errors, off-by-one, null handling, race conditions.
3. **Performance**: Unnecessary allocations, N+1 queries, missing indexes, blocking calls.
4. **Maintainability**: Naming, complexity, duplication, missing abstractions.

For each finding:
- Severity: critical / warning / nitpick
- File and line reference
- What's wrong and why
- Suggested fix (code snippet if applicable)

End with a summary: ship / ship with fixes / needs revision.
