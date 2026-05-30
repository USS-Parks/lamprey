# Skills

A **skill** is a markdown file that injects extra instructions into Lamprey's system prompt. Skills are toggled per-conversation from the sidebar — turn one on and every message until you turn it off carries those instructions.

The whole system is hot-reloaded. Drop a `.md` into the skills directory and it shows up in the sidebar within ~150 ms.

---

## File format

```markdown
---
name: Display Name
description: One sentence. Shown as the hover tooltip.
---
Everything below the frontmatter is injected verbatim into the system prompt
whenever this skill is active.
```

- `name` (string, required) — what appears in the sidebar.
- `description` (string, required) — hover-tooltip text. Keep it short.
- `content` (everything after the frontmatter) — appended to the system prompt inside a `<skill name="...">...</skill>` tag.

Filename → slug. `Direct Voice` → `direct-voice.md`. The GUI editor (sidebar `+` button) handles slugging + collision suffixes (`-2`, `-3`, ...) automatically.

---

## Skills directory

| Mode | Path |
|---|---|
| Dev (`npm run dev`) | `<repo>/skills/` |
| Production install | `<userData>/skills/` |

On a fresh production launch Lamprey copies the bundled defaults from the installed app's resources into `userData/skills/` so users have something to toggle right away.

`userData` resolves to:

- Windows: `%APPDATA%\Lamprey\skills`
- macOS: `~/Library/Application Support/Lamprey/skills`
- Linux: `~/.config/Lamprey/skills`

---

## System prompt assembly order

When a chat request fires, the system prompt is built in this exact order:

1. **Base persona** — `You are Lamprey, a helpful AI assistant. Be direct and precise.`
   (Replaced by the model's per-config `systemPromptOverride` when set, see Settings → Models.)
2. **Memory block** — every row from `memory_entries`, numbered, wrapped in `<memory>...</memory>`.
3. **Active skills** — each enabled skill appended as `<skill name="$NAME">\n$CONTENT\n</skill>`, in alphabetical order by name.

Skills run after memory but inside the same single system message. They don't reset history — they only influence the next response.

---

## Best practices

- **Be declarative.** Tell the model what to do, not what not to do. "Format every response as a bulleted list." beats "Don't write paragraphs."
- **One concern per skill.** A skill about voice shouldn't also dictate formatting. Combine via the sidebar toggle instead.
- **Watch the char count.** The editor warns at 4000 characters because long skills displace conversation history within the 64K context window.
- **Use `<skill>` tags in your prompt.** When you need to reference a specific behavior, mention the skill by name — the model can read its own system prompt.
- **Test in isolation.** Toggle one skill on, send the same message you'd send without it, compare. If you can't tell which response was better, the skill is too vague.

---

## Bundled skills

### `direct-voice.md`

```markdown
---
name: Direct Voice
description: Forces declarative, concise communication style. No hedging or filler.
---
Communication rules:
- State conclusions directly. No "I think" or "it seems like."
- Lead with the answer, then explain if needed.
- No preamble. No summarizing what you're about to do.
- If uncertain, say what you don't know and why, then give your best assessment.
- Prefer short sentences. One idea per sentence.
- Never apologize for being direct.
```

> Why it works: the bullet form gives the model a tight checklist of behaviors to enforce on every token. "Never apologize for being direct" is load-bearing — without it the model fights its trained politeness.

### `code-review.md`

```markdown
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
```

> Why it works: it gives the model a four-bucket scaffold so findings land in a consistent shape. The "severity / file:line / what / fix" template makes the output diff-friendly.

### `git-commit.md`

```markdown
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
```

> Why it works: it pins the format with an explicit example so the model can't drift into bare prose, and it explicitly calls out "explain WHY not WHAT" which is where most generated commit bodies fail.

---

## Community examples

### `pdf-summarize.md`

```markdown
---
name: PDF Summary
description: Distills attached PDFs into structured one-paragraph summaries with action items.
---
When a PDF is attached, produce:

1. **Bottom line** — one sentence. The single most important fact.
2. **Context** — two to four sentences. What it is, who it's for, what claim it makes.
3. **Action items** — bulleted list of concrete next steps for the reader (or "none" if it's reference material).
4. **Quotes** — at most three short verbatim excerpts that justify the bottom line. Include page numbers if visible in the text.

Skip cover art, footers, marketing language, and repeated boilerplate. Don't editorialize about the document quality unless the user asks.
```

### `bug-repro.md`

```markdown
---
name: Bug Repro
description: When the user reports a bug, produce a minimum-reproducible-example before proposing a fix.
---
Before attempting any fix:

1. Restate the bug in one sentence.
2. List the exact preconditions to reproduce — environment, version, inputs, prior state.
3. Walk through the steps to reproduce as a numbered list.
4. State the observed behavior and the expected behavior, separately.
5. Identify the minimum-reproducible-example — strip everything not load-bearing. Inline code, no external dependencies if possible.

Only after the MRE is on the page may you propose a fix. If you can't construct an MRE from the information given, ask one specific question to close the gap.
```

> These two illustrate the pattern: explicit numbered steps + concrete output shape. The model treats them as a contract for the next response.
