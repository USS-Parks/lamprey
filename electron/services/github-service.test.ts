import { afterEach, describe, it, expect } from 'vitest'
import {
  buildCreatePullRequestPayload,
  buildRequestHeaders,
  friendlyAuthHint,
  getCallbackPortCandidates,
  isBundledClientAvailable,
  isPortInUseError,
  isValidBranchName,
  isValidSlug,
  parsePullRequest,
  parseRepoList,
  parseReviewComment,
  planPushBranch,
  resolveOAuthCredentials,
  type RawReviewComment
} from './github-service'

describe('isValidSlug', () => {
  it('accepts realistic owner/repo names', () => {
    for (const v of ['octocat', 'Hello-World', 'lamprey.harness', 'a_b', 'X1']) {
      expect(isValidSlug(v)).toBe(true)
    }
  })

  it('rejects empty, leading dot, leading dash, and special chars', () => {
    for (const v of ['', '.git', '-x', 'a b', 'a/b', 'a..b', 'a;b']) {
      expect(isValidSlug(v)).toBe(false)
    }
  })

  it('rejects non-strings', () => {
    expect(isValidSlug(undefined)).toBe(false)
    expect(isValidSlug(null)).toBe(false)
    expect(isValidSlug(42)).toBe(false)
    expect(isValidSlug({})).toBe(false)
  })

  it('caps slug length at 100', () => {
    expect(isValidSlug('a'.repeat(100))).toBe(true)
    expect(isValidSlug('a'.repeat(101))).toBe(false)
  })
})

describe('isValidBranchName', () => {
  it('matches the worktree validator posture: no leading -, no ".." sequence', () => {
    expect(isValidBranchName('feat/x')).toBe(true)
    expect(isValidBranchName('release/2024.06.02')).toBe(true)
    expect(isValidBranchName('-x')).toBe(false)
    expect(isValidBranchName('a..b')).toBe(false)
    expect(isValidBranchName('a b')).toBe(false)
  })
})

describe('buildRequestHeaders', () => {
  it('sets Authorization, Accept, GitHub api version, and User-Agent', () => {
    const h = buildRequestHeaders('TOKEN_VALUE')
    expect(h['Authorization']).toBe('Bearer TOKEN_VALUE')
    expect(h['Accept']).toBe('application/vnd.github+json')
    expect(h['X-GitHub-Api-Version']).toBe('2022-11-28')
    expect(h['User-Agent']).toBe('Lamprey-Harness')
  })

  it('honours an Accept override (for e.g. raw / diff payloads)', () => {
    expect(buildRequestHeaders('t', 'application/vnd.github.v3.diff')['Accept']).toBe(
      'application/vnd.github.v3.diff'
    )
  })

  // We never want the bearer to land in any other header (e.g. cookies),
  // and the assembled object must be plain — no prototype injection.
  it('does not leak the token into any header other than Authorization', () => {
    const h = buildRequestHeaders('SECRET-TOKEN')
    for (const [k, v] of Object.entries(h)) {
      if (k === 'Authorization') continue
      expect(v.includes('SECRET-TOKEN')).toBe(false)
    }
  })
})

describe('parseRepoList', () => {
  it('returns [] for non-array input', () => {
    expect(parseRepoList(null)).toEqual([])
    expect(parseRepoList({})).toEqual([])
    expect(parseRepoList('foo')).toEqual([])
  })

  it('skips entries with no full_name', () => {
    const repos = parseRepoList([{}, null, { id: 1, full_name: 'octocat/Hello-World', name: 'Hello-World', owner: { login: 'octocat' }, private: false, default_branch: 'main', html_url: 'h', clone_url: 'c', ssh_url: 's', description: null }])
    expect(repos.length).toBe(1)
    expect(repos[0].fullName).toBe('octocat/Hello-World')
  })

  it('derives owner from full_name when owner.login is missing', () => {
    const repos = parseRepoList([
      { id: 1, full_name: 'octocat/Hello-World', name: 'Hello-World', owner: {} as any, private: false, default_branch: 'main', html_url: 'h', clone_url: 'c', ssh_url: 's', description: null }
    ])
    expect(repos[0].owner).toBe('octocat')
  })

  it('defaults a missing default_branch to "main"', () => {
    const repos = parseRepoList([
      { id: 1, full_name: 'o/r', name: 'r', owner: { login: 'o' }, private: true, default_branch: '', html_url: 'h', clone_url: 'c', ssh_url: 's', description: null }
    ])
    expect(repos[0].defaultBranch).toBe('main')
  })
})

describe('buildCreatePullRequestPayload', () => {
  it('emits the canonical GitHub PR-creation shape', () => {
    expect(
      buildCreatePullRequestPayload({
        owner: 'o',
        repo: 'r',
        title: 'Add foo',
        body: 'Closes #1',
        head: 'feat/foo',
        base: 'main',
        draft: true
      })
    ).toEqual({
      title: 'Add foo',
      body: 'Closes #1',
      head: 'feat/foo',
      base: 'main',
      draft: true
    })
  })

  it('coerces undefined body to "" and undefined draft to false', () => {
    const out = buildCreatePullRequestPayload({
      owner: 'o',
      repo: 'r',
      title: 't',
      head: 'h',
      base: 'b'
    })
    expect(out.body).toBe('')
    expect(out.draft).toBe(false)
  })

  it('prefers headLabel over head when provided (fork PRs use "owner:branch")', () => {
    const out = buildCreatePullRequestPayload({
      owner: 'upstream',
      repo: 'r',
      title: 't',
      head: 'feature',
      headLabel: 'fork-owner:feature',
      base: 'main'
    })
    expect(out.head).toBe('fork-owner:feature')
  })
})

describe('parsePullRequest', () => {
  const raw = {
    number: 42,
    title: 'A PR',
    body: 'body',
    state: 'open' as const,
    draft: true,
    merged: false,
    merged_at: null,
    html_url: 'https://github.com/o/r/pull/42',
    user: { login: 'u', avatar_url: 'a' },
    base: { ref: 'main', sha: 'base-sha', label: 'o:main' },
    head: { ref: 'feat', sha: 'head-sha', label: 'u:feat' },
    created_at: 'c',
    updated_at: 'u'
  }

  it('camelCases and preserves draft + merged flags', () => {
    const pr = parsePullRequest(raw)
    expect(pr.number).toBe(42)
    expect(pr.draft).toBe(true)
    expect(pr.merged).toBe(false)
    expect(pr.htmlUrl).toBe('https://github.com/o/r/pull/42')
    expect(pr.user.login).toBe('u')
    expect(pr.head.ref).toBe('feat')
  })

  it('infers merged=true when merged_at is set even if merged flag is missing', () => {
    const pr = parsePullRequest({ ...raw, merged: undefined as any, merged_at: '2024-06-01T00:00:00Z' })
    expect(pr.merged).toBe(true)
  })
})

describe('planPushBranch', () => {
  it('refuses invalid branch names regardless of mode', () => {
    expect(planPushBranch({ hasToken: true, mode: 'oauth', branchValid: false })).toEqual({
      kind: 'refuse',
      reason: 'invalid branch name'
    })
  })

  it('chooses token push when a token exists and mode is not none', () => {
    expect(planPushBranch({ hasToken: true, mode: 'oauth', branchValid: true })).toMatchObject({
      kind: 'token'
    })
    expect(planPushBranch({ hasToken: true, mode: 'gh-cli', branchValid: true })).toMatchObject({
      kind: 'token'
    })
  })

  it('falls back to plain git push when no token is available', () => {
    expect(planPushBranch({ hasToken: false, mode: 'oauth', branchValid: true })).toMatchObject({
      kind: 'plain'
    })
    expect(planPushBranch({ hasToken: false, mode: 'none', branchValid: true })).toMatchObject({
      kind: 'plain'
    })
  })

  it('falls back to plain push when mode is "none" even with a stale token marker', () => {
    expect(planPushBranch({ hasToken: true, mode: 'none', branchValid: true })).toMatchObject({
      kind: 'plain'
    })
  })
})

describe('resolveOAuthCredentials', () => {
  // Precedence: per-call override > user-saved BYO > bundled build-time.
  // Each layer is independently testable so a Settings UI refactor that
  // changes how creds are passed in can't quietly drop a layer.

  it('returns "none" with null fields when every source is empty', () => {
    expect(resolveOAuthCredentials({})).toEqual({
      clientId: null,
      clientSecret: null,
      source: 'none'
    })
  })

  it('picks the per-call override when both id and secret are supplied there', () => {
    const out = resolveOAuthCredentials({
      override: { clientId: 'override-id', clientSecret: 'override-secret' },
      saved: { clientId: 'saved-id', clientSecret: 'saved-secret' },
      bundled: { clientId: 'bundled-id', clientSecret: 'bundled-secret' }
    })
    expect(out).toEqual({
      clientId: 'override-id',
      clientSecret: 'override-secret',
      source: 'override'
    })
  })

  it('falls past override when override is partial (id only, secret only) and uses the next available layer', () => {
    const partial = resolveOAuthCredentials({
      override: { clientId: 'only-id' },
      saved: { clientId: 'saved-id', clientSecret: 'saved-secret' }
    })
    expect(partial.source).toBe('saved')
    expect(partial.clientId).toBe('saved-id')
  })

  it('picks saved when override is absent and saved has both fields', () => {
    const out = resolveOAuthCredentials({
      saved: { clientId: 'saved-id', clientSecret: 'saved-secret' },
      bundled: { clientId: 'bundled-id', clientSecret: 'bundled-secret' }
    })
    expect(out.source).toBe('saved')
  })

  it('falls through saved when saved is partial (one null) and uses bundled', () => {
    const out = resolveOAuthCredentials({
      saved: { clientId: 'saved-id', clientSecret: null },
      bundled: { clientId: 'bundled-id', clientSecret: 'bundled-secret' }
    })
    expect(out.source).toBe('bundled')
    expect(out.clientId).toBe('bundled-id')
  })

  it('picks bundled when only bundled is present (contributor with bundled build, no saved creds)', () => {
    expect(
      resolveOAuthCredentials({
        bundled: { clientId: 'bundled-id', clientSecret: 'bundled-secret' }
      })
    ).toEqual({
      clientId: 'bundled-id',
      clientSecret: 'bundled-secret',
      source: 'bundled'
    })
  })
})

describe('isBundledClientAvailable', () => {
  const originalId = process.env.LAMPREY_GITHUB_CLIENT_ID
  const originalSecret = process.env.LAMPREY_GITHUB_CLIENT_SECRET

  afterEach(() => {
    if (originalId === undefined) delete process.env.LAMPREY_GITHUB_CLIENT_ID
    else process.env.LAMPREY_GITHUB_CLIENT_ID = originalId
    if (originalSecret === undefined) delete process.env.LAMPREY_GITHUB_CLIENT_SECRET
    else process.env.LAMPREY_GITHUB_CLIENT_SECRET = originalSecret
  })

  it('is false when either env var is empty (contributor build with no bundled OAuth)', () => {
    process.env.LAMPREY_GITHUB_CLIENT_ID = ''
    process.env.LAMPREY_GITHUB_CLIENT_SECRET = ''
    expect(isBundledClientAvailable()).toBe(false)
    process.env.LAMPREY_GITHUB_CLIENT_ID = 'present'
    process.env.LAMPREY_GITHUB_CLIENT_SECRET = ''
    expect(isBundledClientAvailable()).toBe(false)
    process.env.LAMPREY_GITHUB_CLIENT_ID = ''
    process.env.LAMPREY_GITHUB_CLIENT_SECRET = 'present'
    expect(isBundledClientAvailable()).toBe(false)
  })

  it('is true only when both env vars carry a value', () => {
    process.env.LAMPREY_GITHUB_CLIENT_ID = 'Iv1.example'
    process.env.LAMPREY_GITHUB_CLIENT_SECRET = 'secret-value'
    expect(isBundledClientAvailable()).toBe(true)
  })
})

describe('OAuth callback port fallback', () => {
  it('exposes [9876, 9877, 9878] as the candidate ports', () => {
    expect(getCallbackPortCandidates()).toEqual([9876, 9877, 9878])
  })

  it('identifies EADDRINUSE errors so the retry loop can advance past them', () => {
    // Node's net error shape: { code: 'EADDRINUSE', ... }
    expect(isPortInUseError({ code: 'EADDRINUSE' })).toBe(true)
    const err = Object.assign(new Error('listen EADDRINUSE 0.0.0.0:9876'), { code: 'EADDRINUSE' })
    expect(isPortInUseError(err)).toBe(true)
  })

  it('does NOT treat unrelated errors as retryable (EACCES, generic Error, falsy)', () => {
    expect(isPortInUseError({ code: 'EACCES' })).toBe(false)
    expect(isPortInUseError(new Error('boom'))).toBe(false)
    expect(isPortInUseError(null)).toBe(false)
    expect(isPortInUseError(undefined)).toBe(false)
    expect(isPortInUseError('EADDRINUSE')).toBe(false) // string, not error
  })
})

describe('friendlyAuthHint', () => {
  it('returns a helpful message on auth failure when not connected', () => {
    const hint = friendlyAuthHint(
      'remote: Support for password authentication was removed.\nfatal: Authentication failed',
      'none'
    )
    expect(hint).toMatch(/no GitHub credentials/i)
  })

  it('suggests reconnecting when auth fails with a stored mode', () => {
    const hint = friendlyAuthHint('fatal: Authentication failed for https://github.com/...', 'oauth')
    expect(hint).toMatch(/reconnect/i)
  })

  it('flags non-fast-forward as a rebase situation', () => {
    const hint = friendlyAuthHint('rejected: non-fast-forward', 'oauth')
    expect(hint).toMatch(/non-fast-forward/i)
  })

  it('returns undefined for unrelated stderr', () => {
    expect(friendlyAuthHint('Everything up-to-date', 'oauth')).toBeUndefined()
  })
})

// ─── F2 — PR review threading ────────────────────────────────────────────

describe('parseReviewComment', () => {
  const sample: RawReviewComment = {
    id: 12345,
    pull_request_review_id: 999,
    pull_request_url: 'https://api.github.com/repos/o/r/pulls/7',
    diff_hunk: '@@ -1,3 +1,4 @@',
    path: 'src/index.ts',
    position: 4,
    original_position: 4,
    line: 42,
    start_line: null,
    side: 'RIGHT',
    body: 'Looks like a use-after-free.',
    html_url: 'https://github.com/o/r/pull/7#discussion_r12345',
    user: { login: 'octocat', avatar_url: 'https://example.com/octocat.png' },
    created_at: '2026-06-03T12:00:00Z',
    updated_at: '2026-06-03T12:05:00Z'
  }

  it('maps the GitHub review-comment shape to the normalised one', () => {
    const out = parseReviewComment(sample)
    expect(out.id).toBe(12345)
    expect(out.reviewId).toBe(999)
    expect(out.path).toBe('src/index.ts')
    expect(out.line).toBe(42)
    expect(out.side).toBe('RIGHT')
    expect(out.body).toContain('use-after-free')
    expect(out.user.login).toBe('octocat')
    expect(out.user.avatarUrl).toContain('octocat.png')
  })

  it('treats absent in_reply_to_id as a top-level comment', () => {
    expect(parseReviewComment(sample).inReplyToId).toBeNull()
  })

  it('carries in_reply_to_id when set (thread reply)', () => {
    const reply: RawReviewComment = { ...sample, id: 67890, in_reply_to_id: 12345 }
    expect(parseReviewComment(reply).inReplyToId).toBe(12345)
  })

  it('preserves null line + start_line for file-level comments', () => {
    const fileLevel: RawReviewComment = { ...sample, line: null, start_line: null, side: null }
    const out = parseReviewComment(fileLevel)
    expect(out.line).toBeNull()
    expect(out.startLine).toBeNull()
    expect(out.side).toBeNull()
  })
})
