import { describe, it, expect } from 'vitest'
import { dispatchNativeTool } from './native-dispatch'

// End-to-end coverage of the dispatch chain consumed by chat.ts. The
// throw → "Error: <msg>" → status='error' path is the one that previously
// had no test seam — handler-level tests asserted the throw, but nothing
// asserted the chat-loop downstream actually classified the audit row
// correctly. dispatchNativeTool is now the single seam, so this suite is
// the contract.

describe('dispatchNativeTool', () => {
  it('a thrown Error becomes status=error with the body prefixed by "Error:"', async () => {
    const out = await dispatchNativeTool(async () => {
      throw new Error('view_image: extension ".xyz" is not supported.')
    })
    expect(out.status).toBe('error')
    expect(out.result).toBe('Error: view_image: extension ".xyz" is not supported.')
  })

  it('a thrown non-Error string is preserved in the body', async () => {
    const out = await dispatchNativeTool(async () => {
      throw 'string thrown'
    })
    expect(out.status).toBe('error')
    expect(out.result).toBe('Error: string thrown')
  })

  it('a thrown Error with no message falls back to a non-empty body', async () => {
    const out = await dispatchNativeTool(async () => {
      throw new Error()
    })
    expect(out.status).toBe('error')
    expect(out.result.startsWith('Error: ')).toBe(true)
    expect(out.result.length).toBeGreaterThan('Error: '.length)
  })

  it('a thrown non-Error non-string is stringified safely', async () => {
    const out = await dispatchNativeTool(async () => {
      throw 42
    })
    expect(out.status).toBe('error')
    expect(out.result).toBe('Error: 42')
  })

  it('a structured envelope with status=error is carried through verbatim', async () => {
    const out = await dispatchNativeTool(async () => ({
      result: 'Exit: 1 · Duration: 5ms · cwd: /tmp · stderr: oops',
      status: 'error' as const
    }))
    expect(out.status).toBe('error')
    expect(out.result).toBe('Exit: 1 · Duration: 5ms · cwd: /tmp · stderr: oops')
  })

  it('a structured envelope with status=done is authoritative even when the body looks like an error', async () => {
    const out = await dispatchNativeTool(async () => ({
      result: 'Error: but the handler explicitly says this is a success',
      status: 'done' as const
    }))
    expect(out.status).toBe('done')
    expect(out.result).toBe('Error: but the handler explicitly says this is a success')
  })

  it('a structured envelope with status=denied is carried through', async () => {
    const out = await dispatchNativeTool(async () => ({
      result: 'request_permissions: user said no',
      status: 'denied' as const
    }))
    expect(out.status).toBe('denied')
  })

  it('a plain-string Error: prefix classifies as error', async () => {
    const out = await dispatchNativeTool(async () => 'Error: legacy path')
    expect(out.status).toBe('error')
    expect(out.result).toBe('Error: legacy path')
  })

  it('a plain-string Unknown tool: prefix classifies as error', async () => {
    const out = await dispatchNativeTool(async () => 'Unknown tool: foo')
    expect(out.status).toBe('error')
  })

  it('a plain-string "Action denied by user." classifies as denied', async () => {
    const out = await dispatchNativeTool(async () => 'Action denied by user.')
    expect(out.status).toBe('denied')
    expect(out.result).toBe('Action denied by user.')
  })

  it('a plain success string classifies as done', async () => {
    const out = await dispatchNativeTool(async () => 'Saved to memory.')
    expect(out.status).toBe('done')
    expect(out.result).toBe('Saved to memory.')
  })

  it('a JSON-looking success body classifies as done (no false-positive on "error" mid-string)', async () => {
    const body = '{"steps":[],"totals":{"error":0}}'
    const out = await dispatchNativeTool(async () => body)
    expect(out.status).toBe('done')
    expect(out.result).toBe(body)
  })

  it('rethrown via Promise.reject is treated the same as throw', async () => {
    const out = await dispatchNativeTool(async () => {
      return Promise.reject(new Error('rejected'))
    })
    expect(out.status).toBe('error')
    expect(out.result).toBe('Error: rejected')
  })
})
