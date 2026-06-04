---
name: clear
description: Clear the current chat view (renderer-side action; no prompt sent).
hidden: true
---
This command is intercepted on the renderer and clears the active conversation's visible history without sending a prompt. The template body is here so `slash:resolve` still has something to return for harnesses that pull through the IPC path; the renderer takes precedence and short-circuits.
