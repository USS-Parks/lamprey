// ────────────────────────────────────────────────────────────────────────
// macOS sandbox-exec profile (S4).
//
// Wraps `(spawnCmd, spawnArgs)` in:
//
//   sandbox-exec -p '<SBPL profile>' -- <spawnCmd> <spawnArgs...>
//
// The SBPL profile is a base "deny-by-default with read-only filesystem,
// in-process operations, signal-self, ipc, mach-lookup" policy, plus:
//
//   • file-write* allowlist seeded with the workspace root, $TMPDIR, and
//     any explicit `opts.fsWritePaths` entries (deduplicated).
//   • network policy:
//       'open'                            → (allow network*)
//       'deny'                            → nothing (default-deny applies)
//       { allowDomains: [...] }           → (allow network*) plus a
//                                            documentation comment.
//
// LIMITATION: SBPL has no granular domain allowlist primitive. When the
// caller passes `{ allowDomains: [...] }` we behaviourally fall back to
// 'open' and emit an SBPL comment so the policy intent is preserved in
// the profile string. Granular allowlisting requires a userspace proxy
// (e.g. mitmproxy) and is out of scope for the kernel-level wrapper.
//
// Returns `null` when `sandbox-exec` is not on `PATH` so the dispatcher
// in ./index.ts can fall back to a pass-through with tier 'none'.
//
// This module is pure: no Electron imports, no global state. The
// `findSandboxExec` seam is module-private and resettable for tests.
// ────────────────────────────────────────────────────────────────────────

import { tmpdir } from 'os'
import { findOnPath } from '../shell-tool'
import type { NetworkPolicy, SandboxInput, SandboxOutput } from './index'

/** Test seam: how we locate `sandbox-exec`. Production path = findOnPath. */
let locator: (binary: string) => string | null = (binary) => findOnPath(binary)

/** @internal — for unit tests only. */
export function __setSandboxExecLocatorForTest(
  fn: ((binary: string) => string | null) | null
): void {
  locator = fn ?? ((binary) => findOnPath(binary))
}

/**
 * Pure SBPL profile-string builder. Exposed for unconditional unit tests
 * — does not consult the filesystem and never returns null.
 *
 * @param workspaceRoot Absolute path of the workspace, always writable.
 * @param fsWritePaths  Caller-provided extra writable subpaths.
 * @param networkPolicy Egress policy. See NetworkPolicy.
 * @param tmp           Resolved tmpdir (injected for deterministic tests).
 */
export function buildDarwinProfile(
  workspaceRoot: string,
  fsWritePaths: string[] = [],
  networkPolicy: NetworkPolicy = 'open',
  tmp: string = tmpdir()
): string {
  // Deduplicate writable paths in insertion order so the profile string
  // is stable across calls with overlapping input.
  const writableSeen = new Set<string>()
  const writable: string[] = []
  for (const p of [workspaceRoot, tmp, ...fsWritePaths]) {
    if (!p) continue
    if (writableSeen.has(p)) continue
    writableSeen.add(p)
    writable.push(p)
  }

  const lines: string[] = [
    '(version 1)',
    '(deny default)',
    '(allow process*)',
    '(allow file-read*)',
    '(allow signal (target self))',
    '(allow ipc*)',
    '(allow mach-lookup)'
  ]

  for (const path of writable) {
    lines.push(`(allow file-write* (subpath ${sbplString(path)}))`)
  }

  if (networkPolicy === 'open') {
    lines.push('(allow network*)')
  } else if (networkPolicy === 'deny') {
    // No allow rule — default-deny applies.
  } else if (networkPolicy && typeof networkPolicy === 'object' && 'allowDomains' in networkPolicy) {
    // SBPL has no granular domain allowlist primitive; behave as 'open'
    // and document the intended allowlist as a comment so the policy
    // string round-trips the caller's intent.
    lines.push('(allow network*)')
    const joined = networkPolicy.allowDomains.join(', ')
    lines.push(`;; allow-domains: ${joined}`)
  }

  return lines.join('\n')
}

/**
 * Quote a string as an SBPL string literal: wrap in double quotes,
 * escape embedded backslashes and double quotes.
 */
function sbplString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Dispatcher entry point. Returns the wrapped invocation, or `null` when
 * `sandbox-exec` is not available on this host (the index dispatcher
 * falls back to a pass-through in that case).
 */
export function applyDarwinProfile(input: SandboxInput): SandboxOutput | null {
  const sandboxExec = locator('sandbox-exec')
  if (!sandboxExec) return null

  const profile = buildDarwinProfile(
    input.opts.workspaceRoot,
    input.opts.fsWritePaths ?? [],
    input.opts.networkPolicy ?? 'open'
  )

  return {
    cmd: 'sandbox-exec',
    args: ['-p', profile, '--', input.spawnCmd, ...input.spawnArgs],
    sandboxTier: 'darwin-sbx'
  }
}
