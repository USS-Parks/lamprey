import { app } from 'electron'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

// SEC: pushing to GitHub from Lamprey must never put the token in process
// args (visible via `ps`/Task Manager) or in `.git/config`. The chosen
// mechanism is `GIT_ASKPASS`: git invokes the helper twice per push when no
// credential helper is configured — once asking for "Username", once for
// "Password" — and reads the response from stdout. The helper reads the
// token from an env var we set on the spawn, so:
//   - args:  ["push", "https://github.com/owner/repo.git", "refs/..."]  (no secret)
//   - env:   { GIT_ASKPASS: <helper>, LAMPREY_GH_TOKEN: <token>, GIT_TERMINAL_PROMPT: '0' }
//   - stdout from helper: "x-access-token" / "<token>"
// The helper script itself contains no secret.
//
// Cross-platform: on Windows we materialise a .cmd file, elsewhere a .sh.
// Both pull the token from $LAMPREY_GH_TOKEN at invocation time.

const ENV_TOKEN_NAME = 'LAMPREY_GH_TOKEN'

let cachedHelperPath: string | null = null

function helperDir(): string {
  return join(app.getPath('userData'), 'github')
}

function helperFilename(): string {
  return process.platform === 'win32' ? 'askpass.cmd' : 'askpass.sh'
}

function helperBody(): string {
  if (process.platform === 'win32') {
    return [
      '@echo off',
      'setlocal',
      'rem Lamprey GIT_ASKPASS helper — token is read from %' + ENV_TOKEN_NAME + '%.',
      'echo %1 | findstr /I "Username" >nul',
      'if %ERRORLEVEL%==0 (',
      '  echo x-access-token',
      ') else (',
      '  echo %' + ENV_TOKEN_NAME + '%',
      ')',
      ''
    ].join('\r\n')
  }
  // POSIX shell. Prompt arrives as $1; GitHub accepts any username when
  // the password is a token, so we hand back a fixed sentinel + the token.
  return [
    '#!/bin/sh',
    '# Lamprey GIT_ASKPASS helper — token is read from $' + ENV_TOKEN_NAME + '.',
    'case "$1" in',
    '  *Username*|*username*)',
    '    printf %s\\\\n "x-access-token"',
    '    ;;',
    '  *)',
    '    printf %s\\\\n "$' + ENV_TOKEN_NAME + '"',
    '    ;;',
    'esac',
    ''
  ].join('\n')
}

/**
 * Ensure the askpass helper is materialised on disk and return its absolute
 * path. The file is owned by the userData directory, mode 0o700 (POSIX —
 * Windows ACLs handle the equivalent at the directory level).
 */
export function ensureAskpassHelper(): string {
  if (cachedHelperPath && existsSync(cachedHelperPath)) return cachedHelperPath
  const dir = helperDir()
  mkdirSync(dir, { recursive: true })
  const path = join(dir, helperFilename())
  writeFileSync(path, helperBody(), { encoding: 'utf8' })
  if (process.platform !== 'win32') {
    try {
      chmodSync(path, 0o700)
    } catch {
      // best effort — git can still invoke a non-exec script via sh on
      // most distros, but we'd prefer the +x bit.
    }
  }
  cachedHelperPath = path
  return path
}

/**
 * Build the env block to pass to `git push` (or any git operation that
 * needs the token) so the askpass helper can authenticate without the
 * token ever crossing a process argument boundary.
 */
export function buildAuthenticatedEnv(
  token: string,
  extras: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extras,
    GIT_ASKPASS: ensureAskpassHelper(),
    GIT_TERMINAL_PROMPT: '0',
    [ENV_TOKEN_NAME]: token
  }
}

export const __ASKPASS_TOKEN_ENV_NAME_FOR_TEST = ENV_TOKEN_NAME
