// ────────────────────────────────────────────────────────────────────────
// Windows fallback profile (S6).
//
// Windows has no kernel-level sandbox equivalent to macOS sandbox-exec or
// Linux bubblewrap. AppContainer / Job Objects can do parts of this but
// are too restrictive for a general-purpose shell call (no PowerShell
// scripts of any real complexity will survive them). For now, the
// Windows path is an honest pass-through with an explicit tier of
// `'none'` and a note both the model and the renderer can react to.
//
// Returning a SandboxOutput here (rather than null) is intentional: it
// guarantees the result body carries `sandboxTier: 'none'` plus the note
// even if the dispatcher's pass-through code path changes in the future.
//
// Pure module — no Electron imports.
// ────────────────────────────────────────────────────────────────────────

import type { SandboxInput, SandboxOutput } from './index'

const WIN_NOTE =
  'Sandbox: none (windows host) — no kernel-level isolation available on this platform. Permission policies should re-prompt for network-tier calls.'

export function applyWindowsProfile(input: SandboxInput): SandboxOutput | null {
  return {
    cmd: input.spawnCmd,
    args: input.spawnArgs,
    sandboxTier: 'none',
    note: WIN_NOTE
  }
}
