import { useEffect, useMemo, useState } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { useSkillsStore } from '@/stores/skills-store'
import { useMemoryStore } from '@/stores/memory-store'
import { useMcpStore } from '@/stores/mcp-store'
import { github as githubClient } from '@/lib/ipc-client'
import type { SourceItem } from '@/lib/types'
import type { GitHubProjectRepoLink } from '@/lib/github-types'

interface UseSourcesResult {
  sources: SourceItem[]
  groups: {
    files: SourceItem[]
    skills: SourceItem[]
    memory: SourceItem[]
    mcp: SourceItem[]
    github: SourceItem[]
  }
}

// Aggregates the four "source" inputs into a single list for the Environment
// card. Each item exposes onRemove wired to its owning store so the card can
// detach without knowing the store layout.
export function useSources(): UseSourcesResult {
  const attachments = useChatStore((s) => s.pendingAttachments)
  const removeAttachment = useChatStore((s) => s.removeAttachment)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const conversations = useChatStore((s) => s.conversations)
  const skills = useSkillsStore((s) => s.skills)
  const activeSkillIds = useSkillsStore((s) => s.activeSkillIds)
  const toggleSkill = useSkillsStore((s) => s.toggleSkill)
  const pinnedByConversation = useMemoryStore((s) => s.pinnedByConversation)
  const memories = useMemoryStore((s) => s.memories)
  const toggleMemoryPin = useMemoryStore((s) => s.toggleMemoryPin)
  const servers = useMcpStore((s) => s.servers)

  // GitHub repo linked to the active conversation's project. Fetched
  // through IPC so we don't pull github-store as a dependency of every
  // surface that uses sources. The lookup is cheap (sqlite single-row);
  // we refresh when the project id changes.
  const projectId =
    conversations.find((c) => c.id === activeConversationId)?.projectId ?? null
  const [githubLink, setGithubLink] = useState<GitHubProjectRepoLink | null>(null)
  useEffect(() => {
    if (!projectId) {
      setGithubLink(null)
      return
    }
    let cancelled = false
    void githubClient.getProjectRepo(projectId).then((res) => {
      if (!cancelled) setGithubLink(res.success ? res.data : null)
    })
    return () => {
      cancelled = true
    }
  }, [projectId])

  return useMemo(() => {
    const files: SourceItem[] = attachments.map((file, idx) => ({
      id: `file:${idx}:${file.name}`,
      kind: 'file' as const,
      title: file.name,
      subtitle: `${(file.size / 1024).toFixed(1)} KB`,
      onRemove: () => removeAttachment(idx)
    }))

    const skillMap = new Map(skills.map((s) => [s.id, s]))
    const skillItems: SourceItem[] = activeSkillIds
      .map((id) => skillMap.get(id))
      .filter(Boolean)
      .map((skill) => ({
        id: `skill:${skill!.id}`,
        kind: 'skill' as const,
        title: skill!.name,
        subtitle: skill!.description,
        onRemove: () => toggleSkill(skill!.id)
      }))

    const memoryItems: SourceItem[] = (() => {
      if (!activeConversationId) return []
      const ids = pinnedByConversation[activeConversationId] ?? []
      const memMap = new Map(memories.map((m) => [m.id, m]))
      return ids
        .map((id) => memMap.get(id))
        .filter(Boolean)
        .map((entry) => ({
          id: `memory:${entry!.id}`,
          kind: 'memory' as const,
          title: entry!.content.slice(0, 60).trim() + (entry!.content.length > 60 ? '…' : ''),
          onRemove: () => toggleMemoryPin(activeConversationId, entry!.id)
        }))
    })()

    const mcpItems: SourceItem[] = servers
      .filter((s) => s.status === 'connected')
      .map((server) => ({
        id: `mcp:${server.id}`,
        kind: 'mcp' as const,
        title: server.name,
        subtitle: server.transport.toUpperCase()
      }))

    const githubItems: SourceItem[] = githubLink
      ? [
          {
            id: `github:${githubLink.fullName}`,
            kind: 'github' as const,
            title: githubLink.fullName,
            subtitle: `${githubLink.defaultBranch}${githubLink.localPath ? ' · cloned' : ''}`,
            onRemove: projectId
              ? () => {
                  void githubClient.unlinkRepo(projectId).then(() => setGithubLink(null))
                }
              : undefined
          }
        ]
      : []

    return {
      sources: [...files, ...skillItems, ...memoryItems, ...mcpItems, ...githubItems],
      groups: {
        files,
        skills: skillItems,
        memory: memoryItems,
        mcp: mcpItems,
        github: githubItems
      }
    }
  }, [
    attachments,
    removeAttachment,
    skills,
    activeSkillIds,
    toggleSkill,
    pinnedByConversation,
    memories,
    toggleMemoryPin,
    servers,
    activeConversationId,
    githubLink,
    projectId
  ])
}
