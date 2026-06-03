import { describe, it, expect } from 'vitest'
import { inferPhaseFromDescriptor } from './agent-run-phase'
import type { LampreyToolDescriptor } from './tool-registry'

function descriptor(
  id: string,
  risks: LampreyToolDescriptor['risks']
): Pick<LampreyToolDescriptor, 'id' | 'risks'> {
  return { id, risks }
}

describe('inferPhaseFromDescriptor', () => {
  it('routes pure read tools to gathering_context', () => {
    expect(inferPhaseFromDescriptor(descriptor('view_image', ['read']))).toBe('gathering_context')
    expect(inferPhaseFromDescriptor(descriptor('memory_add', ['read']))).toBe('gathering_context')
  })

  it('routes read+network tools to gathering_context', () => {
    expect(inferPhaseFromDescriptor(descriptor('web_search', ['network', 'read']))).toBe(
      'gathering_context'
    )
    expect(inferPhaseFromDescriptor(descriptor('web_find', ['network', 'read']))).toBe(
      'gathering_context'
    )
  })

  it('routes pure network tools to gathering_context', () => {
    // Network-only without explicit read still counts as evidence collection.
    expect(inferPhaseFromDescriptor(descriptor('time_lookup', ['network']))).toBe(
      'gathering_context'
    )
  })

  it('routes verification tools to verifying', () => {
    expect(
      inferPhaseFromDescriptor(descriptor('verify_workspace', ['write', 'network']))
    ).toBe('verifying')
    expect(inferPhaseFromDescriptor(descriptor('frontend_qa', ['network', 'read']))).toBe(
      'verifying'
    )
  })

  it('routes write tools to acting', () => {
    expect(inferPhaseFromDescriptor(descriptor('apply_patch', ['write', 'destructive']))).toBe(
      'acting'
    )
    expect(
      inferPhaseFromDescriptor(descriptor('shell_command', ['write', 'network']))
    ).toBe('acting')
  })

  it('routes destructive-only tools to acting', () => {
    expect(inferPhaseFromDescriptor(descriptor('chrome__click', ['destructive', 'write', 'network']))).toBe(
      'acting'
    )
  })

  it('routes secret-access tools to acting', () => {
    expect(inferPhaseFromDescriptor(descriptor('hypothetical_secret_tool', ['secret']))).toBe(
      'acting'
    )
  })

  it('falls back to gathering_context for empty risks', () => {
    expect(inferPhaseFromDescriptor(descriptor('weird_tool', []))).toBe('gathering_context')
  })

  it('write beats read when both are present', () => {
    // A tool that "reads then writes" is still acting.
    expect(inferPhaseFromDescriptor(descriptor('mixed', ['read', 'write']))).toBe('acting')
  })
})
