import { describe, it, expect } from 'vitest'
import { parseLoopCommand } from './parse-loop-command'

describe('parseLoopCommand', () => {
  it('empty → usage error', () => {
    expect(parseLoopCommand('').error).toBeTruthy()
    expect(parseLoopCommand('   ').error).toBeTruthy()
  })

  it('plain text → self-paced with one task', () => {
    expect(parseLoopCommand('keep refining the readme')).toEqual({
      mode: 'self_paced',
      tasks: ['keep refining the readme']
    })
  })

  it('N m → interval loop with seconds + task', () => {
    expect(parseLoopCommand('5m check the deploy')).toEqual({
      mode: 'interval',
      intervalSeconds: 300,
      tasks: ['check the deploy']
    })
  })

  it('supports s / m / h units', () => {
    expect(parseLoopCommand('30s ping').intervalSeconds).toBe(30)
    expect(parseLoopCommand('2h sweep').intervalSeconds).toBe(7200)
  })

  it('interval with no task → usage error (keeps parsed interval)', () => {
    const p = parseLoopCommand('5m')
    expect(p.mode).toBe('interval')
    expect(p.intervalSeconds).toBe(300)
    expect(p.error).toBeTruthy()
  })

  it('--auto → autonomous with mission as instruction', () => {
    expect(parseLoopCommand('--auto triage new issues and fix the easy ones')).toEqual({
      mode: 'autonomous',
      instruction: 'triage new issues and fix the easy ones'
    })
  })

  it('--auto with no mission → usage error', () => {
    expect(parseLoopCommand('--auto').error).toBeTruthy()
  })
})
