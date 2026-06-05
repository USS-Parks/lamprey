# Writing a custom Snip filter

Lamprey Snip is a YAML-driven layer that compresses verbose shell output before the model sees it. Lamprey ships ~120 built-in filters; this primer shows you how to write a custom one for a tool the built-in set doesn't cover.

## TL;DR

1. Settings → Snip → "Open user filter dir" to open `userData/snip/filters/`.
2. Drop a `.yaml` file (any name) under that directory, optionally inside a subfolder.
3. Lamprey detects the new file in ~1 second (chokidar) and starts using it.
4. Run the matching shell command in a chat. The Snip dashboard shows the event.

User filters override built-in filters of the same `name`.

## Filter anatomy

A filter is one YAML document with four sections:

```yaml
name: my-filter                    # stable id (no spaces, lower-kebab-case)
description: One-line summary      # shown in the dashboard library

match:
  command: my-tool                 # required, first token of the shell command
  subcommand: build                # optional, second token
  viaNpx: true                     # optional, also match `npx my-tool` etc.
  excludeFlags: ['--verbose']      # optional, skip the filter if any flag present
  exitCodes: [0]                   # optional, default [0] — run only on success

pipeline:
  - action: strip_ansi
  - action: head
    n: 30
  - action: on_empty
    message: 'my-tool: ok'

stderrPipeline:                    # optional — defaults to pass-through
  - action: strip_ansi

onError: passthrough               # optional — defaults to passthrough
```

## The 11 pipeline actions

Each step transforms the previous step's output. Actions don't throw; an unknown or broken action passes through.

| Action | Required fields | What it does |
|---|---|---|
| `strip_ansi` | — | Removes CSI escape sequences (colour codes). |
| `keep_lines` | `pattern` | Retains only lines matching the regex. |
| `remove_lines` | `pattern` | Drops lines matching the regex. |
| `truncate_lines` | `max` | Caps each line at `max` characters, appending `…`. |
| `head` | `n` | Keeps the first N lines. |
| `tail` | `n` | Keeps the last N lines. |
| `dedup` | — | Removes duplicate lines preserving first occurrence. |
| `replace` | `pattern`, `replacement` | Regex find/replace, global by default (`flags` overrides). |
| `aggregate` | `counters[]`, `totalAs?` | Non-destructive: counts matches per pattern into named counters that a later `format_template` can read. |
| `format_template` | `template` | Substitutes `{{.lines}}`, `{{.count}}`, `{{.bytes}}`, `{{counter:NAME}}` into a template string. |
| `match_output` | `pattern`, `message` | If the regex matches anywhere, returns `message` as the sole body. |
| `on_empty` | `message` | Returns `message` when the previous step produced whitespace-only output. |

### Pattern gotchas

- Patterns are **JavaScript regexes** under the hood. Use `\\d`, `\\s` etc. inside YAML strings (the YAML parser eats one backslash, the regex engine sees the second).
- `match_output` substitutes its message but **does not halt the pipeline** — the next step runs on the substituted text. If you want a short-circuit, follow `match_output` with a `keep_lines` that also matches the message.
- Regex anchors `^` and `$` match string boundaries by default. Pass `flags: m` to make them per-line.

## Example: a custom filter for `myapp deploy`

```yaml
name: myapp-deploy
description: Collapse myapp deploy spam to status + duration
match:
  command: myapp
  subcommand: deploy
pipeline:
  - action: strip_ansi
  - action: remove_lines
    pattern: '^(Uploading|Verifying|Connecting)'
  - action: keep_lines
    pattern: '(success|failed|deployed in|version|error)'
  - action: head
    n: 30
  - action: on_empty
    message: 'myapp deploy: complete'
```

## Test your filter offline

Before dropping a filter into Lamprey, you can run it through a quick check:

1. Paste a sample raw shell output into a temp file (`/tmp/sample.txt`).
2. Open Settings → Snip → toggle Verbose mode on.
3. Run your command in a chat once. The dashboard's "Recent activity" shows the filter name + savings.
4. Inspect the model-facing tool result card to confirm the compressed body looks right.

## Override a built-in

To customize a built-in filter (say, `git-log`), copy `userData/snip/filters/built-in/git/git-log.yaml` to `userData/snip/filters/git-log.yaml` (drop the `built-in/git/` prefix), edit, and save. Lamprey loads user files before built-ins, so your override wins. The dashboard's filter library will flag the original as "overridden by user file."

## Reset

To disable the whole layer: Settings → Snip → toggle Enabled off. To skip for one command only, the model can pass `bypass_snip: true` in the `shell_command` tool args (it's documented in the descriptor schema, so the model discovers it).

To wipe the gain history: Settings → Snip → Reset history (two-click confirm).

## Reference

- Full filter schema validator: [`electron/services/snip/filter-schema.ts`](../electron/services/snip/filter-schema.ts)
- Pipeline engine: [`electron/services/snip/engine.ts`](../electron/services/snip/engine.ts)
- Built-in filter set: [`resources/snip-filters/`](../resources/snip-filters/)
- Phase plan: [`PLANNING/LAMPREY_SNIP_PLAN.md`](../PLANNING/LAMPREY_SNIP_PLAN.md)
