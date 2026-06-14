import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// LP-10 — safety hardening. Loops are a deliberate past-era extension that ship
// OFF by default; this suite source-locks the master-toggle gate at every entry
// point and the OFF defaults, so a future edit can't silently arm autonomous
// loops. (The ceiling / runaway / stall / drain LOGIC is covered by the running
// pure tests in loop-controller.test.ts + loop-config.test.ts + loop-tool-logic.test.ts.)

const root = join(__dirname, '..', '..')
const read = (p: string): string => readFileSync(join(root, p), 'utf-8')

describe('LP-10 loop safety gates', () => {
  it('loops:create refuses when loops are disabled', () => {
    const src = read('electron/ipc/loops.ts')
    expect(src).toMatch(/'loops:create'[\s\S]*?if \(!cfg\.enabled\)/)
  })

  it('loops:resume refuses when loops are disabled', () => {
    const src = read('electron/ipc/loops.ts')
    expect(src).toMatch(/'loops:resume'[\s\S]*?if \(!readLoopConfig\(\)\.enabled\)/)
  })

  it('the /loop slash command gates on loopsEnabled', () => {
    const src = read('src/components/chat/ChatInput.tsx')
    expect(src).toMatch(/case '\/loop':[\s\S]*?settings\.loopsEnabled/)
  })

  it('the model loop tools refuse outside an active loop', () => {
    // applyLoop* return { ok:false } when getActiveLoopForConversation is null.
    const src = read('electron/services/loop-tool-logic.ts')
    expect(src).toMatch(/getActiveLoopForConversation/)
    expect(src).toMatch(/no active loop for this conversation/)
  })

  it('loops ship OFF by default in BOTH the canonical defaults and the config resolver', () => {
    expect(read('electron/services/default-app-settings.ts')).toMatch(/loopsEnabled: false/)
    expect(read('electron/services/loop-config.ts')).toMatch(/enabled: false/)
  })

  it('the controller never schedules faster than the runaway floor', () => {
    // computeNextFire + loop_control(continue) both clamp to a floor.
    expect(read('electron/services/loop-controller.ts')).toMatch(/Math\.max\(floor,/)
    expect(read('electron/services/loop-tool-logic.ts')).toMatch(/Math\.max\(floor,/)
  })
})
