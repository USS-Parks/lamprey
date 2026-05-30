# Lamprey Skills

Skills are `.md` files with YAML frontmatter that get injected into the system prompt.

## File Format

```markdown
---
name: Display Name
description: One sentence. When to activate this skill.
---
Everything below frontmatter is injected verbatim into the system prompt.
```

## How It Works

1. Drop a `.md` file into this directory
2. It appears in the Skills panel immediately (hot reload, no restart)
3. Toggle it on/off in the sidebar
4. Active skills are injected as `<skill name="...">` blocks in the system prompt

## Tips

- Keep skills focused on one behavior
- Description helps you remember when to activate each skill
- Content over 4000 characters may reduce available context for conversation
