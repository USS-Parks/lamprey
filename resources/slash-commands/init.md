---
name: init
description: Bootstrap a CLAUDE.md / AGENTS.md for this project.
---
Scan the current working directory and produce a draft `CLAUDE.md` (or `AGENTS.md` if one is more conventional in this codebase) that captures:

- What this project is and what stack it uses (read `package.json`, `pyproject.toml`, `Cargo.toml`, etc.).
- The build, test, and dev-server commands a contributor needs.
- Any non-obvious conventions (formatting rules, commit-message style, branch naming) you can infer from the code or the existing `README.md`.
- Key files and directories worth a new contributor's first look.

Keep the file under 200 lines. Do not invent features that aren't in the code.
