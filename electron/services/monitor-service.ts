// Monitor service (parity Track 3, prompt F4).
//
// Subscribes to the shell-tool background bus and gives callers a
// line-by-line, polling-friendly view of a long-running process.
// `monitor_start({ processId, untilPattern? })` returns a `streamId`;
// `monitor_read(streamId, since?)` drains buffered lines after the
// cursor; `monitor_stop(streamId)` releases the subscription. When an
// `untilPattern` regex matches a line, the monitor fires
// `monitor:matched` and auto-stops so the model doesn't keep polling.
//
// Each monitor owns its own bounded buffer so multiple monitors on the
// same processId don't share state (e.g. one monitor waits for the
// Local URL, another tails errors).

import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import {
  shellBackgroundBus,
  type ShellBackgroundExitEvent,
  type ShellBackgroundLineEvent
} from './shell-tool'

const BUFFER_CAP = 2_000 // lines

export type MonitorStatus = 'active' | 'matched' | 'stopped' | 'exited'

export interface MonitorLine {
  seq: number
  stream: 'stdout' | 'stderr'
  line: string
  at: number
}

export interface MonitorHandle {
  id: string
  processId: string
  untilPattern: string | null
  status: MonitorStatus
  matchedLine: string | null
  startedAt: number
  finishedAt: number | null
  bytesWritten: number
  lineCount: number
}

interface InternalMonitor {
  id: string
  processId: string
  untilPattern: RegExp | null
  untilPatternSource: string | null
  status: MonitorStatus
  matchedLine: string | null
  startedAt: number
  finishedAt: number | null
  bytesWritten: number
  buffer: MonitorLine[]
  nextSeq: number
}

const monitors = new Map<string, InternalMonitor>()
export const monitorBus = new EventEmitter()
monitorBus.setMaxListeners(50)

let busSubscribed = false
function ensureSubscribed(): void {
  if (busSubscribed) return
  busSubscribed = true
  shellBackgroundBus.on('bg-line', (evt: ShellBackgroundLineEvent) => {
    for (const monitor of monitors.values()) {
      if (monitor.status !== 'active') continue
      if (monitor.processId !== evt.processId) continue
      ingestLine(monitor, evt)
    }
  })
  shellBackgroundBus.on('bg-exit', (evt: ShellBackgroundExitEvent) => {
    for (const monitor of monitors.values()) {
      if (monitor.processId !== evt.processId) continue
      if (monitor.status === 'active') {
        monitor.status = 'exited'
        monitor.finishedAt = Date.now()
        monitorBus.emit('monitor:exit', {
          streamId: monitor.id,
          processId: monitor.processId,
          exitCode: evt.exitCode,
          signal: evt.signal,
          durationMs: evt.durationMs
        })
      }
    }
  })
}

function ingestLine(monitor: InternalMonitor, evt: ShellBackgroundLineEvent): void {
  // Status-gate inside ingest so both bus-driven and direct (test)
  // ingestion paths respect a matched/stopped/exited monitor.
  if (monitor.status !== 'active') return
  const entry: MonitorLine = {
    seq: monitor.nextSeq++,
    stream: evt.stream,
    line: evt.line,
    at: evt.at
  }
  monitor.buffer.push(entry)
  monitor.bytesWritten += evt.line.length
  if (monitor.buffer.length > BUFFER_CAP) {
    monitor.buffer.splice(0, monitor.buffer.length - BUFFER_CAP)
  }
  monitorBus.emit('monitor:line', {
    streamId: monitor.id,
    processId: monitor.processId,
    entry
  })

  if (monitor.untilPattern && monitor.untilPattern.test(evt.line)) {
    monitor.matchedLine = evt.line
    monitor.status = 'matched'
    monitor.finishedAt = Date.now()
    monitorBus.emit('monitor:matched', {
      streamId: monitor.id,
      processId: monitor.processId,
      matchedLine: evt.line,
      entry
    })
  }
}

function snapshot(monitor: InternalMonitor): MonitorHandle {
  return {
    id: monitor.id,
    processId: monitor.processId,
    untilPattern: monitor.untilPatternSource,
    status: monitor.status,
    matchedLine: monitor.matchedLine,
    startedAt: monitor.startedAt,
    finishedAt: monitor.finishedAt,
    bytesWritten: monitor.bytesWritten,
    lineCount: monitor.nextSeq
  }
}

export interface StartMonitorOptions {
  processId: string
  /** Regex pattern (string). When a line matches, the monitor auto-stops
   *  and emits `monitor:matched`. Leave undefined for tail-forever mode. */
  untilPattern?: string
}

export function startMonitor(opts: StartMonitorOptions): MonitorHandle {
  if (!opts?.processId) throw new Error('monitor:start — processId is required')
  ensureSubscribed()
  let pattern: RegExp | null = null
  if (opts.untilPattern) {
    try {
      pattern = new RegExp(opts.untilPattern)
    } catch {
      throw new Error(`monitor:start — invalid untilPattern regex: ${opts.untilPattern}`)
    }
  }
  const id = randomUUID()
  const monitor: InternalMonitor = {
    id,
    processId: opts.processId,
    untilPattern: pattern,
    untilPatternSource: opts.untilPattern ?? null,
    status: 'active',
    matchedLine: null,
    startedAt: Date.now(),
    finishedAt: null,
    bytesWritten: 0,
    buffer: [],
    nextSeq: 1
  }
  monitors.set(id, monitor)
  return snapshot(monitor)
}

export interface MonitorReadResult {
  handle: MonitorHandle
  lines: MonitorLine[]
  /** The seq of the last line returned; pass back as `since` next time. */
  cursor: number
}

export function readMonitor(streamId: string, since?: number): MonitorReadResult {
  const monitor = monitors.get(streamId)
  if (!monitor) throw new Error(`monitor:read — unknown streamId ${streamId}`)
  const after = typeof since === 'number' ? since : 0
  const lines = monitor.buffer.filter((l) => l.seq > after)
  const cursor = lines.length > 0 ? lines[lines.length - 1].seq : after
  return { handle: snapshot(monitor), lines, cursor }
}

export function stopMonitor(streamId: string): boolean {
  const monitor = monitors.get(streamId)
  if (!monitor) return false
  if (monitor.status === 'active') {
    monitor.status = 'stopped'
    monitor.finishedAt = Date.now()
    monitorBus.emit('monitor:stopped', { streamId: monitor.id, processId: monitor.processId })
  }
  return true
}

export function destroyMonitor(streamId: string): void {
  stopMonitor(streamId)
  monitors.delete(streamId)
}

export function listMonitors(): MonitorHandle[] {
  return Array.from(monitors.values()).map(snapshot)
}

export function destroyAllMonitors(): void {
  for (const id of [...monitors.keys()]) destroyMonitor(id)
}

// Test seam — re-export for unit tests that want to bypass the bus
// (assertions on `ingestLine`'s pattern-match path don't need a real
// child process). `getInternalMonitor` returns the actual mutable
// record so the test can drive ingestLine directly.
export const __monitorServiceTest = {
  ingestLine,
  getInternalMonitor: (id: string) => monitors.get(id) ?? null,
  reset: (): void => {
    for (const id of [...monitors.keys()]) monitors.delete(id)
    busSubscribed = false
    shellBackgroundBus.removeAllListeners('bg-line')
    shellBackgroundBus.removeAllListeners('bg-exit')
  }
}
