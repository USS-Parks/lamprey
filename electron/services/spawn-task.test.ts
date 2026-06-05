import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => 'C:/tmp/lamprey-test-user-data' }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

import { spawnTask } from './spawn-task'

describe('spawnTask', () => {
  it('creates a linked child conversation with a seeded prompt and worktree metadata', async () => {
    const messages: Array<{ conversationId: string; role: string; content: string }> = []
    const enqueued: unknown[] = []
    const result = await spawnTask(
      {
        sourceConversationId: 'conv-source',
        title: 'Investigate flaky test',
        prompt: 'Find the flaky test and propose a fix.',
        tldr: 'Look at the CI-only failure.',
        cwd: 'C:/repo',
        model: 'deepseek-v4-pro'
      },
      {
        getConversation: () =>
          ({
            id: 'conv-source',
            title: 'Source',
            model: 'deepseek-v4-flash',
            createdAt: 1,
            updatedAt: 1,
            messageCount: 0,
            projectId: 'project-1'
          }) as any,
        createConversation: (model, opts) =>
          ({
            id: 'conv-child',
            title: null,
            model,
            createdAt: 2,
            updatedAt: 2,
            messageCount: 0,
            kind: opts?.kind ?? 'local',
            worktreePath: opts?.worktreePath ?? null,
            projectId: opts?.projectId ?? null
          }) as any,
        updateConversationTitle: vi.fn(),
        saveMessage: (msg) => {
          messages.push({
            conversationId: msg.conversationId,
            role: msg.role,
            content: msg.content
          })
          return msg as any
        },
        enqueue: (input) => {
          enqueued.push(input)
          return {
            id: 'evt-1',
            conversationId: input.conversationId,
            kind: input.kind,
            payload: input.payload ?? {},
            createdAt: input.createdAt ?? 0,
            deliveredAt: null
          }
        },
        worktreeManager: {
          create: async () => ({ path: 'C:/repo-worktrees/task-1', branch: 'lamprey-agent/task-1' }),
          finalize: async () => ({
            keep: true,
            hasChanges: false,
            path: 'C:/repo-worktrees/task-1',
            branch: 'lamprey-agent/task-1',
            removed: false
          })
        }
      }
    )

    expect(result.conversationId).toBe('conv-child')
    expect(result.worktreePath).toBe('C:/repo-worktrees/task-1')
    expect(result.branch).toBe('lamprey-agent/task-1')
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conversationId: 'conv-source',
          role: 'system',
          content: expect.stringContaining('conv-child')
        }),
        expect.objectContaining({
          conversationId: 'conv-child',
          role: 'system',
          content: expect.stringContaining('conv-source')
        }),
        expect.objectContaining({
          conversationId: 'conv-child',
          role: 'user',
          content: 'Find the flaky test and propose a fix.'
        })
      ])
    )
    expect(enqueued).toEqual([
      expect.objectContaining({
        conversationId: 'conv-source',
        kind: 'tasks:spawn-completed'
      })
    ])
  })

  it('registers spawn_task as a mutating native tool', async () => {
    await import('./spawn-task-tool-pack')
    const { toolRegistry } = await import('./tool-registry')
    const descriptor = toolRegistry.getById('spawn_task')
    expect(descriptor?.name).toBe('spawn_task')
    expect(descriptor?.mutates).toBe(true)
    expect(descriptor?.risks).toContain('write')
  })
})
