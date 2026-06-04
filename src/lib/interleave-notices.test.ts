import { describe, expect, it } from 'vitest'
import { interleaveNotices } from './interleave-notices'

const m = (id: string, timestamp: number) => ({ id, timestamp })
const n = (id: string, ts: number) => ({ id, ts })

describe('interleaveNotices', () => {
  it('returns just messages when there are no notices', () => {
    const out = interleaveNotices([m('a', 1), m('b', 2)], [])
    expect(out).toEqual([
      { kind: 'message', item: m('a', 1) },
      { kind: 'message', item: m('b', 2) }
    ])
  })

  it('returns just notices when there are no messages', () => {
    const out = interleaveNotices([], [n('x', 1), n('y', 2)])
    expect(out.map((o) => o.kind)).toEqual(['notice', 'notice'])
  })

  it('interleaves by timestamp', () => {
    const out = interleaveNotices(
      [m('a', 1), m('b', 5)],
      [n('x', 2), n('y', 6)]
    )
    expect(out.map((o) => o.item.id)).toEqual(['a', 'x', 'b', 'y'])
  })

  it('puts messages before notices on a tie', () => {
    const out = interleaveNotices([m('a', 3)], [n('x', 3)])
    expect(out.map((o) => o.kind)).toEqual(['message', 'notice'])
  })

  it('preserves stable order inside each list', () => {
    const out = interleaveNotices(
      [m('a', 1), m('b', 1), m('c', 1)],
      [n('x', 1)]
    )
    expect(out.map((o) => o.item.id)).toEqual(['a', 'b', 'c', 'x'])
  })
})
