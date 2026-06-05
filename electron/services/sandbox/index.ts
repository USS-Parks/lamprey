// ────────────────────────────────────────────────────────────────────────
// S3 — Sandbox profile abstraction layer
//
// `applyProfile()` is the single entry point the shell executor calls to
// wrap a spawn `(cmd, args)` pair with OS-level isolation. The function
// dispatches to a per-platform module:
//
//   darwin → sandbox-exec wrapper (S4 — ./darwin.ts)
//   linux  → bubblewrap wrapper   (S5 — ./linux.ts)
//   win32  → pass-through, tier   (S6 — ./win32.ts)
//
// When a platform module returns `null` (e.g. bwrap missing) or is not
// implemented, the entry point falls back to a pass-through with
// `sandboxTier: 'none'` so the caller still gets a usable invocation —
// the weaker tier is surfaced in the result so the renderer / model can
// react to it.
//
// This module is pure (no Electron imports, no I/O beyond what the
// platform helpers do). The shell executor stays unit-testable.
// ────────────────────────────────────────────────────────────────────────

import { applyDarwinProfile } from './darwin'
import { applyLinuxProfile } from './linux'
import { applyWindowsProfile } from './win32'

export type SandboxTier = 'darwin-sbx' | 'linux-bwrap' | 'none' | 'bypassed'

export type NetworkPolicy = 'open' | 'deny' | { allowDomains: string[] }

export interface SandboxOptions {
  /** Workspace root the shell call is rooted in. Always included in fsWritePaths. */
  workspaceRoot: string
  /** Additional writable paths. The system tmpdir is added automatically. */
  fsWritePaths?: string[]
  /** Network egress policy. Default `'open'`. */
  networkPolicy?: NetworkPolicy
}

export interface SandboxInput {
  spawnCmd: string
  spawnArgs: string[]
  cwd: string
  opts: SandboxOptions
  /** Override for tests — defaults to `process.platform`. */
  platform?: NodeJS.Platform
}

export interface SandboxOutput {
  cmd: string
  args: string[]
  sandboxTier: SandboxTier
  /** Optional human-readable note about *why* the tier is what it is.
   *  Surface to the model when tier !== 'darwin-sbx' / 'linux-bwrap'. */
  note?: string
}

/** Pass-through used when no platform impl applies or one returns `null`. */
function passThrough(input: SandboxInput, note?: string): SandboxOutput {
  return {
    cmd: input.spawnCmd,
    args: input.spawnArgs,
    sandboxTier: 'none',
    note
  }
}

/**
 * Resolve the right platform module and return a wrapped invocation.
 * Returns a pass-through with `tier: 'none'` when no kernel-level
 * isolation is available on this host.
 */
export function applyProfile(input: SandboxInput): SandboxOutput {
  const platform = input.platform ?? process.platform

  if (platform === 'darwin') {
    return applyDarwinProfile(input) ?? passThrough(input, 'darwin profile unavailable')
  }
  if (platform === 'linux') {
    return applyLinuxProfile(input) ?? passThrough(input, 'linux profile unavailable (bwrap missing?)')
  }
  if (platform === 'win32') {
    return applyWindowsProfile(input) ?? passThrough(input, 'windows host: no kernel sandbox')
  }

  // Unknown platform (e.g. freebsd). Pass through, surface the tier.
  return passThrough(input, `no sandbox profile for platform "${platform}"`)
}
