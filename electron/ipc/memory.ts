import { ipcMain } from 'electron'
import * as memStore from '../services/memory-store'
import type { MemoryListFilter } from '../services/memory-store'
import { MEMORY_TYPES, type MemoryType, type MemoryWriteInput } from '../services/memory-frontmatter'

function isMemoryType(value: unknown): value is MemoryType {
  return typeof value === 'string' && (MEMORY_TYPES as readonly string[]).includes(value)
}

export function registerMemoryHandlers(): void {
  // memory:list now optionally accepts a filter — `{ type?: MemoryType,
  // projectSlug?: string }`. Pre-D1 callers passed no args; that path
  // still returns the full legacy view via listMemories() so the
  // existing MemoryPanel keeps rendering during the D1→D3 transition.
  ipcMain.handle('memory:list', async (_event, filter?: unknown) => {
    try {
      if (filter && typeof filter === 'object') {
        const parsed: MemoryListFilter = {}
        const f = filter as Record<string, unknown>
        if (typeof f.type === 'string' && isMemoryType(f.type)) parsed.type = f.type
        if (typeof f.projectSlug === 'string') parsed.projectSlug = f.projectSlug
        return { success: true, data: memStore.listMemoryFiles(parsed) }
      }
      return { success: true, data: memStore.listMemories() }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('memory:add', async (_event, content) => {
    try {
      return { success: true, data: memStore.addMemory(content) }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('memory:update', async (_event, id, content) => {
    try {
      const entry = memStore.updateMemory(id, content)
      if (!entry) return { success: false, error: 'Memory entry not found' }
      return { success: true, data: entry }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('memory:delete', async (_event, idOrName) => {
    try {
      if (typeof idOrName === 'string') {
        const removed = memStore.deleteMemoryFile(idOrName)
        if (!removed) return { success: false, error: 'Memory entry not found' }
        return { success: true, data: null }
      }
      memStore.deleteMemory(Number(idOrName))
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('memory:clear', async () => {
    try {
      memStore.clearAllMemories()
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('memory:export', async () => {
    try {
      return { success: true, data: memStore.exportMemories() }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('memory:import', async (_event, entries) => {
    try {
      const parsed = typeof entries === 'string' ? JSON.parse(entries) : entries
      memStore.importMemories(parsed)
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ──────────────── Typed file-backed API (new in D1) ────────────────

  ipcMain.handle('memory:write', async (_event, payload?: unknown) => {
    try {
      if (!payload || typeof payload !== 'object') {
        return { success: false, error: 'memory:write requires a payload object' }
      }
      const p = payload as Record<string, unknown>
      const name = typeof p.name === 'string' ? p.name.trim() : ''
      const body = typeof p.body === 'string' ? p.body : ''
      const description = typeof p.description === 'string' ? p.description : ''
      const projectSlug = typeof p.projectSlug === 'string' ? p.projectSlug : undefined
      const sourceConversationId =
        typeof p.sourceConversationId === 'string' ? p.sourceConversationId : null
      const type = isMemoryType(p.type) ? p.type : null
      if (!name) return { success: false, error: 'name is required' }
      if (!type) return { success: false, error: `type must be one of ${MEMORY_TYPES.join(', ')}` }
      if (!body) return { success: false, error: 'body is required' }
      const file = memStore.writeMemoryFile({
        name,
        description,
        type,
        body,
        projectSlug,
        sourceConversationId
      } satisfies MemoryWriteInput & { projectSlug?: string; sourceConversationId: string | null })
      return { success: true, data: file }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('memory:read', async (_event, name: unknown) => {
    try {
      if (typeof name !== 'string' || !name.trim()) {
        return { success: false, error: 'name is required' }
      }
      const file = memStore.readMemoryFile(name.trim())
      if (!file) return { success: false, error: 'Memory entry not found' }
      return { success: true, data: file }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle(
    'memory:listBrokenLinks',
    async (_event, projectSlug?: unknown) => {
      try {
        const slug = typeof projectSlug === 'string' ? projectSlug : undefined
        return { success: true, data: memStore.getBrokenMemoryLinks(slug) }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }
  )

  ipcMain.handle('memory:readIndex', async (_event, projectSlug?: unknown) => {
    try {
      const slug = typeof projectSlug === 'string' ? projectSlug : undefined
      return { success: true, data: memStore.loadMemoryIndex(slug) }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('memory:search', async (_event, query: unknown, limit?: unknown) => {
    try {
      if (typeof query !== 'string') return { success: false, error: 'query must be a string' }
      const lim = typeof limit === 'number' && limit > 0 ? Math.min(limit, 200) : 50
      return { success: true, data: memStore.searchMemoryFiles(query, lim) }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
