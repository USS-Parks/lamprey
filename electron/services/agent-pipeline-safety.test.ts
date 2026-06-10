import { describe, it, expect, vi } from 'vitest'
import {
  evaluateClosure,
  buildAbortMessageText,
  StageInactivityWatchdog,
  withPipelineSafety,
  type SystemMessagePayload
} from './agent-pipeline-safety'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

describe('CR-2 evaluateClosure — decision rule', () => {
  it('returns kind=none when termination is normal (happy path)', () => {
    const action = evaluateClosure({
      highestReachedStage: 'composer',
      terminationReason: 'normal',
      mutatedPaths: ['src/foo.ts']
    })
    expect(action.kind).toBe('none')
  })

  it('returns kind=none when pipeline threw but no files were mutated', () => {
    const action = evaluateClosure({
      highestReachedStage: 'reviewer',
      terminationReason: 'thrown',
      mutatedPaths: []
    })
    expect(action.kind).toBe('none')
    if (action.kind === 'none') {
      expect(action.reason).toContain('no mutations to surface')
    }
  })

  it('synthesizes a system message when pipeline threw after mutations (F2 case)', () => {
    const action = evaluateClosure({
      highestReachedStage: 'reviewer',
      terminationReason: 'thrown',
      mutatedPaths: ['src/a.ts', 'src/b.ts']
    })
    expect(action.kind).toBe('synthesize-system-message')
    if (action.kind === 'synthesize-system-message') {
      expect(action.stage).toBe('reviewer')
      expect(action.terminationReason).toBe('thrown')
      expect(action.mutatedPaths).toEqual(['src/a.ts', 'src/b.ts'])
      expect(action.messageText).toContain('errored at the reviewer stage')
      expect(action.messageText).toContain('src/a.ts')
      expect(action.messageText).toContain('src/b.ts')
    }
  })

  it('F15: synthesizes system message when pipeline stalled after mutations', () => {
    const action = evaluateClosure({
      highestReachedStage: 'coder',
      terminationReason: 'stalled',
      mutatedPaths: ['package.json', 'src/store/messagesSlice.ts']
    })
    expect(action.kind).toBe('synthesize-system-message')
    if (action.kind === 'synthesize-system-message') {
      expect(action.terminationReason).toBe('stalled')
      expect(action.messageText).toContain('stalled at the coder stage')
      expect(action.messageText).toContain('package.json')
      expect(action.messageText).toContain('src/store/messagesSlice.ts')
    }
  })

  it('F15: zero mutations + stall → no system message (read-only stall not destructive)', () => {
    const action = evaluateClosure({
      highestReachedStage: 'coder',
      terminationReason: 'stalled',
      mutatedPaths: []
    })
    expect(action.kind).toBe('none')
  })

  it('cancelled with mutations still synthesizes (user lost work)', () => {
    const action = evaluateClosure({
      highestReachedStage: 'coder',
      terminationReason: 'cancelled',
      mutatedPaths: ['src/a.ts']
    })
    expect(action.kind).toBe('synthesize-system-message')
  })
})

describe('CR-2 buildAbortMessageText — formatting', () => {
  it('singular file phrasing for n=1', () => {
    const text = buildAbortMessageText({
      stage: 'coder',
      terminationReason: 'thrown',
      mutatedPaths: ['src/only-one.ts']
    })
    expect(text).toContain('1 file was modified')
    expect(text).toContain('  - src/only-one.ts')
    expect(text).toContain("Reply 'revert' to restore")
  })

  it('plural file phrasing for n>1', () => {
    const text = buildAbortMessageText({
      stage: 'reviewer',
      terminationReason: 'thrown',
      mutatedPaths: ['a.ts', 'b.ts', 'c.ts']
    })
    expect(text).toContain('3 files were modified')
  })

  it('maps each termination reason to a readable label', () => {
    expect(
      buildAbortMessageText({
        stage: 'composer',
        terminationReason: 'stalled',
        mutatedPaths: ['x.ts']
      })
    ).toContain('stalled at the composer stage')
    expect(
      buildAbortMessageText({
        stage: 'coder',
        terminationReason: 'cancelled',
        mutatedPaths: ['x.ts']
      })
    ).toContain('was cancelled at the coder stage')
  })
})

describe('CR-2 F15 StageInactivityWatchdog', () => {
  it('fires onStall after inactivityMs elapses without a kick', async () => {
    vi.useFakeTimers()
    let firedStage: string | null = null
    const watchdog = new StageInactivityWatchdog(100, (stage) => {
      firedStage = stage
    })
    watchdog.armStage('coder')
    vi.advanceTimersByTime(99)
    expect(firedStage).toBeNull()
    vi.advanceTimersByTime(2)
    expect(firedStage).toBe('coder')
    vi.useRealTimers()
  })

  it('kick() resets the timer', () => {
    vi.useFakeTimers()
    let firedStage: string | null = null
    const watchdog = new StageInactivityWatchdog(100, (stage) => {
      firedStage = stage
    })
    watchdog.armStage('coder')
    vi.advanceTimersByTime(80)
    watchdog.kick()
    vi.advanceTimersByTime(80) // 160 since arm, but only 80 since last kick
    expect(firedStage).toBeNull()
    vi.advanceTimersByTime(30)
    expect(firedStage).toBe('coder')
    vi.useRealTimers()
  })

  it('disarm() prevents firing', () => {
    vi.useFakeTimers()
    let firedStage: string | null = null
    const watchdog = new StageInactivityWatchdog(100, (stage) => {
      firedStage = stage
    })
    watchdog.armStage('coder')
    vi.advanceTimersByTime(50)
    watchdog.disarm()
    vi.advanceTimersByTime(200)
    expect(firedStage).toBeNull()
    vi.useRealTimers()
  })

  it('armStage(newStage) resets the timer to the new stage', () => {
    vi.useFakeTimers()
    let firedStage: string | null = null
    const watchdog = new StageInactivityWatchdog(100, (stage) => {
      firedStage = stage
    })
    watchdog.armStage('coder')
    vi.advanceTimersByTime(50)
    watchdog.armStage('reviewer')
    vi.advanceTimersByTime(50)
    expect(firedStage).toBeNull()
    vi.advanceTimersByTime(60)
    expect(firedStage).toBe('reviewer')
    vi.useRealTimers()
  })

  it('inactivityMs=0 disables the watchdog (default behavior preserved)', () => {
    vi.useFakeTimers()
    let firedStage: string | null = null
    const watchdog = new StageInactivityWatchdog(0, (stage) => {
      firedStage = stage
    })
    watchdog.armStage('coder')
    vi.advanceTimersByTime(60_000)
    expect(firedStage).toBeNull()
    expect(watchdog.hasFired()).toBe(false)
    vi.useRealTimers()
  })

  it('does not double-fire if kick() arrives after stall', () => {
    vi.useFakeTimers()
    let fireCount = 0
    const watchdog = new StageInactivityWatchdog(100, () => {
      fireCount++
    })
    watchdog.armStage('coder')
    vi.advanceTimersByTime(150)
    expect(fireCount).toBe(1)
    watchdog.kick()
    watchdog.kick()
    vi.advanceTimersByTime(200)
    expect(fireCount).toBe(1)
    vi.useRealTimers()
  })

  it('stall handler errors do not propagate', () => {
    vi.useFakeTimers()
    const watchdog = new StageInactivityWatchdog(100, () => {
      throw new Error('handler boom')
    })
    watchdog.armStage('coder')
    expect(() => vi.advanceTimersByTime(150)).not.toThrow()
    vi.useRealTimers()
  })
})

// ---------------------------------------------------------------------------
// withPipelineSafety — the 5 acceptance scenarios from CR-2 §1 of the P-SPR.
// Each scenario sets up a temp git repo, drives the wrapper with a fake
// runPipeline, and asserts on the persist callback.
// ---------------------------------------------------------------------------

function setupTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cr2-safety-'))
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'cr2@test'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'CR-2 test'], { cwd: dir, stdio: 'ignore' })
  writeFileSync(join(dir, 'baseline.txt'), 'baseline\n')
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'baseline'], { cwd: dir, stdio: 'ignore' })
  return dir
}

describe('CR-2 withPipelineSafety — 5 acceptance scenarios', () => {
  it('Scenario 1: Coder mutates 2 files, Reviewer throws → system message persisted', async () => {
    const dir = setupTempGitRepo()
    const persisted: SystemMessagePayload[] = []
    const result = await withPipelineSafety({
      conversationId: 'cr2-s1',
      workspacePath: dir,
      persistSystemMessage: (p) => persisted.push(p),
      runPipeline: async ({ reachedStage }) => {
        reachedStage('planner')
        reachedStage('coder')
        // Simulate two Coder mutations on disk
        writeFileSync(join(dir, 'mutated-a.ts'), 'a\n')
        writeFileSync(join(dir, 'mutated-b.ts'), 'b\n')
        reachedStage('reviewer')
        throw new Error('reviewer fell over')
      }
    })

    expect(persisted).toHaveLength(1)
    expect(persisted[0].conversationId).toBe('cr2-s1')
    expect(persisted[0].terminationReason).toBe('thrown')
    expect(persisted[0].stage).toBe('reviewer')
    expect(persisted[0].mutatedPaths).toContain('mutated-a.ts')
    expect(persisted[0].mutatedPaths).toContain('mutated-b.ts')
    expect(persisted[0].text).toContain('errored at the reviewer stage')
    expect(result.closureAction.kind).toBe('synthesize-system-message')
  })

  it('Scenario 2: Coder mutates 0 files, Reviewer throws → NO system message', async () => {
    const dir = setupTempGitRepo()
    const persisted: SystemMessagePayload[] = []
    await withPipelineSafety({
      conversationId: 'cr2-s2',
      workspacePath: dir,
      persistSystemMessage: (p) => persisted.push(p),
      runPipeline: async ({ reachedStage }) => {
        reachedStage('planner')
        reachedStage('coder')
        reachedStage('reviewer')
        throw new Error('reviewer fell over')
      }
    })

    expect(persisted).toHaveLength(0)
  })

  it('Scenario 3: Coder mutates 1 file, Composer completes cleanly → NO system message', async () => {
    const dir = setupTempGitRepo()
    const persisted: SystemMessagePayload[] = []
    const result = await withPipelineSafety({
      conversationId: 'cr2-s3',
      workspacePath: dir,
      persistSystemMessage: (p) => persisted.push(p),
      runPipeline: async ({ reachedStage }) => {
        reachedStage('planner')
        reachedStage('coder')
        writeFileSync(join(dir, 'mutated-c.ts'), 'c\n')
        reachedStage('reviewer')
        reachedStage('composer')
      }
    })

    expect(persisted).toHaveLength(0)
    expect(result.closureAction.kind).toBe('none')
    expect(result.highestReachedStage).toBe('composer')
  })

  it('F15 Scenario 4: Coder mutates 2 files, stage exceeds stageInactivityMs → stalled system message', async () => {
    vi.useFakeTimers()
    const dir = setupTempGitRepo()
    const persisted: SystemMessagePayload[] = []
    const runP = withPipelineSafety({
      conversationId: 'cr2-s4',
      workspacePath: dir,
      stageInactivityMs: 100,
      persistSystemMessage: (p) => persisted.push(p),
      runPipeline: async ({ reachedStage, watchdog }) => {
        reachedStage('planner')
        reachedStage('coder')
        watchdog.armStage('coder')
        writeFileSync(join(dir, 'mutated-d.ts'), 'd\n')
        writeFileSync(join(dir, 'mutated-e.ts'), 'e\n')
        // Simulate stall — never kick the watchdog
        await new Promise<void>((resolve) => {
          // We expect the watchdog to fire after 100ms; the resolve happens
          // when fake timers advance. Wait for next macrotask after firing.
          setTimeout(resolve, 200)
        })
      }
    })
    await vi.advanceTimersByTimeAsync(250)
    const result = await runP
    vi.useRealTimers()

    expect(result.stalled).toBe(true)
    expect(persisted).toHaveLength(1)
    expect(persisted[0].terminationReason).toBe('stalled')
    expect(persisted[0].mutatedPaths).toContain('mutated-d.ts')
    expect(persisted[0].mutatedPaths).toContain('mutated-e.ts')
  })

  it('F15 Scenario 5: Coder mutates 0 files, stalls → NO system message', async () => {
    vi.useFakeTimers()
    const dir = setupTempGitRepo()
    const persisted: SystemMessagePayload[] = []
    const runP = withPipelineSafety({
      conversationId: 'cr2-s5',
      workspacePath: dir,
      stageInactivityMs: 100,
      persistSystemMessage: (p) => persisted.push(p),
      runPipeline: async ({ reachedStage, watchdog }) => {
        reachedStage('planner')
        reachedStage('coder')
        watchdog.armStage('coder')
        // no file mutation, no kick
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 200)
        })
      }
    })
    await vi.advanceTimersByTimeAsync(250)
    const result = await runP
    vi.useRealTimers()

    expect(result.stalled).toBe(true)
    expect(persisted).toHaveLength(0)
  })
})
