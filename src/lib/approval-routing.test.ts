import { describe, expect, it } from 'vitest'
import { approvalKey, routeApproval } from './approval-routing'
import type { ToolRisk } from './types'

function req(serverId: string, name: string, risks: ToolRisk[] = ['read']) {
  return { serverId, name, risks }
}

describe('routeApproval', () => {
  it('returns "modal" when any risk is destructive', () => {
    const seen = new Set<string>([approvalKey('lamprey', 'shell_command')])
    expect(routeApproval(req('lamprey', 'shell_command', ['destructive']), { approvedSeen: seen }))
      .toBe('modal')
  })

  it('returns "modal" when the (server, tool) pair has never been approved this session', () => {
    expect(routeApproval(req('lamprey', 'read_file'), { approvedSeen: new Set() }))
      .toBe('modal')
  })

  it('returns "chip" for previously-approved non-destructive tools', () => {
    const seen = new Set<string>([approvalKey('lamprey', 'read_file')])
    expect(routeApproval(req('lamprey', 'read_file', ['read']), { approvedSeen: seen }))
      .toBe('chip')
  })

  it('chip routing is per-(server, tool), not per-server', () => {
    // Server has had one tool approved — a brand new tool from the same
    // server still goes to the modal so its descriptor is read once.
    const seen = new Set<string>([approvalKey('lamprey', 'read_file')])
    expect(routeApproval(req('lamprey', 'apply_patch', ['write']), { approvedSeen: seen }))
      .toBe('modal')
  })

  it('a write-risk previously-approved tool still gets a chip the second time', () => {
    const seen = new Set<string>([approvalKey('lamprey', 'apply_patch')])
    expect(routeApproval(req('lamprey', 'apply_patch', ['write']), { approvedSeen: seen }))
      .toBe('chip')
  })

  it('approvalKey is namespaced so two servers cannot collide', () => {
    expect(approvalKey('a', 'tool')).not.toBe(approvalKey('b', 'tool'))
  })
})
