// ────────────────────────────────────────────────────────────────────────
// S5 — Linux bubblewrap profile.
//
// Wraps `(spawnCmd, spawnArgs)` in a `bwrap` invocation that:
//   - read-only-binds /usr, /bin, /etc (and /lib, /lib64 when they exist)
//   - read-write binds the workspace root, the system tmpdir, and any
//     extra `fsWritePaths` the caller asks for
//   - exposes /proc and /dev
//   - sets the working directory
//   - optionally unshares the network namespace (`networkPolicy: 'deny'`)
//
// `networkPolicy: { allowDomains: [...] }` is not enforceable with
// bubblewrap (no domain-level filtering). We leave the network open and
// surface the limitation via the `note` field on SandboxOutput so the
// caller / model can react.
//
// When `bwrap` is not on PATH the function returns `null` and the
// dispatcher in ./index.ts falls back to a pass-through invocation with
// tier 'none'. The pass-through note already mentions "bwrap missing?".
//
// Pure module: no Electron imports, no global state. The arg builder is
// exported separately so it can be unit-tested without touching the
// filesystem.
// ────────────────────────────────────────────────────────────────────────

import { existsSync } from 'fs'
import { tmpdir as osTmpdir } from 'os'

import { findOnPath } from '../shell-tool'
import type { SandboxInput, SandboxOutput } from './index'

/** Returns true when a host path exists. Injected for tests. */
export type PathExists = (p: string) => boolean

/** Locates `bwrap` on PATH (or returns null). Injected for tests. */
export type BwrapLocator = () => string | null

/**
 * Pure arg builder. Takes everything that varies and returns the bwrap
 * argv plus a `note` when the policy can't be fully honoured. No I/O
 * beyond the injected `pathExists` callback.
 */
export function buildBwrapArgs(
  input: SandboxInput,
  pathExists: PathExists = existsSync,
  tmpdir: string = osTmpdir()
): { args: string[]; note?: string } {
  const args: string[] = []

  // Read-only system mounts. /usr, /bin, /etc are universally present;
  // /lib and /lib64 are skipped when absent (e.g. Alpine omits /lib64).
  args.push('--ro-bind', '/usr', '/usr')
  args.push('--ro-bind', '/bin', '/bin')
  if (pathExists('/lib')) args.push('--ro-bind', '/lib', '/lib')
  if (pathExists('/lib64')) args.push('--ro-bind', '/lib64', '/lib64')
  args.push('--ro-bind', '/etc', '/etc')

  // Read-write mounts: workspace + tmpdir + caller-requested paths.
  args.push('--bind', input.opts.workspaceRoot, input.opts.workspaceRoot)
  args.push('--bind', tmpdir, tmpdir)
  for (const p of input.opts.fsWritePaths ?? []) {
    args.push('--bind', p, p)
  }

  // Kernel surfaces + working directory.
  args.push('--proc', '/proc')
  args.push('--dev', '/dev')
  args.push('--chdir', input.cwd)

  // Network policy.
  let note: string | undefined
  const policy = input.opts.networkPolicy ?? 'open'
  if (policy === 'deny') {
    args.push('--unshare-net')
  } else if (typeof policy === 'object' && Array.isArray(policy.allowDomains)) {
    // bwrap cannot filter by domain — leave the network open and flag it.
    note = 'allowDomains not enforced — bwrap has no domain filtering; network left open'
  }
  // 'open' → no flag.

  // Separator + the original command.
  args.push('--', input.spawnCmd, ...input.spawnArgs)

  return { args, note }
}

/**
 * Wrap `(input.spawnCmd, input.spawnArgs)` in a bwrap invocation. Returns
 * null when bwrap is not on PATH so the dispatcher falls back to
 * pass-through.
 */
export function applyLinuxProfile(
  input: SandboxInput,
  locateBwrap: BwrapLocator = () => findOnPath('bwrap'),
  pathExists: PathExists = existsSync,
  tmpdir: string = osTmpdir()
): SandboxOutput | null {
  if (!locateBwrap()) return null

  const { args, note } = buildBwrapArgs(input, pathExists, tmpdir)

  return {
    cmd: 'bwrap',
    args,
    sandboxTier: 'linux-bwrap',
    ...(note ? { note } : {})
  }
}
