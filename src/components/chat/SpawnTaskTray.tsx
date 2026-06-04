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
        if (current.some((t) => t.taskId === event.taskId)) return current
        return [event, ...current].slice(0, 8)
      })
    })
  }, [])

  const visible = useMemo(
    () => tasks.filter((task) => task.sourceConversationId === activeConversationId),
    [activeConversationId, tasks]
  )

  if (visible.length === 0) return null

  return (
    <div className="mb-2 flex flex-col gap-1">
      {visible.map((task) => (
        <SpawnTaskChip
          key={task.taskId}
          task={task}
          onOpen={async (t) => {
            await loadConversations()
            await selectConversation(t.conversationId)
          }}
          onDismiss={(taskId) =>
            setTasks((current) => current.filter((task) => task.taskId !== taskId))
          }
        />
      ))}
    </div>
  )
}
