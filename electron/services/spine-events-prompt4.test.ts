import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Real tmp userData so workspace-state's writeFile/readFile/unlink actually
// run. Event-log gets forced into memory fallback so its writes don't try to
// open a real SQLite db inside the tmp dir.
const userDataDir = mkdtempSync(join(tmpdir(), 'lamprey-p4-events-'))

const ipcRegistered: Map<string, (...args: any[]) => any> = new Map()

vi.mock('electron', () => ({
  app: {
    getPath: (which: string) => {
      if (which === 'userData') return userDataDir
      throw new Error(`unexpected getPath("${which}") in test`)
    }
  },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) => {
      ipcRegistered.set(channel, handler)
    }
  }
}))

// Mock git-runner so we control success/failure without spawning real git.
const runGitMock = vi.fn<(args: string[], cwd: string) => Promise<{
  stdout: string
  stderr: string
  code: number
}>>()
vi.mock('../services/git-runner', () => ({
  runGit: (args: string[], cwd: string) => runGitMock(args, cwd)
}))

// Mock chatOnce so automations tests don't try to reach a real provider.
// The mock fulfils the (messages, modelId, signal?, audit?) signature added
// in Prompt 3 so the runner can pass an audit object through unchanged.
const chatOnceMock = vi.fn<
  (messages: any, modelId: string, signal?: AbortSignal, audit?: unknown) => Promise<string>
>()
vi.mock('./providers/registry', async () => {
  const actual = await vi.importActual<typeof import('./providers/registry')>(
    './providers/registry'
  )
  return {
    ...actual,
    chatOnce: (messages: any, modelId: string, signal?: AbortSignal, audit?: unknown) =>
      chatOnceMock(messages, modelId, signal, audit)
  }
})

// Mock automations-store list/recordRun so the runner doesn't need a real DB.
const automationsListMock = vi.fn<() => Array<{
  id: string
  label: string
  cron: string
  prompt: string
  model: string | null
  enabled: number
  createdAt: number
}>>()
const recordRunMock = vi.fn<(id: string, result: string) => void>()
vi.mock('./automations-store', () => ({
  listAutomations: () => automationsListMock(),
  recordRun: (id: string, result: string) => recordRunMock(id, result)
}))

import {
  __forceMemoryFallback,
  __resetEventLog,
  listEvents
} from './event-log'
import {
  __resetWorkspaceStateCache,
  clearActiveWorkspace,
  setActiveWorkspace
} from './workspace-state'
import { registerWorktreeHandlers } from '../ipc/worktree'
import { runAutomation } from './automations-runner'

beforeEach(() => {
  __resetEventLog()
  __forceMemoryFallback()
  __resetWorkspaceStateCache()
  ipcRegistered.clear()
  runGitMock.mockReset()
  chatOnceMock.mockReset()
  automationsListMock.mockReset()
  recordRunMock.mockReset()
  // Clear the persisted workspace file between tests so each test sees a
  // clean transition rather than carrying over the previous run's setting.
  const statePath = join(userDataDir, 'active-workspace.txt')
  if (existsSync(statePath)) rmSync(statePath)
})

// ──────────────────── workspace.changed ────────────────────

describe('workspace.changed events', () => {
  it('setActiveWorkspace emits workspace.changed with from + to + action="set"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lamprey-p4-ws-'))
    setActiveWorkspace(dir)
    const events = listEvents({ type: 'workspace.changed' })
    expect(events).toHaveLength(1)
    expect(events[0].actorKind).toBe('user')
    expect(events[0].workspacePath).toBe(dir)
    expect((events[0].payload as { action: string; to: string }).action).toBe('set')
    expect((events[0].payload as { to: string }).to).toBe(dir)
  })

  it('setting the SAME workspace twice in a row emits exactly one event', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lamprey-p4-ws-noop-'))
    setActiveWorkspace(dir)
    setActiveWorkspace(dir)
    expect(listEvents({ type: 'workspace.changed' })).toHaveLength(1)
  })

  it('clearActiveWorkspace after a set emits workspace.changed with action="clear"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lamprey-p4-ws-clear-'))
    setActiveWorkspace(dir)
    clearActiveWorkspace()
    const clears = listEvents({ type: 'workspace.changed' }).filter(
      (e) => (e.payload as { action: string }).action === 'clear'
    )
    expect(clears).toHaveLength(1)
    expect((clears[0].payload as { from: string }).from).toBe(dir)
    expect((clears[0].payload as { to: unknown }).to).toBeUndefined()
  })

  it('clearActiveWorkspace with NO previously-set workspace emits nothing', () => {
    clearActiveWorkspace()
    expect(listEvents({ type: 'workspace.changed' })).toHaveLength(0)
  })
})

// ──────────────────── worktree.created / worktree.removed ────────────────────

describe('worktree IPC handlers emit worktree.created / removed events', () => {
  beforeEach(() => {
    registerWorktreeHandlers()
  })

  it('worktree:create success → worktree.created ok=true, severity info', async () => {
    runGitMock.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 })
    const handler = ipcRegistered.get('worktree:create')!
    const out = await handler(undefined, {
      cwd: '/tmp/repo',
      path: '/tmp/repo-feat',
      branch: 'feature/x'
    })
    expect(out).toMatchObject({ success: true })
    const events = listEvents({ type: 'worktree.created' })
    expect(events).toHaveLength(1)
    expect((events[0].payload as { ok: boolean }).ok).toBe(true)
    expect(events[0].severity).toBe('info')
    expect((events[0].payload as { branch: string }).branch).toBe('feature/x')
  })

  it('worktree:create with invalid branch → worktree.created ok=false rejectedAt="plan", severity error', async () => {
    const handler = ipcRegistered.get('worktree:create')!
    const out = await handler(undefined, {
      cwd: '/tmp/repo',
      path: '/tmp/repo-bad',
      branch: '-evil'
    })
    expect(out).toMatchObject({ success: false })
    expect(runGitMock).not.toHaveBeenCalled()
    const events = listEvents({ type: 'worktree.created' })
    expect(events).toHaveLength(1)
    expect((events[0].payload as { ok: boolean }).ok).toBe(false)
    expect(events[0].severity).toBe('error')
    expect((events[0].payload as { rejectedAt: string }).rejectedAt).toBe('plan')
  })

  it('worktree:create git failure → worktree.created ok=false with gitCode + errorPreview', async () => {
    runGitMock.mockResolvedValueOnce({
      stdout: '',
      stderr: 'fatal: branch already exists',
      code: 128
    })
    const handler = ipcRegistered.get('worktree:create')!
    await handler(undefined, {
      cwd: '/tmp/repo',
      path: '/tmp/repo-dup',
      branch: 'feature/dup'
    })
    const events = listEvents({ type: 'worktree.created' })
    expect(events).toHaveLength(1)
    const payload = events[0].payload as {
      ok: boolean
      gitCode: number
      errorPreview: string
    }
    expect(payload.ok).toBe(false)
    expect(payload.gitCode).toBe(128)
    expect(payload.errorPreview).toContain('branch already exists')
  })

  it('worktree:remove success → worktree.removed ok=true', async () => {
    runGitMock.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 })
    const handler = ipcRegistered.get('worktree:remove')!
    const out = await handler(undefined, {
      cwd: '/tmp/repo',
      path: '/tmp/repo-feat',
      force: true
    })
    expect(out).toMatchObject({ success: true })
    const events = listEvents({ type: 'worktree.removed' })
    expect(events).toHaveLength(1)
    const payload = events[0].payload as { ok: boolean; force: boolean }
    expect(payload.ok).toBe(true)
    expect(payload.force).toBe(true)
  })

  it('worktree:remove with relative path → ok=false rejectedAt="plan"', async () => {
    const handler = ipcRegistered.get('worktree:remove')!
    await handler(undefined, {
      cwd: '/tmp/repo',
      path: 'relative/path'
    })
    const events = listEvents({ type: 'worktree.removed' })
    expect(events).toHaveLength(1)
    const payload = events[0].payload as { ok: boolean; rejectedAt: string }
    expect(payload.ok).toBe(false)
    expect(payload.rejectedAt).toBe('plan')
  })
})

// ──────────────────── automation.started / completed / failed ────────────────────

describe('automation runner emits automation.* events with a per-run correlationId', () => {
  it('successful run emits started + completed sharing one correlationId', async () => {
    automationsListMock.mockReturnValue([
      {
        id: 'auto-1',
        label: 'Morning brief',
        cron: '0 9 * * *',
        prompt: 'Brief me',
        model: 'deepseek-v4-pro',
        enabled: 1,
        createdAt: 0
      }
    ])
    chatOnceMock.mockResolvedValueOnce('the briefing')
    await runAutomation('auto-1')

    const events = listEvents({ automationId: 'auto-1', order: 'asc' })
    expect(events.map((e) => e.type)).toEqual([
      'automation.started',
      'automation.completed'
    ])
    expect(events[0].correlationId).toBeDefined()
    expect(events[1].correlationId).toBe(events[0].correlationId)
    // chatOnce received the audit object with the same correlationId so its
    // model.request.* events would join the timeline at runtime.
    expect(chatOnceMock).toHaveBeenCalledTimes(1)
    const call = chatOnceMock.mock.calls[0]
    expect((call[3] as { correlationId: string }).correlationId).toBe(
      events[0].correlationId
    )
    // Completed event carries durationMs + a bounded reply preview.
    const completedPayload = events[1].payload as {
      durationMs: number
      replyPreview: string
      model: string
    }
    expect(typeof completedPayload.durationMs).toBe('number')
    expect(completedPayload.replyPreview).toContain('the briefing')
    expect(completedPayload.model).toBe('deepseek-v4-pro')
    // recordRun is still called — the existing last_run_at / last_result
    // is preserved alongside the event row.
    expect(recordRunMock).toHaveBeenCalledWith('auto-1', 'the briefing')
  })

  it('failed run emits started + failed with severity error and errorPreview', async () => {
    automationsListMock.mockReturnValue([
      {
        id: 'auto-2',
        label: 'Flaky',
        cron: '*/5 * * * *',
        prompt: 'flake',
        model: null,
        enabled: 1,
        createdAt: 0
      }
    ])
    chatOnceMock.mockRejectedValueOnce(new Error('upstream provider 500'))
    await runAutomation('auto-2')

    const events = listEvents({ automationId: 'auto-2', order: 'asc' })
    expect(events.map((e) => e.type)).toEqual([
      'automation.started',
      'automation.failed'
    ])
    const failedPayload = events[1].payload as {
      errorPreview: string
      durationMs: number
    }
    expect(events[1].severity).toBe('error')
    expect(failedPayload.errorPreview).toContain('upstream provider 500')
    expect(typeof failedPayload.durationMs).toBe('number')
    // recordRun stamps an [error] marker in the legacy last_result slot too.
    expect(recordRunMock).toHaveBeenCalledWith('auto-2', '[error] upstream provider 500')
  })

  it('unknown automation id → no events, no chatOnce call', async () => {
    automationsListMock.mockReturnValue([])
    await runAutomation('not-real')
    expect(listEvents({ type: 'automation.started' })).toHaveLength(0)
    expect(chatOnceMock).not.toHaveBeenCalled()
  })
})
