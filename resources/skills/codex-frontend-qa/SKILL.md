---
name: Codex Frontend QA
description: Exercise local UI changes in the in-app browser. Use for "test the UI", "check the page", "screenshot this", and layout QA.
triggers:
  - test the UI
  - check the page
  - screenshot this
---

Use this skill when a change affects visible UI, page behavior, or browser interaction.

Ask for or use the exact local URL. Do not guess that a dev server exists. If the user gives a URL, call `frontend_qa` with that URL and any expected text, selectors, or interaction notes from the request. Use `browser_open` and `browser_screenshot` only for targeted follow-up when the composed QA report needs another view.

Inspect for blank pages, console-visible crashes when surfaced by the tool, missing expected text, broken selectors, overlapping controls, unreadable text, layout clipping, and obvious mobile/desktop framing issues. For visual work, prefer evidence from the screenshot over assumptions from code.

Report `PASS`, `FAIL`, or `NEEDS-REVIEW`. Include the screenshot path when one was captured, and distinguish automated assertions from manual visual judgment.

Stop when the page has been observed at the requested URL or when the missing URL/server is the only blocker.
