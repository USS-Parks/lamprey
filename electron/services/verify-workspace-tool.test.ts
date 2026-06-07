import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  executeVerifyWorkspace,
  isFormatCommand,
  parseVerificationMetrics,
  selectVerificationCommands,
  type VerificationReport
} from './verify-workspace-tool'
import type { ShellResult } from './shell-tool'

function makeShellResult(command: string, cwd: string, exitCode: number): ShellResult {
  return {
    command,
    cwd,
    exitCode,
    signal: null,
    stdout: exitCode === 0 ? 'ok' : '',
    stderr: exitCode === 0 ? '' : 'failed',
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 12,
    timedOut: false
  }
}

describe('selectVerificationCommands', () => {
  it('skips format commands by default', () => {
    const selected = selectVerificationCommands(
      ['npm run typecheck', 'npm run format', 'npm test'],
      undefined
    )
    expect(selected.commands).toEqual(['npm run typecheck', 'npm test'])
    expect(selected.skippedCommands).toEqual(['npm run format'])
  })

  it('includes format commands only when explicitly requested', () => {
    const selected = selectVerificationCommands(
      ['npm run typecheck', 'npm run format'],
      { include_format: true }
    )
    expect(selected.commands).toEqual(['npm run typecheck', 'npm run format'])
  })

  it('rejects commands that were not inferred', () => {
    expect(() =>
      selectVerificationCommands(['npm test'], { commands: ['npm install'] })
    ).toThrow(/not one of the inferred/)
  })

  it('caps selected commands', () => {
    const selected = selectVerificationCommands(
      ['npm run a', 'npm run b', 'npm run c'],
      { max_commands: 2 }
    )
    expect(selected.commands).toEqual(['npm run a', 'npm run b'])
    expect(selected.notes.join('\n')).toContain('commands capped')
  })

  it('recognizes format script names', () => {
    expect(isFormatCommand('npm run format')).toBe(true)
    expect(isFormatCommand('npm run format:check')).toBe(true)
    expect(isFormatCommand('npm run typecheck')).toBe(false)
  })
})

describe('executeVerifyWorkspace', () => {
  it('runs inferred commands sequentially and reports pass', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-workspace-'))
    try {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ scripts: { typecheck: 'tsc --noEmit', test: 'vitest run' } })
      )
      const seen: string[] = []
      const receipts: Array<{ id: string; status: string; command: string }> = []
      const out = await executeVerifyWorkspace(undefined, root, async (args, workspaceRoot) => {
        seen.push(args.command)
        return makeShellResult(args.command, args.cwd ?? workspaceRoot, 0)
      }, {
        writeReceipt: (input) => {
          const id = `receipt-${receipts.length + 1}`
          receipts.push({ id, status: input.status, command: input.command })
          return { id }
        }
      })
      const report = JSON.parse(out.result) as VerificationReport
      expect(out.status).toBe('done')
      expect(report.status).toBe('passed')
      expect(seen).toEqual(['npm run typecheck', 'npm test'])
      expect(report.results.map((r) => r.receiptId)).toEqual(['receipt-1', 'receipt-2'])
      expect(receipts.map((r) => r.status)).toEqual(['passed', 'passed'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('marks the tool call as error when a command fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-workspace-fail-'))
    try {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ scripts: { typecheck: 'tsc --noEmit' } })
      )
      const receipts: Array<{ id: string; status: string; command: string }> = []
      const out = await executeVerifyWorkspace(
        undefined,
        root,
        async (args, workspaceRoot) =>
          makeShellResult(args.command, args.cwd ?? workspaceRoot, 1),
        {
          writeReceipt: (input) => {
            const id = `receipt-${receipts.length + 1}`
            receipts.push({ id, status: input.status, command: input.command })
            return { id }
          }
        }
      )
      const report = JSON.parse(out.result) as VerificationReport
      expect(out.status).toBe('error')
      expect(report.status).toBe('failed')
      expect(report.results[0].receiptId).toBe('receipt-1')
      expect(report.results[0].stderrPreview).toContain('failed')
      expect(receipts[0].status).toBe('failed')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns skipped when no commands are inferred', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-workspace-empty-'))
    try {
      const out = await executeVerifyWorkspace(undefined, root, async () => {
        throw new Error('runner should not be called')
      })
      const report = JSON.parse(out.result) as VerificationReport
      expect(out.status).toBe('done')
      expect(report.status).toBe('skipped')
      expect(report.notes.join('\n')).toContain('No verification commands')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('persists skipped receipts for skipped format commands', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-workspace-skip-'))
    try {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ scripts: { format: 'prettier --write .' } })
      )
      const receipts: Array<{ id: string; status: string; command: string }> = []
      const out = await executeVerifyWorkspace(undefined, root, async () => {
        throw new Error('runner should not be called')
      }, {
        writeReceipt: (input) => {
          const id = `receipt-${receipts.length + 1}`
          receipts.push({ id, status: input.status, command: input.command })
          return { id }
        }
      })
      const report = JSON.parse(out.result) as VerificationReport
      expect(out.status).toBe('done')
      expect(report.status).toBe('skipped')
      expect(receipts).toEqual([
        { id: 'receipt-1', status: 'skipped', command: 'npm run format' }
      ])
      expect(report.notes.join('\n')).toContain('receipt-1')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects cwd outside the workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-workspace-root-'))
    try {
      await expect(executeVerifyWorkspace({ cwd: '..' }, root)).rejects.toThrow(/outside/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('parseVerificationMetrics', () => {
  it('parses vitest counts and TypeScript project status', () => {
    expect(
      parseVerificationMetrics(
        'npm test',
        'Test Files  1 passed\nTests  28 passed | 2 skipped',
        '',
        0
      ).tests
    ).toEqual({ passed: 28, skipped: 2, failed: 0 })

    expect(
      parseVerificationMetrics('npx tsc --noEmit -p tsconfig.node.json', '', '', 0)
        .typescript
    ).toEqual({ project: 'tsconfig.node.json', ok: true })
  })
})
