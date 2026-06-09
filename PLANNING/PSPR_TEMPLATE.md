# LAMPREY_<PHASE_NAME>_PLAN.md — <Phase Name> Phase (<X1>–<Xn>)

> **P-SPR template.** Copy this file to `PLANNING/LAMPREY_<PHASE_NAME>_PLAN.md`, fill every
> `<…>` placeholder, delete this blockquote, then present it for review. It is not a
> P-SPR until it is saved as that named file with a filled §0. It is not authorized to
> run STS until the user explicitly approves it (the "Approval state" line below is filled
> in by the user's go-ahead, **not** by any "STS authorization" wording inside the plan).

---

## §0 — Governance

### Goal (one sentence)
<What this phase delivers and why. If it can't fit in one sentence, the scope is too big — split it.>

### Scope (what this phase touches)
- `<path/to/file_or_dir>` — <what changes>
- `<path/to/file_or_dir>` — <what changes>
- `DEVLOG.md`, `README.md`, `package.json` version bump (phase-wrap prompt only)

### Non-goals (explicitly out of scope)
- <Adjacent thing this phase deliberately does NOT touch — name it so scope can't creep.>
- <Subsystem whose current shape must be preserved byte-for-byte, if any.>

### Verify gate (every prompt must pass before commit)
1. `npx tsc --noEmit -p tsconfig.node.json` — clean
2. `npx tsc --noEmit -p tsconfig.web.json` — clean
3. `npx vitest run <the_test_files_this_prompt_touches>` — clean
4. Any prompt that touches `electron/ipc/chat.ts` also runs `npm run verify:proof -- --no-tests` — exits 0
5. Final phase gate (`<Xn>`): full `npx vitest run` + `npm run build` + `npm run verify:proof`

### Commit discipline
- One commit per prompt, present-tense imperative subject (`feat(<area>): <X2> …`)
- DEVLOG entry per prompt under a new `## <YYYY-MM-DD> — <Phase Name> Phase` section
- No squashing across prompts; no co-author trailer
- No push until the wrap prompt unless the user explicitly says push earlier

### Worktree / branch
- Branch: `<branch-name>` (separate git worktree if this runs parallel to another track)

### Completion criteria
- All `<X1>`–`<Xn>` prompts `[x]`, final gate green, DEVLOG phase-complete entry written,
  CLAUDE.md "Current State" updated, version bumped.

### Approval state
- **PENDING** — awaiting explicit user green light + STS instruction.
  <On approval, replace with: **APPROVED <date>** by user with answers (1)… (2)… + STS.>

---

## §1 — Prompt Roster

### **<X1> — <short imperative title>**
- [ ] <Concrete deliverable, the files it touches, and the one observable outcome that proves it landed.>
- Verify: <the specific gate subset for this prompt>

### **<X2> — <short imperative title>**
- [ ] <…>
- Verify: <…>

### **<X3> — <short imperative title>**
- [ ] <…>
- Verify: <…>

<!-- …continue the roster. Keep each prompt small enough to commit independently. -->

### **<Xn> — Phase wrap**
- [ ] Full gate green (vitest + build + verify:proof), DEVLOG phase-complete entry,
      CLAUDE.md Current State + reference-only list updated, `package.json` version bump.
- Verify: final phase gate (§0 item 5)
