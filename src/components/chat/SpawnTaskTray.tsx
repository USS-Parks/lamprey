import { useEffect, useMemo, useState } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { SpawnTaskChip, type SpawnedTask } from './SpawnTaskChip'

function isSpawnedTask(value: unknown): value is SpawnedTask {
  const v = value as Partial<SpawnedTask>
  return (
    typeof v?.taskId === 'string' &&
    typeof v?.sourceConversationId === 'string' &&
    typeof v?.conversationId === 'string' &&
    typeof v?.title === 'string'
  )
}

export function SpawnTaskTray() {
  const [tasks, setTasks] = useState<SpawnedTask[]>([])
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const selectConversation = useChatStore((s) => s.selectConversation)
  const loadConversations = useChatStore((s) => s.loadConversations)

  useEffect(() => {
    if (!window.api?.tasks?.onSpawned) return
    return window.api.tasks.onSpawned((event: unknown) => {
      if (!isSpawnedTask(event)) return
      setTasks((current) => {
        if (current.some((task) => task.taskId === event.taskId)) return current
        return [event, ...current].slice(0, 12)
      })
    })
  }, [])

  const visible = useMemo(
    () =>
      tasks.map((task) => ({
        ...task,
        activeSource: task.sourceConversationId === activeConversationId
      })),
    [activeConversationId, tasks]
  )

  if (visible.length === 0) return null

  const openTask = async (task: SpawnedTask) => {
    await loadConversations()
    await selectConversation(task.conversationId)
  }

  const openAll = async () => {
    await loadConversations()
    for (const task of visible.slice().reverse()) {
      await selectConversation(task.conversationId)
    }
  }

  return (
    <aside
      className="fixed right-10 top-24 z-30 w-80 rounded-md border border-[var(--panel-border)] bg-[var(--bg-secondary)] shadow-xl transition-all duration-200"
      aria-label="Spawned tasks"
    >
      <div className="flex items-center gap-2 border-b border-[var(--panel-border)] px-3 py-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
          Spawn tasks
        </span>
        <span className="rounded border border-[var(--panel-border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
          {visible.length}
        </span>
        <button
          onClick={openAll}
          className="ml-auto rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-0.5 text-[11px] hover:border-[var(--accent)]"
        >
          Open all
        </button>
        <button
          onClick={() => setTasks([])}
          className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-0.5 text-[11px] hover:border-[var(--accent)]"
        >
          Dismiss all
        </button>
      </div>
      <div className="max-h-[360px] space-y-1 overflow-y-auto p-2">
        {visible.map((task) => (
          <SpawnTaskChip
            key={task.taskId}
            task={task}
            activeSource={task.activeSource}
            onOpen={openTask}
            onOpenSource={async (sourceId) => {
              await loadConversations()
              await selectConversation(sourceId)
            }}
            onDismiss={(taskId) =>
              setTasks((current) => current.filter((task) => task.taskId !== taskId))
            }
          />
        ))}
      </div>
    </aside>
  )
}
