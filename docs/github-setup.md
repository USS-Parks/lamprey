# GitHub setup

Lamprey can clone repositories, push branches, and open pull requests against GitHub. This page covers the three ways to authenticate. Pick the one that matches how you got Lamprey.

---

## Quickest: official Lamprey build

If you installed Lamprey from an official release built with `LAMPREY_GITHUB_CLIENT_ID` configured:

1. Open Settings → GitHub.
2. Click **Connect GitHub**.
3. Authorize Lamprey in the browser tab that opens.
4. Done. Lamprey lists your repos under Environment → GitHub.

No accounts to register, no credentials to paste. Lamprey ships its own OAuth App; the connection uses it.

Scopes requested: `read:user` (your login + avatar) and `repo` (list, clone, push private repos and open PRs).

---

## Bring your own OAuth App

Use this when you're building Lamprey from source, running a fork, or want the GitHub authorize page to say *your* app name instead of "Lamprey Harness."

### 1. Register the OAuth App on GitHub

Visit **https://github.com/settings/developers** → **OAuth Apps** → **New OAuth App**.

Fill the form:

| Field | Value |
|---|---|
| Application name | Anything you want users to see on the authorize page |
| Homepage URL | Any valid URL (your fork's GitHub page is fine) |
| Authorization callback URL | `http://localhost:9876/callback` — exact match required |
| Enable Device Flow | leave unchecked |

Click **Register application**.

### 2. Capture the credentials

On the OAuth App's settings page:

- Copy the **Client ID** (looks like `Iv1.abc123…`). Not secret.
- Click **Generate a new client secret**. Copy it immediately — GitHub only shows it once.

### 3. Paste into Lamprey

1. Open Settings → GitHub.
2. Expand **Advanced**.
3. Paste the Client ID and Client Secret.
4. Click **Save client**, then **Connect with your OAuth App**.
5. Authorize in browser.

The credentials are encrypted via Electron `safeStorage` (or, when unavailable, stored as plaintext under explicit consent — see [keychain SEC-10 comment](../electron/services/keychain.ts)).

---

## Local `gh` CLI

If you already have the [GitHub CLI](https://cli.github.com) installed and authenticated:

```bash
gh auth login
```

In Lamprey: Settings → GitHub → **Use local `gh` CLI**. Lamprey shells out to `gh auth token` whenever it needs a bearer. No OAuth App registration on your end — `gh` manages everything.

This path has slightly higher per-request overhead (a process spawn per probe) and depends on `gh` staying authenticated. The OAuth paths above are persistent.

---

## What gets stored, where

| Item | Location | Why |
|---|---|---|
| Access token (OAuth) | `userData/keys.json`, encrypted via `safeStorage` | Required to make any GitHub API call. |
| Your OAuth App Client ID + Secret (BYO only) | Same | Used to exchange the auth code at connect time. |
| Mode flag (`oauth` / `gh-cli` / `none`) | `userData/settings.json` | Plain. Non-secret. |
| Linked repo per project | `userData/lamprey.db` table `project_github_repos` | Survives restarts. |

Tokens never reach the renderer process. They never appear in `git push` command-line arguments or in `.git/config` — pushes route through a `GIT_ASKPASS` shim that reads the token from a per-spawn env var (see `electron/services/github-askpass.ts`).

---

## Troubleshooting

**"Browser opened but nothing happened after I authorized."**
The callback comes back to `http://localhost:9876/callback`. If another process is holding port 9876 (a stale Lamprey, the Google MCP OAuth flow, an unrelated dev server), the callback can't bind. Quit any other Lamprey instance and retry. If the problem persists, run `netstat -ano | findstr :9876` (Windows) / `lsof -i :9876` (macOS/Linux) to identify the holding process.

**"Push failed with 403 / Authentication failed."**
Your token may have been revoked at github.com → Settings → Applications, or the OAuth App's scope was reduced. Disconnect in Lamprey (Settings → GitHub → Disconnect) and reconnect.

**"Connect button does nothing on this build."**
The build was produced without `LAMPREY_GITHUB_CLIENT_ID` env var set. Use the BYO path above, or the `gh` CLI path.

**"I want to switch from BYO back to bundled."**
Disconnect, then delete your saved client (Settings → GitHub → Advanced → Replace → leave blank → Save is a no-op; instead use Disconnect which wipes the access token but leaves the client). The bundled path is offered automatically as long as `Advanced` is collapsed.

---

## For maintainers: building with bundled credentials

The bundled OAuth App is opt-in at build time:

```bash
# Local dev
export LAMPREY_GITHUB_CLIENT_ID="Iv1.your-id"
export LAMPREY_GITHUB_CLIENT_SECRET="your-secret"
npx electron-vite build
```

```yaml
# CI (.github/workflows/build.yml)
- run: npx electron-vite build
  env:
    LAMPREY_GITHUB_CLIENT_ID: ${{ secrets.LAMPREY_GITHUB_CLIENT_ID }}
    LAMPREY_GITHUB_CLIENT_SECRET: ${{ secrets.LAMPREY_GITHUB_CLIENT_SECRET }}
```

The values are read at build time by `electron.vite.config.ts` and emitted as string-define replacements in the main bundle. They are never read from the renderer process. The renderer probes `github:hasBundledClient` (boolean only) to decide which UI to show.

If the env vars are unset at build, the bundle has empty-string defaults; the Settings UI falls back to the BYO / `gh`-CLI paths automatically.
