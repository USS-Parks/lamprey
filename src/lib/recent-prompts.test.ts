import { describe, expect, it } from 'vitest'
import {
  getRecentUserPromptsFrom,
  stripAttachmentBlocks
} from './recent-prompts'
import type { Message } from './types'

// chat-store itself drags in IPC + cross-store value imports (settings,
// model, agent, plan, toast, nav-history) that vitest can't resolve from
// the `@/` alias without a plugin. The actual logic behind
// useChatStore.getRecentUserPrompts() lives in `@/lib/recent-prompts`
// where it's framework-free and directly testable.

function userMsg(content: string, id = crypto.randomUUID()): Message {
  return {
    id,
    role: 'user',
    content,
    timestamp: Date.now(),
    conversationId: 'conv-1',
    model: 'deepseek-v4-pro'
  }
}

function asstMsg(content: string, id = crypto.randomUUID()): Message {
  return {
    id,
    role: 'assistant',
    content,
    timestamp: Date.now(),
    conversationId: 'conv-1',
    model: 'deepseek-v4-pro'
  }
}

describe('stripAttachmentBlocks', () => {
  it('returns the original text when no attachment marker is present', () => {
    expect(stripAttachmentBlocks('plain prompt')).toBe('plain prompt')
  })

  it('chops off a [Attachment] block including its code fence', () => {
    const raw = 'fix the bug\n\n[Attachment foo.ts]\n```ts\nfunction x(){}\n```'
    expect(stripAttachmentBlocks(raw)).toBe('fix the bug')
  })

  it('chops off a [Indexed corpus:] block', () => {
    const raw =
      'summarize the spec\n\n[Indexed corpus: PROPOSAL.pdf — 28 chunks available via retrieval]'
    expect(stripAttachmentBlocks(raw)).toBe('summarize the spec')
  })

  it('chops off [PDF] and [Indexing] markers too', () => {
    const pdf = 'compare these\n\n[PDF report.pdf]\nbody text'
    const indexing = 'wait\n\n[Indexing big.txt — chunks not yet available for this turn]'
    expect(stripAttachmentBlocks(pdf)).toBe('compare these')
    expect(stripAttachmentBlocks(indexing)).toBe('wait')
  })

  it('does not chop random "[..." text that is not an attachment marker', () => {
    const raw = 'see the note: [foo] and [bar]'
    expect(stripAttachmentBlocks(raw)).toBe(raw)
  })
})

describe('getRecentUserPromptsFrom', () => {
  it('returns an empty list when there are no messages', () => {
    expect(getRecentUserPromptsFrom([])).toEqual([])
  })

  it('returns user prompts only, most-recent-first', () => {
    const msgs = [
      userMsg('first'),
      asstMsg('reply 1'),
      userMsg('second'),
      asstMsg('reply 2'),
      userMsg('third')
    ]
    expect(getRecentUserPromptsFrom(msgs)).toEqual(['third', 'second', 'first'])
  })

  it('strips attachment blocks from stored content so recall == typed text', () => {
    const msgs = [userMsg('look at this file\n\n[Attachment foo.ts]\n```ts\nx\n```')]
    expect(getRecentUserPromptsFrom(msgs)).toEqual(['look at this file'])
  })

  it('honours the limit parameter', () => {
    const msgs: Message[] = []
    for (let i = 0; i < 60; i++) msgs.push(userMsg(`p${i}`))
    expect(getRecentUserPromptsFrom(msgs, 5)).toEqual([
      'p59',
      'p58',
      'p57',
      'p56',
      'p55'
    ])
  })

  it('defaults to a 50-prompt cap', () => {
    const msgs: Message[] = []
    for (let i = 0; i < 75; i++) msgs.push(userMsg(`p${i}`))
    expect(getRecentUserPromptsFrom(msgs).length).toBe(50)
  })

  it('skips empty / whitespace-only user content', () => {
    const msgs = [userMsg('   '), userMsg('real prompt')]
    expect(getRecentUserPromptsFrom(msgs)).toEqual(['real prompt'])
  })
})
