import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { ActivityNode } from './ActivityNode'
import { ActivityTray } from './ActivityTray'
import {
  useActivityStore,
  type ActivityNodeModel,
  type ActivityStatus,
  type AgentRunSnapshot,
  type LoopWakeupSnapshot
} from '@/stores/activity-store'
import { useAutomationsStore, type Automation } from '@/stores/automations-store'
import { useChatStore } from '@/stores/chat-store'
import { useHooksStore, type Hook } from '@/stores/hooks-store'
import { useWorkflowsStore, type AgentChipStatus, type WorkflowRunState } from '@/stores/workflows-store'

function tokenEstimate(text: string): number {
  return text ? Math.max(1, Math.round(text.length / 4)) : 0
}

function flatten(nodes: ActivityNodeModel[]): ActivityNodeModel[] {
  const acc: ActivityNodeModel[] = []
  const visit = (node: ActivityNodeModel) => {
    acc.push(node)
    for (const child of node.children ?? []) visit(child)
  }
  for (const node of nodes) visit(node)
  return acc
}

function workflowStatus(status: WorkflowRunState['status']): ActivityStatus {
  if (status === 'errored') return 'error'
  return status
}

function agentStatus(status: AgentRunSnapshot['status'] | AgentChipStatus): ActivityStatus {
  if (status === 'error') return 'error'
  return status
}

function agentNode(agent: AgentRunSnapshot): ActivityNodeModel {
  return {
    id: `agent:${agent.id}`,
    kind: 'agent',
    title: agent.label || agent.agentType,
    subtitle: agent.parentRunId ? `workflow ${agent.parentRunId.slice(0, 8)}` : agent.agentType,
    status: agentStatus(agent.status),
    startedAt: agent.startedAt,
    finishedAt: agent.finishedAt,
    tokenEstimate: agent.resultText ? tokenEstimate(agent.resultText) : null,
    canAbort: agent.status === 'running'
  }
}

function workflowNode(run: WorkflowRunState): ActivityNodeModel {
  const children = run.phases.flatMap((phase) =>
    phase.agents.map((agent) => ({
      id: `workflow-agent:${run.runId}:${agent.id}`,
      kind: 'agent' as const,
      title: agent.label,
      subtitle: [phase.title, agent.tier].filter(Boolean).join(' · ') || agent.agentType,
      status: agentStatus(agent.status),
      startedAt: agent.startedAt,
      finishedAt: agent.finishedAt,
      tokenEstimate: agent.tokensUsedEstimate ?? null,
      canAbort: false
    }))
  )
  return {
    id: `workflow:${run.runId}`,
    kind: 'workflow',
    title: run.name,
    subtitle: `${children.length} agent${children.length === 1 ? '' : 's'}`,
    status: workflowStatus(run.status),
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    tokenEstimate: children.reduce((sum, child) => sum + (child.tokenEstimate ?? 0), 0) || null,
    canAbort: run.status === 'running',
    children
  }
}

function automationNode(automation: Automation): ActivityNodeModel {
  return {
    id: `cron:${automation.id}`,
    kind: 'cron',
    title: automation.label,
    subtitle: automation.enabled ? automation.cron : 'disabled',
    status: automation.enabled ? 'idle' : 'disabled',
    startedAt: automation.lastRunAt,
    finishedAt: automation.lastRunAt,
    canAbort: false
  }
}

function wakeupNode(wakeup: LoopWakeupSnapshot): ActivityNodeModel {
  const pending = wakeup.status === 'pending'
  return {
    id: `loop:${wakeup.id}`,
    kind: 'loop',
    title: wakeup.reason || 'Scheduled wake-up',
    subtitle: pending ? `due ${new Date(wakeup.fireAt).toLocaleTimeString()}` : wakeup.prompt.slice(0, 48),
    status: wakeup.status === 'fired' ? 'done' : wakeup.status === 'cancelled' ? 'aborted' : wakeup.status,
    startedAt: wakeup.createdAt,
    finishedAt: wakeup.firedAt,
    canAbort: pending
  }
}

function hooksNode(hooks: Hook[]): ActivityNodeModel | null {
  if (hooks.length === 0) return null
  const enabled = hooks.filter((hook) => hook.enabled)
  return {
    id: 'hooks:enabled',
    kind: 'hook',
    title: 'Hooks',
    subtitle: `${enabled.length}/${hooks.length} enabled`,
    status: enabled.length > 0 ? 'idle' : 'disabled',
    children: enabled.slice(0, 5).map((hook) => ({
      id: `hook:${hook.id}`,
      kind: 'hook' as const,
      title: hook.label,
      subtitle: `${hook.event} · ${hook.timeoutMs}ms`,
      status: 'idle' as const
    }))
  }
}

export function ActivityDashboard(): ReactElement {
  const [now, setNow] = useState(() => Date.now())
  const collapsed = useActivityStore((s) => s.collapsed)
  const setCollapsed = useActivityStore((s) => s.setCollapsed)
  const refresh = useActivityStore((s) => s.refresh)
  const refreshAgents = useActivityStore((s) => s.refreshAgents)
  const refreshWakeups = useActivityStore((s) => s.refreshWakeups)
  const stopAgent = useActivityStore((s) => s.stopAgent)
  const cancelWakeup = useActivityStore((s) => s.cancelWakeup)
  const agentRuns = useActivityStore((s) => s.agentRuns)
  const automations = useActivityStore((s) => s.automations)
  const wakeups = useActivityStore((s) => s.wakeups)
  const hooks = useActivityStore((s) => s.hooks)
  const pinnedIds = useActivityStore((s) => s.pinnedIds)
  const togglePinned = useActivityStore((s) => s.togglePinned)

  const conversations = useChatStore((s) => s.conversations)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const streamStartedAt = useChatStore((s) => s.streamStartedAt)
  const streamingContent = useChatStore((s) => s.streamingContent)
  const cancelStream = useChatStore((s) => s.cancelStream)

  const workflowRuns = useWorkflowsStore((s) => s.runs)
  const applyProgress = useWorkflowsStore((s) => s.applyProgress)
  const stopRun = useWorkflowsStore((s) => s.stopRun)

  const automationRows = useAutomationsStore((s) => s.automations)
  const loadHooks = useHooksStore((s) => s.load)

  useEffect(() => {
    void refresh()
    void loadHooks()
    const poll = setInterval(() => void refresh(), 5000)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearInterval(poll)
      clearInterval(tick)
    }
  }, [loadHooks, refresh])

  useEffect(() => {
    if (!window.api?.workflows?.onProgress) return
    return window.api.workflows.onProgress((event) =>
      applyProgress(event as Parameters<typeof applyProgress>[0])
    )
  }, [applyProgress])

  useEffect(() => {
    if (!window.api?.tasks?.onNotify) return
    return window.api.tasks.onNotify(() => void refreshAgents())
  }, [refreshAgents])

  useEffect(() => {
    if (!window.api?.loops?.onFired) return
    return window.api.loops.onFired(() => void refreshWakeups())
  }, [refreshWakeups])

  const nodes = useMemo(() => {
    const activeConversation = activeConversationId
      ? conversations.find((conversation) => conversation.id === activeConversationId)
      : null
    const chatNode: ActivityNodeModel | null = activeConversation
      ? {
          id: `conversation:${activeConversation.id}`,
          kind: 'conversation',
          title: activeConversation.title || 'Current chat',
          subtitle: activeConversation.model,
          status: isStreaming ? 'running' : 'idle',
          startedAt: isStreaming ? streamStartedAt : activeConversation.updatedAt,
          finishedAt: isStreaming ? null : activeConversation.updatedAt,
          tokenEstimate: isStreaming ? tokenEstimate(streamingContent) : null,
          canAbort: isStreaming
        }
      : null

    const workflowNodes = workflowRuns.slice(0, 6).map(workflowNode)
    const workflowAgentIds = new Set(
      workflowRuns.flatMap((run) =>
        run.phases.flatMap((phase) => phase.agents.map((agent) => agent.id))
      )
    )
    const taskNodes = agentRuns
      .filter((agent) => !workflowAgentIds.has(agent.id))
      .slice(0, 8)
      .map(agentNode)
    const cronNodes = (automations.length > 0 ? automations : automationRows)
      .slice(0, 5)
      .map(automationNode)
    const loopNodes = wakeups.slice(0, 5).map(wakeupNode)
    const hookSummary = hooksNode(hooks)
    return [
      chatNode,
      ...workflowNodes,
      ...taskNodes,
      ...cronNodes,
      ...loopNodes,
      hookSummary
    ].filter((node): node is ActivityNodeModel => Boolean(node))
  }, [
    activeConversationId,
    agentRuns,
    automationRows,
    automations,
    conversations,
    hooks,
    isStreaming,
    streamStartedAt,
    streamingContent,
    wakeups,
    workflowRuns,
    now
  ])

  const flatNodes = useMemo(() => flatten(nodes), [nodes])
  const pinnedNodes = useMemo(
    () => pinnedIds.map((id) => flatNodes.find((node) => node.id === id)).filter((node): node is ActivityNodeModel => Boolean(node)),
    [flatNodes, pinnedIds]
  )
  const visibleNodes = nodes.filter((node) => !pinnedIds.includes(node.id))
  const runningCount = flatNodes.filter((node) => node.status === 'running' || node.status === 'pending').length

  const abortNode = (node: ActivityNodeModel) => {
    if (node.kind === 'conversation') cancelStream()
    else if (node.kind === 'workflow') void stopRun(node.id.replace(/^workflow:/, ''))
    else if (node.kind === 'agent') void stopAgent(node.id.replace(/^agent:/, ''))
    else if (node.kind === 'loop') void cancelWakeup(node.id.replace(/^loop:/, ''))
  }

  return (
    <div className="border-b border-[var(--panel-border)] pb-2" data-testid="activity-dashboard">
      <div className="mx-3 mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="flex min-w-0 items-center gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-[var(--bg-tertiary)]"
          aria-expanded={!collapsed}
        >
          <svg
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`shrink-0 text-[var(--text-muted)] ${collapsed ? '' : 'rotate-90'}`}
            aria-hidden
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
          <span className="truncate text-[12px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
            Activity
          </span>
        </button>
        <span className="rounded-full bg-[var(--bg-tertiary)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
          {runningCount} live
        </span>
      </div>

      <ActivityTray nodes={pinnedNodes} onUnpin={togglePinned} />

      {!collapsed && (
        <div className="mx-3 mt-2 max-h-80 overflow-y-auto pr-1 scrollbar-visible">
          {visibleNodes.length === 0 ? (
            <p className="px-2 py-3 text-[12px] italic text-[var(--text-muted)]">
              No live activity yet.
            </p>
          ) : (
            visibleNodes.map((node) => (
              <ActivityNode
                key={node.id}
                node={node}
                pinnedIds={pinnedIds}
                onTogglePin={togglePinned}
                onAbort={abortNode}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
