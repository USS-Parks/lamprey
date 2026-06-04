import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Cross-session search + archive (parity E3) — exercises listSessions,
// setConversationArchived, setConversationPinned, and searchSessions
// against a real on-disk SQLite database in a per-process tmpdir.
//
// Falls back to a graceful no-op assertion path when the better-sqlite3
// binding can't load (system Node ABI vs the Electron-built binding);
// the integration check then runs against the production app.
const TEST_USER_DATA = join(tmpdir(), `lamprey-sessions-test-${process.pid}-${Date.now()}`)

vi.mock('electron', () => ({
  app: { getPath: () => TEST_USER_DATA },
  BrowserWindow: { getAllWindows: () => [] }
}))

import * as convStore from './conversation-store'
import { __resetDbForTests, getDb } from './database'

function nativeOk(): boolean {
  try {
    getDb()
    return true
  } catch {
    return false
  }
}

beforeEach(() => {
  __resetDbForTests()
  if (existsSync(TEST_USER_DATA)) {
    rmSync(TEST_USER_DATA, { recursive: true, force: true })
  }
  mkdirSync(TEST_USER_DATA, { recursive: true })
})

afterAll(() => {
  __resetDbForTests()
  if (existsSync(TEST_USER_DATA)) {
    rmSync(TEST_USER_DATA, { recursive: true, force: true })
  }
})

describe('E3 — sessions sidebar buckets + FTS search', () => {
  it.skipIf(!nativeOk())('archive moves a conversation from Recent to Archived', () => {
    const a = convStore.createConversation('deepseek-chat')
    const b = convStore.createConversation('deepseek-chat')

    convStore.updateConversationTitle(a.id, 'Conversation A')
    convStore.updateConversationTitle(b.id, 'Conversation B')

    expect(convStore.listSessions({ tab: 'recent' }).map((c) => c.id).sort()).toEqual(
      [a.id, b.id].sort()
    )
    expect(convStore.listSessions({ tab: 'archived' })).toEqual([])

    convStore.setConversationArchived(a.id, true)
    const recent = convStore.listSessions({ tab: 'recent' })
    expect(recent.map((c) => c.id)).toEqual([b.id])
    const archived = convStore.listSessions({ tab: 'archived' })
    expect(archived.map((c) => c.id)).toEqual([a.id])
    expect(archived[0].archived).toBe(true)
  })

  it.skipIf(!nativeOk())('pinning moves a conversation to the Pinned bucket', () => {
    const a = convStore.createConversation('deepseek-chat')
    convStore.updateConversationTitle(a.id, 'Important')
    convStore.setConversationPinned(a.id, true)

    expect(convStore.listSessions({ tab: 'recent' })).toEqual([])
    const pinned = convStore.listSessions({ tab: 'pinned' })
    expect(pinned.map((c) => c.id)).toEqual([a.id])
    expect(pinned[0].pinnedAt).toBeGreaterThan(0)
  })

  it.skipIf(!nativeOk())('searchSessions finds verbatim phrases in message bodies', () => {
    const a = convStore.createConversation('deepseek-chat')
    convStore.updateConversationTitle(a.id, 'Conversation alpha')
    convStore.saveMessage({
      id: 'msg-1',
      conversationId: a.id,
      role: 'user',
      content: 'Where do we store the encryption key shards on disk?'
    })
    convStore.saveMessage({
      id: 'msg-2',
      conversationId: a.id,
      role: 'assistant',
      content: 'They live under userData/keys.json with safeStorage.'
    })

    const titleHits = convStore.searchSessions('alpha')
    expect(titleHits.find((h) => h.source === 'conversation' && h.conversationId === a.id)).toBeTruthy()

    const bodyHits = convStore.searchSessions('encryption')
    expect(bodyHits.find((h) => h.source === 'message' && h.conversationId === a.id)).toBeTruthy()

    const phraseHits = convStore.searchSessions('"safeStorage"')
    expect(phraseHits.find((h) => h.conversationId === a.id)).toBeTruthy()
  })

  it.skipIf(!nativeOk())('listSessions({ query }) restricts the bucket to FTS hits', () => {
    const a = convStore.createConversation('deepseek-chat')
    const b = convStore.createConversation('deepseek-chat')
    convStore.updateConversationTitle(a.id, 'Sessions sidebar polish')
    convStore.updateConversationTitle(b.id, 'Unrelated refactor')

    const hits = convStore.listSessions({ tab: 'recent', query: 'sidebar' })
    expect(hits.map((c) => c.id)).toEqual([a.id])
  })

  it.skipIf(!nativeOk())('FTS backfill repopulates the index after a wipe', () => {
    const a = convStore.createConversation('deepseek-chat')
    convStore.updateConversationTitle(a.id, 'Backfill candidate')
    convStore.saveMessage({
      id: 'msg-bf',
      conversationId: a.id,
      role: 'user',
      content: 'Marker phrase canary-xyz789.'
    })
    const db = getDb()
    db.exec('DELETE FROM sessions_fts')
    expect(convStore.searchSessions('canary-xyz789')).toEqual([])

    const res = convStore.backfillSessionsFts(true)
    expect(res.rebuilt).toBe(true)
    expect(res.rows).toBeGreaterThan(0)
    expect(convStore.searchSessions('canary-xyz789').length).toBeGreaterThan(0)
  })

  it.skipIf(!nativeOk())('clearConversationMessages drops message rows + FTS entries', () => {
    const a = convStore.createConversation('deepseek-chat')
    convStore.updateConversationTitle(a.id, 'Compactable')
    convStore.saveMessage({
      id: 'msg-c-1',
      conversationId: a.id,
      role: 'user',
      content: 'topic-to-be-compacted'
    })
    expect(convStore.searchSessions('topic-to-be-compacted').length).toBeGreaterThan(0)

    convStore.clearConversationMessages(a.id)
    expect(convStore.getMessages(a.id)).toEqual([])
    expect(convStore.searchSessions('topic-to-be-compacted')).toEqual([])
    // Conversation row + title FTS row still present.
    expect(convStore.searchSessions('Compactable').length).toBeGreaterThan(0)
  })
})
