---
name: verify
description: Verify the current change actually works by running it.
---
Verify the most recent change works end-to-end. Steps:

1. Identify what changed (`git diff` / staged changes / last commit).
2. Determine the right verification path for the change:
   - Renderer/UI change → start the preview server (`preview_start`), exercise the affected UI, capture screenshots.
   - Backend / service change → run the unit tests covering the surface, then exercise the change via the app (chat, IPC) if it's observable.
   - Build/tooling change → run the affected command and report its output.
3. Report what you observed. Don't claim success without evidence.

If the change can't be verified at this layer (e.g. Electron-shell-only and no preview reaches it), say so explicitly. Don't fabricate verification.
