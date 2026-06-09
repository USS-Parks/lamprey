# HY_SMOKE_PLAYBOOK.md — Hygiene Phase live cogency pass

**Purpose:** The HY tests prove byte savings + mechanical correctness. This playbook proves the
part tests can't: that **DeepSeek V4 Pro/Flash actually drive the lazy tool-surface round-trip
fluently** — discover a tool via `tool_search`, unlock it, and call it — without thrashing or
stalling. Run it live after Bucketing v0.11.0. Judge by ear; mismatches are themselves findings.

**Setup:** Open Lamprey v0.11.0, default settings (`toolSurface: 'lazy'`, `proofGate: 'rigor'`,
`agentMode: 'auto'`). Use **V4 Pro** for asks 1–6, then repeat asks 1–2 on **V4 Flash** for ask 7.
Open Settings → (no UI yet for these — they're defaulted on). Watch the tool-call cards in the
transcript. Paste each prompt verbatim.

---

## Ask 1 — Core tool, no search needed (expect: NO tool_search)

> **Paste:** `Read package.json and tell me the version and the build script.`

**What to watch:** `shell_command` (or workspace read) fires immediately.

- [ ] The model uses a **core** tool directly — **no `tool_search` call** (read tools are core)
- [ ] Answers with the version + build script in one short reply
- [ ] Does **not** call `tool_search` for something already in the core set

**Failure mode:** if it `tool_search`es for "read a file" first, the core set is too small or the
`tool_search` description is over-eager — note it; consider promoting the tool to CORE.

## Ask 2 — Non-core tool, must search→unlock→call (the core round-trip)

> **Paste:** `Generate an image of a green lamprey logo on a dark background.`

**What to watch:** a `tool_search` card, then an `image_generate` card on a **later** round.

- [ ] The model calls **`tool_search`** with a query like "generate an image"
- [ ] The tool_search result lists `image_generate` (and unlocks it)
- [ ] On the **next** turn the model calls `image_generate` **natively** (real tool card, valid args)
- [ ] It does **not** hallucinate calling `image_generate` *before* searching, and does **not**
      give up saying "I don't have an image tool"

**Failure mode:** model never searches and claims no image capability → the `tool_search`
description isn't selling the unlock clearly. Model searches but then re-searches the same thing
in a loop → the unlock isn't surviving into the next round (regression in `rebuildToolsForNextRound`).

## Ask 3 — Two capabilities in one turn (multi-unlock)

> **Paste:** `Take a screenshot of https://example.com and then summarize what's on the page.`

- [ ] One or two `tool_search` calls unlock the browser tools (`browser_open` / `browser_screenshot`)
- [ ] The model then calls them in sequence without re-searching for each
- [ ] No "I can't browse" refusal before searching

**Failure mode:** a `tool_search` per micro-step (search → call → search → call) instead of one
search that unlocks the cluster — note whether the result surfaces sibling tools.

## Ask 4 — Tool-result spill + read-back (HY3)

> **Paste:** `Run: git log --oneline -200, then tell me how many commits mention "HY".`

**What to watch:** the `shell_command` result is large; the model's view is elided.

- [ ] The reply is correct (counts HY commits) even though the raw result was spilled
- [ ] If the model needed the middle of the log, you see a **`read_tool_result`** card paging it back
- [ ] The transcript still shows the **full** `git log` output in the tool card (UI keeps full; only
      the model's copy was elided)

**Failure mode:** model answers from only the head/tail and gets the count wrong without ever
calling `read_tool_result` → the preview marker isn't legible enough, or the threshold is too low.

## Ask 5 — Lazy skill body + skill_open (HY4)

> **Setup:** enable one skill (e.g. deep-research) for the conversation. **Paste:**
> `Use the deep-research skill to outline how you'd research DeepSeek V4 pricing.`

- [ ] The system prompt only carried the skill **stub** (you won't see this, but…)
- [ ] The model calls **`skill_open("deep-research")`** to load the full instructions before using it
- [ ] It then follows the skill body

**Failure mode:** model improvises the skill without calling `skill_open` (ignored the stub hint),
or calls `skill_open` with a wrong name → tighten the stub wording.

## Ask 6 — Rigor gating: clean casual turn vs. proof on demand (HY5)

> **Paste A (casual):** `Add a one-line comment above the export in src/lib/types.ts.`
> **Paste B (rigor):** `Apply that change and verify the build still passes.`

- [ ] **A** edits the file and replies **with no `**Untrusted**`/proof-gate notice** appended
- [ ] **B** (contains "verify") runs the proof flow — you see the change-contract / proof behavior
      and any verification footer
- [ ] The casual reply reads clean and short; the rigor reply carries the receipts

**Failure mode:** proof boilerplate appears on the casual turn (rigor regex too broad) or never
appears on the rigor turn (too narrow) — note which verb leaked/missed.

## Ask 7 — Flash fallback (repeat asks 1–2 on V4 Flash)

> Switch the model to **DeepSeek V4 Flash** and re-run **Ask 1** and **Ask 2**.

- [ ] Flash handles Ask 1 (core, no search) cleanly
- [ ] Flash drives the Ask 2 round-trip (search → unlock → call) **or** — if it emits malformed
      `tool_search` calls 3× — the conversation **auto-downgrades to the full catalog** and the
      image still generates (no dead end)
- [ ] You never see Flash stuck in a `tool_search` loop with no progress

**Failure mode:** Flash loops on malformed `tool_search` without the downgrade kicking in → check
`MALFORMED_SEARCH_DOWNGRADE_THRESHOLD` and that empty-query calls are being counted. If Flash
struggles broadly, the pragmatic answer is to default Flash conversations to `toolSurface: 'full'`.

---

## Scoring
- **Asks 1–3 are the core verdict.** If V4 Pro discovers→unlocks→calls without thrashing, the
  central Hygiene bet holds. If it refuses or loops, the `tool_search` description and core-set
  composition are the levers — not the mechanism.
- **Ask 7 is the safety verdict.** The lazy surface must degrade gracefully on a weaker model.
- Record anything that felt slow, looped, or opaque (e.g. a `tool_search` with no UI card) — those
  are the follow-ups already noted in `HY_AFTER.md`.
