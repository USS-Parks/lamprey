import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkflowsStore, type WorkflowProgressEvent } from './workflows-store'

const runId = 'wf-1'

function ev(partial: Partial<WorkflowProgressEvent>): WorkflowProgressEvent {
  return { runId, kind: 'log', ...partial } as WorkflowProgressEvent
}

beforeEach(() => {
  useWorkflowsStore.getState().reset()
})

describe('workflows-store — event accumulation', () => {
  it('creates a run on "started" with the meta name', () => {
    const apply = useWorkflowsStore.getState().applyProgress
    apply(ev({ kind: 'started', label: 'find-flaky-tests' }))
    const runs = useWorkflowsStore.getState().runs
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      runId,
      name: 'find-flaky-tests',
      status: 'running',
      phases: [],
      log: []
    })
  })

  it('registers phases in declaration order', () => {
    const apply = useWorkflowsStore.getState().applyProgress
    apply(ev({ kind: 'started', label: 'wf' }))
    apply(ev({ kind: 'phase', phase: 'Scan' }))
    apply(ev({ kind: 'phase', phase: 'Verify' }))
    expect(useWorkflowsStore.getState().runs[0].phases.map((p) => p.title)).toEqual([
      'Scan',
      'Verify'
    ])
  })

  it('agent:start adds a "running" chip under the phase; agent:finish flips it to "done"', () => {
    const apply = useWorkflowsStore.getState().applyProgress
    apply(ev({ kind: 'started', label: 'wf' }))
    apply(ev({ kind: 'phase', phase: 'Scan' }))
    apply(
      ev({
        kind: 'agent:start',
        phase: 'Scan',
        agentType: 'Explore',
        label: 'find foo',
        agentRunId: 'a1'
      })
    )
    let phases = useWorkflowsStore.getState().runs[0].phases
    expect(phases[0].agents[0]).toMatchObject({
      label: 'find foo',
      agentType: 'Explore',
      status: 'running'
    })
    apply(
      ev({
        kind: 'agent:finish',
        phase: 'Scan',
        agentRunId: 'a1',
        agentType: 'Explore',
        label: 'find foo',
        status: 'done',
        durationMs: 120,
        tokensUsedEstimate: 50
      })
    )
    phases = useWorkflowsStore.getState().runs[0].phases
    expect(phases[0].agents[0]).toMatchObject({
      status: 'done',
      durationMs: 120,
      tokensUsedEstimate: 50
    })
  })

  it("B5: agent:finish stores the tier from the event", () => {
    const apply = useWorkflowsStore.getState().applyProgress
    apply(ev({ kind: 'started', label: 'wf' }))
    apply(
      ev({
        kind: 'agent:start',
        agentType: 'general',
        label: 'skeptic',
        agentRunId: 'a1',
        phase: ''
      })
    )
    apply(
      ev({
        kind: 'agent:finish',
        agentType: 'general',
        label: 'skeptic',
        agentRunId: 'a1',
        status: 'done',
        tier: 'cheap',
        phase: ''
      })
    )
    expect(useWorkflowsStore.getState().runs[0].phases[0].agents[0].tier).toBe('cheap')
  })

  it('B5: tokens events are accepted and do not break the tree', () => {
    const apply = useWorkflowsStore.getState().applyProgress
    apply(ev({ kind: 'started', label: 'wf' }))
    apply(ev({ kind: 'tokens', tier: 'cheap', tokensUsedEstimate: 10 }))
    apply(ev({ kind: 'tokens', tier: 'pro', tokensUsedEstimate: 50 }))
    // Tree should still be valid; no errors thrown, runs[0] still in 'running'.
    const run = useWorkflowsStore.getState().runs[0]
    expect(run.status).toBe('running')
  })

  it("a cached agent:finish carries the 'cached' flag", () => {
    const apply = useWorkflowsStore.getState().applyProgress
    apply(ev({ kind: 'started', label: 'wf' }))
    apply(
      ev({
        kind: 'agent:start',
        agentType: 'Explore',
        label: 'L',
        agentRunId: 'a1',
        phase: ''
      })
    )
    apply(
      ev({
        kind: 'agent:finish',
        agentType: 'Explore',
        label: 'L',
        agentRunId: 'a1',
        status: 'done',
        message: 'cached',
        phase: ''
      })
    )
    expect(useWorkflowsStore.getState().runs[0].phases[0].agents[0].cached).toBe(true)
  })

  it('log events accumulate as narrator lines tagged with phase', () => {
    const apply = useWorkflowsStore.getState().applyProgress
    apply(ev({ kind: 'started', label: 'wf' }))
    apply(ev({ kind: 'phase', phase: 'Scan' }))
    apply(ev({ kind: 'log', message: 'scanned 12 files', phase: 'Scan' }))
    apply(ev({ kind: 'log', message: 'no flakes found', phase: 'Scan' }))
    const log = useWorkflowsStore.getState().runs[0].log
    expect(log).toHaveLength(2)
    expect(log[0].text).toBe('scanned 12 files')
    expect(log[1].phase).toBe('Scan')
  })

  it('flips the run to "done" on finished + records finalResult', () => {
    const apply = useWorkflowsStore.getState().applyProgress
    apply(ev({ kind: 'started', label: 'wf' }))
    apply(ev({ kind: 'finished', finalResult: { count: 3 } }))
    expect(useWorkflowsStore.getState().runs[0]).toMatchObject({
      status: 'done',
      finalResult: { count: 3 }
    })
  })

  it('flips the run to "errored" on errored + records error text', () => {
    const apply = useWorkflowsStore.getState().applyProgress
    apply(ev({ kind: 'started', label: 'wf' }))
    apply(ev({ kind: 'errored', error: 'oops' }))
    expect(useWorkflowsStore.getState().runs[0]).toMatchObject({
      status: 'errored',
      error: 'oops'
    })
  })

  it('10-agent pipeline drives the tree correctly (REQUIRED verify-gate smoke)', () => {
    const apply = useWorkflowsStore.getState().applyProgress
    apply(ev({ kind: 'started', label: 'big-fanout' }))
    apply(ev({ kind: 'phase', phase: 'Fan-out' }))
    for (let i = 0; i < 10; i++) {
      apply(
        ev({
          kind: 'agent:start',
          phase: 'Fan-out',
          agentType: 'general',
          label: `agent-${i}`,
          agentRunId: `a${i}`
        })
      )
    }
    for (let i = 0; i < 10; i++) {
      apply(
        ev({
          kind: 'agent:finish',
          phase: 'Fan-out',
          agentType: 'general',
          label: `agent-${i}`,
          agentRunId: `a${i}`,
          status: 'done',
          durationMs: 25,
          tokensUsedEstimate: 8
        })
      )
    }
    apply(ev({ kind: 'finished', finalResult: 'ok' }))
    const run = useWorkflowsStore.getState().runs[0]
    expect(run.status).toBe('done')
    expect(run.phases).toHaveLength(1)
    expect(run.phases[0].agents).toHaveLength(10)
    expect(run.phases[0].agents.every((a) => a.status === 'done')).toBe(true)
    expect(run.phases[0].agents.every((a) => a.tokensUsedEstimate === 8)).toBe(true)
  })
})

describe('workflows-store — stopRun calls IPC + optimistic flip', () => {
  it('calls window.api.workflows.stop and flips the run to aborted', async () => {
    const apply = useWorkflowsStore.getState().applyProgress
    apply(ev({ kind: 'started', label: 'wf' }))
    const stopSpy = vi.fn().mockResolvedValue({ success: true, data: { stopped: true } })
    const fakeWindow = {
      api: {
        workflows: {
          stop: stopSpy,
          list: vi.fn(),
          runInline: vi.fn(),
          run: vi.fn(),
          onProgress: vi.fn().mockReturnValue(() => {})
        }
      }
    } as unknown as Window
    ;(globalThis as { window?: Window }).window = fakeWindow
    await useWorkflowsStore.getState().stopRun(runId)
    expect(stopSpy).toHaveBeenCalledWith(runId)
    expect(useWorkflowsStore.getState().runs[0].status).toBe('aborted')
    delete (globalThis as { window?: Window }).window
  })
})
